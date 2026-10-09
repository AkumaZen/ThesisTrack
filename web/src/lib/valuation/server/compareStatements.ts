import * as cheerio from 'cheerio';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { companyCache } from '$lib/server/db/valuationSchema';
import { detectBasis } from './scraper';
import { bseSlugFor } from './screenerSlug';
import {
	metricKey,
	unitFor,
	type CompareStatements,
	type SectionId,
	type StatementRow,
	type StatementSection
} from '../compareMetrics';

// The Compare page's full statements: every row of Screener's consolidated P&L, balance sheet,
// cash flow, ratios and shareholding tables, plus the sub-rows behind each expandable "+" row
// (trade receivables, payables, inventory, working capital changes, ...). Heavier than
// scraper.ts's summary (one page plus ~11 small JSON calls), so it is cached on its own.

const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL_MS = 24 * 60 * 60 * 1000;
/** Kept in valuation.company_cache beside the summary rows, under a prefixed key. */
const CACHE_PREFIX = 'STMT:';
/** Bump when the shape changes so older cached rows are fetched again. */
const SHAPE_VERSION = 3;
const MIN_GAP_MS = 450;
const MAX_RETRIES = 3;
/** An incomplete fetch (some breakdowns failed) is cached this long only, then retried. */
const PARTIAL_TTL_MS = 10 * 60 * 1000;
/**
 * A Refresh within this long of the last fetch gets that fetch back. Any signed-in user
 * can press Refresh and each one costs about a dozen Screener calls, so repeats are capped.
 */
const MIN_REFRESH_GAP_MS = 5 * 60 * 1000;

type TableSection = Exclude<SectionId, 'mkt'>;
const TABLE_SECTIONS: { id: TableSection; html: string }[] = [
	{ id: 'pl', html: 'profit-loss' },
	{ id: 'bs', html: 'balance-sheet' },
	{ id: 'cf', html: 'cash-flow' },
	{ id: 'ratios', html: 'ratios' },
	{ id: 'sh', html: 'shareholding' }
];

let nextSlotAt = 0;
const inFlight = new Map<string, Promise<CompareStatements>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Spaces every Screener request from this module at least MIN_GAP_MS apart, and backs off and
 * retries when Screener throttles (429), which several companies loading at once can trigger.
 */
async function politeFetch(url: string, accept: string): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const slot = Math.max(Date.now(), nextSlotAt);
		nextSlotAt = slot + MIN_GAP_MS;
		const wait = slot - Date.now();
		if (wait > 0) await sleep(wait);
		const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept } });
		if (res.status === 404) throw new Error(`NOT_FOUND: ${url}`);
		if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
			const retryAfter = Number(res.headers.get('retry-after'));
			const backoff = retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt;
			// Hold back every queued request too, not only this one.
			nextSlotAt = Math.max(nextSlotAt, Date.now() + backoff);
			continue;
		}
		if (!res.ok) throw new Error(`Screener request failed (${res.status})`);
		return res;
	}
}

function parseNumber(text: unknown): number | null {
	if (typeof text === 'number') return Number.isFinite(text) ? text : null;
	if (typeof text !== 'string') return null;
	const cleaned = text.replace(/[,₹%\s]/g, '');
	if (cleaned === '' || cleaned === '-') return null;
	const n = parseFloat(cleaned);
	return Number.isNaN(n) ? null : n;
}

/**
 * Banks' P&L rows under the names every other company uses, so a bank's revenue and margin land
 * in the same Compare rows (and the default selection) instead of showing a dash there.
 */
const PL_ALIASES: Record<string, string> = {
	Revenue: 'Sales',
	'Financing Profit': 'Operating Profit',
	'Financing Margin %': 'OPM %'
};

/** The label a row is filed under: Screener's own, except for the bank aliases above. */
function rowLabel(section: TableSection, label: string): string {
	return section === 'pl' ? (PL_ALIASES[label] ?? label) : label;
}

