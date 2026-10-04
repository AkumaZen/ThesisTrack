import * as cheerio from 'cheerio';

const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type Basis = 'consolidated' | 'standalone' | 'standalone_only';

export interface CompanyFinancials {
	symbol: string;
	name: string;
	basis: Basis;
	cmp: number | null;
	marketCap: number | null;
	bookValuePerShare: number | null;
	/** Set only after a manual "Refresh price" call to Angel One; absent for scrape-only data. */
	cmpFetchedAt?: number;
	stockPE: number | null;
	roce: number | null;
	roe: number | null;
	dividendYield: number | null;
	faceValue: number | null;
	sector: string | null;
	industry: string | null;
	years: {
		label: string; // e.g. "Mar 2025"
		sales: number | null;
		expenses: number | null;
		operatingProfit: number | null;
		otherIncome: number | null;
		interest: number | null;
		depreciation: number | null;
		pbt: number | null;
		tax: number | null;
		netProfit: number | null;
		eps: number | null;
	}[];
	/** Latest available year figures from the balance sheet, for leverage/net-worth context. */
	balanceSheet: {
		label: string;
		reserves: number | null;
		borrowings: number | null;
		totalAssets: number | null;
	} | null;
	/** Latest shareholding-pattern column (most recent quarter), plus prior-quarter promoter
	 *  holding so a promoter-selling trend (a real red flag) can be detected. */
	shareholding: {
		label: string;
		promoters: number | null;
		fiis: number | null;
		diis: number | null;
		public: number | null;
		promotersPrevQuarter: number | null;
	} | null;
	/** Screener's own machine-generated checklist-based analysis, verbatim. */
	pros: string[];
	cons: string[];
	/**
	 * Full available P&L history (up to ~7 years, excluding TTM) for diagnostics that need
	 * more than the 2 "locked" display years — e.g. multi-year CAGR/volatility signals for
	 * valuation-method recommendation. Superset of `years`.
	 */
	history: { label: string; sales: number | null; netProfit: number | null }[];
	/** Latest available working-capital ratios, for detecting working-capital-heavy businesses. */
	cashConversionCycle: number | null;
	debtorDays: number | null;
	inventoryDays: number | null;
	/** Recent quarterly results (typically last 9 quarters), most recent last. */
	quarters: {
		label: string; // e.g. "Jun 2026"
		sales: number | null;
		netProfit: number | null;
		opmPct: number | null;
		eps: number | null;
	}[];
}

/** One in-flight fetch per symbol at a time, with a small polite delay before each Screener request. */
const inFlight = new Map<string, Promise<CompanyFinancials>>();
let lastRequestAt = 0;
const MIN_GAP_MS = 800;

async function politeFetch(url: string): Promise<string> {
	const wait = Math.max(0, lastRequestAt + MIN_GAP_MS - Date.now());
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastRequestAt = Date.now();

	const res = await fetch(url, {
		headers: {
			'User-Agent': USER_AGENT,
			Accept: 'text/html,application/xhtml+xml'
		}
	});
	if (res.status === 404) throw new Error(`NOT_FOUND: ${url}`);
	if (!res.ok) throw new Error(`Screener request failed (${res.status}): ${url}`);
	return res.text();
}

function parseNumber(text: string | undefined | null): number | null {
	if (!text) return null;
	const cleaned = text.replace(/[,₹%\s]/g, '');
	if (cleaned === '' || cleaned === '-') return null;
	const n = parseFloat(cleaned);
	return Number.isNaN(n) ? null : n;
}

/**
 * Screener never 404s/redirects /consolidated/ for a standalone-only ticker — it silently
 * returns HTTP 200 with the same content as the plain page. Basis must be read from the
 * "<p class=sub>" marker text directly inside the #profit-loss section, not the URL/status,
 * and not just the first <p class="sub"> on the page (there are unrelated ones, e.g. a
 * "Please log in" banner, elsewhere on the page).
 * Confirmed against RELIANCE (real consolidated+standalone), AHCL (real consolidated+standalone),
 * and ANLON (standalone_only, silent fallback — no "Consolidated"/"Standalone" prefix or toggle link).
 */