/** "Borrowings&nbsp;+" -> "Borrowings". */
function cleanLabel(text: string): string {
	return text
		.replace(/ /g, ' ')
		.replace(/\s*\+\s*$/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** `expandable` holds Screener's own labels: the breakdown API is asked by those. */
function readTable(
	$: cheerio.CheerioAPI,
	id: TableSection,
	htmlId: string
): { section: StatementSection; expandable: string[] } {
	// Shareholding has a quarterly and a yearly table; the first is the quarterly one.
	const table = $(`#${htmlId} table`).first();
	const labels = table
		.find('thead th')
		.slice(1)
		.map((_, th) => $(th).contents().first().text().trim())
		.get();
	const rows: StatementRow[] = [];
	const expandable: string[] = [];
	table.find('tbody tr').each((_, tr) => {
		const cells = $(tr).find('td');
		const screenerLabel = cleanLabel($(cells[0]).text());
		if (!screenerLabel || /raw pdf/i.test(screenerLabel)) return;
		const label = rowLabel(id, screenerLabel);
		const raw = cells
			.slice(1)
			.map((_, td) => $(td).text().trim())
			.get();
		const values = raw.map(parseNumber);
		if (values.every((v) => v == null)) return;
		if ($(cells[0]).find('button[onclick*="showSchedule"]').length) expandable.push(screenerLabel);
		rows.push({
			key: metricKey(id, label),
			label,
			parent: null,
			unit: unitFor(id, label, raw.some((t) => t.includes('%'))),
			values
		});
	});
	return { section: { id, labels, rows }, expandable };
}

/** The sub-rows behind one expandable row, aligned to the section's period labels. */
async function readSchedule(
	companyId: string,
	section: TableSection,
	htmlId: string,
	parent: string,
	labels: string[],
	consolidated: boolean
): Promise<StatementRow[]> {
	const url =
		`https://www.screener.in/api/company/${encodeURIComponent(companyId)}/schedules/` +
		`?parent=${encodeURIComponent(parent)}&section=${htmlId}${consolidated ? '&consolidated=' : ''}`;
	const parentLabel = rowLabel(section, parent);
	const res = await politeFetch(url, 'application/json');
	const body = (await res.json()) as Record<string, Record<string, unknown>> | null;
	const rows: StatementRow[] = [];
	for (const [rawLabel, byPeriod] of Object.entries(body ?? {})) {
		if (!byPeriod || typeof byPeriod !== 'object') continue;
		const label = cleanLabel(rawLabel);
		// Only the period keys; Screener mixes in UI keys such as isExpandable.
		const raw = labels.map((l) => byPeriod[l]);
		const values = raw.map(parseNumber);
		if (values.every((v) => v == null)) continue;
		const sawPercent = raw.some((t) => typeof t === 'string' && t.includes('%'));
		rows.push({
			key: metricKey(section, label, parentLabel),
			label,
			parent: parentLabel,
			unit: unitFor(section, label, sawPercent),
			values
		});
	}
	return rows;
}

/** Point-in-time figures from the header ratios (price, P/E, market cap, ...). */
function readMarket($: cheerio.CheerioAPI): StatementSection {
	const rows: StatementRow[] = [];
	const add = (label: string, value: number | null, unit = unitFor('mkt', label, false)) =>
		rows.push({ key: metricKey('mkt', label), label, parent: null, unit, values: [value] });
	let price: number | null = null;
	let book: number | null = null;
	$('#top-ratios li').each((_, el) => {
		const name = $(el).find('span.name').text().trim();
		if (!name) return;
		const numbers = $(el)
			.find('span.number')
			.map((_, n) => parseNumber($(n).text()))
			.get() as (number | null)[];
		if (/high\s*\/\s*low/i.test(name)) {
			add('52 week high', numbers[0] ?? null, 'rs');
			add('52 week low', numbers[1] ?? null, 'rs');
			return;
		}
		const value = numbers[0] ?? null;
		if (name === 'Current Price') price = value;
		if (name === 'Book Value') book = value;
		if (name === 'Market Cap') add(name, value, 'cr');
		else if (/Yield|ROCE|ROE/.test(name)) add(name, value, 'pct');
		else add(name, value);
	});
	if (price != null && book) add('Price to book', Math.round((price / book) * 100) / 100, 'x');
	return { id: 'mkt', labels: [], rows };
}

async function loadPage(slug: string, consolidated: boolean): Promise<cheerio.CheerioAPI> {
	const path = consolidated ? 'consolidated/' : '';
	const res = await politeFetch(
		`https://www.screener.in/company/${encodeURIComponent(slug)}/${path}`,
		'text/html,application/xhtml+xml'
	);
	return cheerio.load(await res.text());
}

async function scrape(symbol: string, slug: string): Promise<Scraped> {
	let $ = await loadPage(slug, true);
	// Some /consolidated/ pages contain placeholder rows but no periods or values, even without
	// a consolidated basis marker. Check the parsed data, not the raw row count or basis label.
	let consolidated = detectBasis($) === 'consolidated';
	let profitLoss = readTable($, 'pl', 'profit-loss').section;
	if (profitLoss.labels.length === 0 || profitLoss.rows.length === 0) {
		$ = await loadPage(slug, false);
		consolidated = false;
		profitLoss = readTable($, 'pl', 'profit-loss').section;
	}
	if (profitLoss.labels.length === 0 || profitLoss.rows.length === 0)
		throw new Error(`No financial statements available on Screener: ${symbol}`);

	const companyId = $('[data-company-id]').first().attr('data-company-id') ?? null;
	const sections: StatementSection[] = [readMarket($)];
	let partial = false;
	for (const { id, html } of TABLE_SECTIONS) {
		const { section, expandable } = readTable($, id, html);
		if (companyId && id !== 'sh') {
			for (const parent of expandable) {
				try {
					const subRows = await readSchedule(companyId, id, html, parent, section.labels, consolidated);
					const at = section.rows.findIndex((r) => r.key === metricKey(id, rowLabel(id, parent))) + 1;
					section.rows.splice(at, 0, ...subRows);
				} catch (e) {
					// A missing breakdown only hides its sub-rows; the headline row is still there.
					partial = true;
					console.warn(`[compare] ${symbol}: no "${parent}" breakdown:`, e instanceof Error ? e.message : e);
				}
			}
		}
		sections.push(section);
	}

	return {
		symbol,
		name: $('#top h1').first().text().trim() || symbol,
		basis: consolidated ? 'consolidated' : 'standalone_only',
		fetchedAt: Date.now(),
		sections,
		partial
	};
}

type Scraped = CompareStatements & { partial: boolean };

async function scrapeWithSlugFallback(symbol: string): Promise<Scraped> {
	try {
		return await scrape(symbol, symbol);
	} catch (e) {
		// Some companies are listed on Screener only by their BSE code (ASMTEC is /company/526433/).
		if (!(e instanceof Error) || !e.message.startsWith('NOT_FOUND')) throw e;
		const slug = await bseSlugFor(symbol).catch(() => null);
		if (!slug) throw e;
		return scrape(symbol, slug);
	}
}

type Cached = Scraped & { shapeVersion?: number };

function publicShape({ symbol, name, basis, fetchedAt, sections }: Cached): CompareStatements {
	return { symbol, name, basis, fetchedAt, sections };
}

export async function getCompareStatements(
	symbol: string,
	{ refresh = false } = {}
): Promise<CompareStatements> {
	const key = symbol.toUpperCase();
	const cacheKey = CACHE_PREFIX + key;
	const [row] = await db.select().from(companyCache).where(eq(companyCache.symbol, cacheKey));
	const cached = row?.data as Cached | undefined;
	if (row && cached?.shapeVersion === SHAPE_VERSION) {
		const ttl = refresh ? MIN_REFRESH_GAP_MS : cached.partial ? PARTIAL_TTL_MS : TTL_MS;
		if (Date.now() - row.fetchedAt < ttl) return publicShape(cached);
	}

	const existing = inFlight.get(key);
	if (existing) return existing;
	const promise = (async () => {
		const data = await scrapeWithSlugFallback(key);
		const stored: Cached = { ...data, shapeVersion: SHAPE_VERSION };
		await db
			.insert(companyCache)
			.values({ symbol: cacheKey, basis: data.basis, data: stored, fetchedAt: data.fetchedAt })
			.onConflictDoUpdate({
				target: companyCache.symbol,
				set: { basis: data.basis, data: stored, fetchedAt: data.fetchedAt }
			});
		return publicShape(stored);
	})().finally(() => inFlight.delete(key));
	inFlight.set(key, promise);
	return promise;
}