function detectBasis($: cheerio.CheerioAPI): Basis {
	const subText = $('#profit-loss p.sub').first().text();
	if (/Consolidated Figures/i.test(subText)) return 'consolidated';
	if (/Standalone Figures/i.test(subText)) return 'standalone';
	return 'standalone_only';
}

function extractRatio($: cheerio.CheerioAPI, label: string): number | null {
	let value: number | null = null;
	$('#top-ratios li').each((_, el) => {
		const name = $(el).find('span.name').text().trim();
		if (name === label) {
			value = parseNumber($(el).find('span.number').first().text());
		}
	});
	return value;
}

function extractRow($: cheerio.CheerioAPI, sectionId: string, rowLabel: string): (number | null)[] {
	let cells: (number | null)[] = [];
	$(`#${sectionId} table tbody tr`).each((_, tr) => {
		const label = $(tr).find('td').first().text().trim();
		if (label.toLowerCase().startsWith(rowLabel.toLowerCase())) {
			cells = $(tr)
				.find('td')
				.slice(1)
				.map((_, td) => parseNumber($(td).text()))
				.get();
		}
	});
	return cells;
}

function extractYearLabels($: cheerio.CheerioAPI, sectionId: string): string[] {
	return $(`#${sectionId} table thead th`)
		.slice(1)
		.map((_, th) => $(th).contents().first().text().trim())
		.get();
}

function extractBalanceSheet($: cheerio.CheerioAPI): CompanyFinancials['balanceSheet'] {
	const labels = extractYearLabels($, 'balance-sheet');
	if (labels.length === 0) return null;
	const reserves = extractRow($, 'balance-sheet', 'Reserves');
	const borrowings = extractRow($, 'balance-sheet', 'Borrowings');
	const totalAssets = extractRow($, 'balance-sheet', 'Total Assets');
	const last = labels.length - 1;
	return {
		label: labels[last],
		reserves: reserves[last] ?? null,
		borrowings: borrowings[last] ?? null,
		totalAssets: totalAssets[last] ?? null
	};
}

function extractShareholding($: cheerio.CheerioAPI): CompanyFinancials['shareholding'] {
	// The page has two shareholding tables (a longer quarterly history and a short one) —
	// take the first, which Screener always renders with the deeper history.
	const labels = $('#shareholding table')
		.first()
		.find('thead th')
		.slice(1)
		.map((_, th) => $(th).contents().first().text().trim())
		.get();
	if (labels.length === 0) return null;

	function rowCells(rowLabel: string): (number | null)[] {
		let cells: (number | null)[] = [];
		$('#shareholding table')
			.first()
			.find('tbody tr')
			.each((_, tr) => {
				const label = $(tr).find('td').first().text().trim();
				if (label.toLowerCase().startsWith(rowLabel.toLowerCase())) {
					cells = $(tr)
						.find('td')
						.slice(1)
						.map((_, td) => parseNumber($(td).text()))
						.get();
				}
			});
		return cells;
	}
	function nthFromEnd(cells: (number | null)[], fromEnd: number): number | null {
		const idx = cells.length - 1 - fromEnd;
		return idx >= 0 ? (cells[idx] ?? null) : null;
	}

	const promoterCells = rowCells('Promoters');
	return {
		label: labels[labels.length - 1],
		promoters: nthFromEnd(promoterCells, 0),
		fiis: nthFromEnd(rowCells('FIIs'), 0),
		diis: nthFromEnd(rowCells('DIIs'), 0),
		public: nthFromEnd(rowCells('Public'), 0),
		promotersPrevQuarter: nthFromEnd(promoterCells, 1)
	};
}

function extractHistory($: cheerio.CheerioAPI): CompanyFinancials['history'] {
	const sales = extractRow($, 'profit-loss', 'Sales');
	const netProfit = extractRow($, 'profit-loss', 'Net Profit');
	const labelsRaw = extractYearLabels($, 'profit-loss');
	const ttmIdx = labelsRaw.findIndex((l) => /TTM/i.test(l));
	const endIdx = ttmIdx === -1 ? labelsRaw.length : ttmIdx;

	const history: CompanyFinancials['history'] = [];
	for (let i = 0; i < endIdx; i++) {
		history.push({
			label: labelsRaw[i] ?? `Year ${i + 1}`,
			sales: sales[i] ?? null,
			netProfit: netProfit[i] ?? null
		});
	}
	return history;
}

function extractQuarters($: cheerio.CheerioAPI): CompanyFinancials['quarters'] {
	const labels = extractYearLabels($, 'quarters');
	const sales = extractRow($, 'quarters', 'Sales');
	const netProfit = extractRow($, 'quarters', 'Net Profit');
	const opm = extractRow($, 'quarters', 'OPM %');
	const eps = extractRow($, 'quarters', 'EPS in Rs');

	return labels.map((label, i) => ({
		label,
		sales: sales[i] ?? null,
		netProfit: netProfit[i] ?? null,
		opmPct: opm[i] ?? null,
		eps: eps[i] ?? null
	}));
}

function extractLatestRatio($: cheerio.CheerioAPI, rowLabel: string): number | null {
	const row = extractRow($, 'ratios', rowLabel);
	return row.length > 0 ? (row[row.length - 1] ?? null) : null;
}

function extractSectorIndustry($: cheerio.CheerioAPI): {
	sector: string | null;
	industry: string | null;
} {
	const sector = $('a[title="Sector"]').first().text().trim() || null;
	const industry = $('a[title="Industry"]').first().text().trim() || null;
	return { sector, industry };
}

function extractProsCons($: cheerio.CheerioAPI): { pros: string[]; cons: string[] } {
	const pros = $('#analysis .pros ul li')
		.map((_, li) => $(li).text().trim())
		.get();
	const cons = $('#analysis .cons ul li')
		.map((_, li) => $(li).text().trim())
		.get();
	return { pros, cons };
}

function buildYears($: cheerio.CheerioAPI): CompanyFinancials['years'] {
	const sales = extractRow($, 'profit-loss', 'Sales');
	const expenses = extractRow($, 'profit-loss', 'Expenses');
	const operatingProfit = extractRow($, 'profit-loss', 'Operating Profit');
	const otherIncome = extractRow($, 'profit-loss', 'Other Income');
	const interest = extractRow($, 'profit-loss', 'Interest');
	const depreciation = extractRow($, 'profit-loss', 'Depreciation');
	const pbt = extractRow($, 'profit-loss', 'Profit before tax');
	const netProfit = extractRow($, 'profit-loss', 'Net Profit');
	const eps = extractRow($, 'profit-loss', 'EPS in Rs');
	const labelsRaw = extractYearLabels($, 'profit-loss');

	// Screener appends a trailing "TTM" column after the last completed FY — exclude it,
	// since it's a trailing-twelve-months figure, not a completed year, and must not be
	// treated as a "locked historical" column.
	const ttmIdx = labelsRaw.findIndex((l) => /TTM/i.test(l));
	const endIdx = ttmIdx === -1 ? labelsRaw.length : ttmIdx;
	const labels = labelsRaw.slice(0, endIdx);

	// Last two completed years only (locked historical columns).
	const count = Math.min(2, endIdx);
	const startIdx = Math.max(0, endIdx - count);
	const years: CompanyFinancials['years'] = [];
	for (let i = startIdx; i < endIdx; i++) {
		const p = pbt[i] ?? null;
		const np = netProfit[i] ?? null;
		years.push({
			label: labels[i] ?? `Year ${i + 1}`,
			sales: sales[i] ?? null,
			expenses: expenses[i] ?? null,
			operatingProfit: operatingProfit[i] ?? null,
			otherIncome: otherIncome[i] ?? null,
			interest: interest[i] ?? null,
			depreciation: depreciation[i] ?? null,
			pbt: p,
			tax: p != null && np != null ? p - np : null,
			netProfit: np,
			eps: eps[i] ?? null
		});
	}
	return years;
}

/** Pulls the trailing 4-digit year out of a Screener column label like "Mar 2021" or "TTM". */
function latestYearNumber(years: CompanyFinancials['years']): number | null {
	if (years.length === 0) return null;
	const match = years[years.length - 1].label.match(/(\d{4})/);
	return match ? Number(match[1]) : null;
}

async function scrapeOnce(symbol: string): Promise<CompanyFinancials> {
	const upper = symbol.toUpperCase();
	const consolidatedUrl = `https://www.screener.in/company/${encodeURIComponent(upper)}/consolidated/`;
	const consolidatedHtml = await politeFetch(consolidatedUrl);
	let $ = cheerio.load(consolidatedHtml);

	let basis = detectBasis($);
	let years = buildYears($);

	// Some companies (no subsidiaries) have a genuinely empty /consolidated/ P&L table
	// rather than a silent fallback to standalone content — fetch the plain page instead.
	//
	// Separately, some companies HAD consolidated reporting once (a real, non-empty table)
	// but stopped — e.g. a subsidiary was divested/deconsolidated — leaving /consolidated/
	// permanently stuck on old data while standalone keeps getting updated every year
	// (confirmed against SIMPLEXCAS: consolidated frozen at Mar 2021, standalone current
	// through Mar 2026). A >2-year gap between consolidated's latest year and today's
	// calendar year is not normal reporting lag — it's a strong signal consolidated has
	// gone stale, so re-check standalone and prefer whichever is actually more current.
	const consolidatedLatestYear = latestYearNumber(years);
	const consolidatedIsStale =
		consolidatedLatestYear != null && new Date().getFullYear() - consolidatedLatestYear > 2;

	if (years.length === 0 || consolidatedIsStale) {
		const standaloneUrl = `https://www.screener.in/company/${encodeURIComponent(upper)}/`;
		const standaloneHtml = await politeFetch(standaloneUrl);
		const $standalone = cheerio.load(standaloneHtml);
		const standaloneYears = buildYears($standalone);
		const standaloneLatestYear = latestYearNumber(standaloneYears);

		const standaloneIsFresherOrOnlyOption =
			years.length === 0 ||
			(standaloneLatestYear != null &&
				(consolidatedLatestYear == null || standaloneLatestYear > consolidatedLatestYear));

		if (standaloneIsFresherOrOnlyOption && standaloneYears.length > 0) {
			// Re-source everything downstream (ratios, pros/cons, shareholding, quarters, ...)
			// from the same standalone page too, not just the P&L years — mixing a stale
			// consolidated basis with fresh standalone years would be its own inconsistency.
			$ = $standalone;
			years = standaloneYears;
			basis = consolidatedLatestYear == null ? 'standalone_only' : 'standalone';
		}
	}

	const name = $('#top h1').first().text().trim() || upper;
	const { pros, cons } = extractProsCons($);
	const { sector, industry } = extractSectorIndustry($);

	return {
		symbol: upper,
		name,
		basis,
		cmp: extractRatio($, 'Current Price'),
		marketCap: extractRatio($, 'Market Cap'),
		bookValuePerShare: extractRatio($, 'Book Value'),
		stockPE: extractRatio($, 'Stock P/E'),
		roce: extractRatio($, 'ROCE'),
		roe: extractRatio($, 'ROE'),
		dividendYield: extractRatio($, 'Dividend Yield'),
		faceValue: extractRatio($, 'Face Value'),
		sector,
		industry,
		years,
		balanceSheet: extractBalanceSheet($),
		shareholding: extractShareholding($),
		pros,
		cons,
		history: extractHistory($),
		cashConversionCycle: extractLatestRatio($, 'Cash Conversion Cycle'),
		debtorDays: extractLatestRatio($, 'Debtor Days'),
		inventoryDays: extractLatestRatio($, 'Inventory Days'),
		quarters: extractQuarters($)
	};
}

/** Single in-flight request per symbol so concurrent requests for the same company don't double-scrape. */
export function fetchCompanyFinancials(symbol: string): Promise<CompanyFinancials> {
	const key = symbol.toUpperCase();
	const existing = inFlight.get(key);
	if (existing) return existing;

	const promise = scrapeOnce(key).finally(() => inFlight.delete(key));
	inFlight.set(key, promise);
	return promise;
}
