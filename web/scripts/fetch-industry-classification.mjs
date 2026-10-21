// Fetches NSE's 4-level industry classification (macro > sector > industry > basic industry) for
// every company in research/companies_mcap_above_500cr.csv, via the breadcrumb in the Peers section
// of each Screener company page (titles there: Broad Sector, Sector, Broad Industry, Industry =
// NSE macro, sector, industry, basic industry). Read-only; resumable through a JSONL cache.
// Usage: node web/scripts/fetch-industry-classification.mjs [cacheFile]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INPUT = path.join(root, 'research/companies_mcap_above_500cr.csv');
const OUTPUT = path.join(root, 'research/universe_industry_classification.csv');
const SUMMARY = path.join(root, 'research/universe_industry_summary.md');
const CACHE = process.argv[2] ?? path.join(root, 'research/.industry-cache.jsonl');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const GAP_MS = 1000;
const MAX_RETRIES = 6;
const SOURCE = 'screener_peers_breadcrumb';
const COLS = ['isin', 'nse_symbol', 'bse_code', 'company_name', 'market_cap_cr', 'macro', 'sector', 'industry', 'basic_industry', 'source', 'fetched_at'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseCsv(text) {
	const rows = [];
	let row = [], cell = '', q = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (q) {
			if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
			else if (c === '"') q = false;
			else cell += c;
		} else if (c === '"') q = true;
		else if (c === ',') { row.push(cell); cell = ''; }
		else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(cell); cell = '';
			if (row.length > 1 || row[0] !== '') rows.push(row);
			row = [];
		} else cell += c;
	}
	if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
	const [head, ...body] = rows;
	return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const csvCell = (v) => {
	const s = String(v ?? '');
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (o) => COLS.map((c) => csvCell(o[c])).join(',');

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

function parseBreadcrumb(html) {
	const at = html.indexOf('id="peers"');
	if (at < 0) return null;
	const out = {};
	const re = /<a\s+href="(\/market\/[^"]*)"[^>]*title="(Broad Sector|Sector|Broad Industry|Industry)"[^>]*>([^<]*)<\/a>/g;
	const peers = html.slice(at);
	let m;
	while ((m = re.exec(peers)) && Object.keys(out).length < 4) out[m[2]] = decode(m[3]);
	if (!out['Broad Sector'] || !out.Industry) return null;
	return {
		macro: out['Broad Sector'],
		sector: out.Sector ?? '',
		industry: out['Broad Industry'] ?? '',
		basic_industry: out.Industry
	};
}

let nextAt = 0;
async function fetchPage(slug) {
	const url = `https://www.screener.in/company/${encodeURIComponent(slug)}/`;
	for (let attempt = 0; ; attempt++) {
		const wait = nextAt - Date.now();
		if (wait > 0) await sleep(wait);
		nextAt = Date.now() + GAP_MS;
		let res;
		try { res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } }); }
		catch (e) { if (attempt >= MAX_RETRIES) throw e; await sleep(2000 * 2 ** attempt); continue; }
		if (res.status === 404) return { notFound: true };
		if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
			const ra = Number(res.headers.get('retry-after'));
			const backoff = ra > 0 ? ra * 1000 : 5000 * 2 ** attempt;
			nextAt = Date.now() + backoff;
			console.log(`  ${res.status} on ${slug}, backing off ${Math.round(backoff / 1000)}s`);
			continue;
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return { html: await res.text() };
	}
}

const universe = parseCsv(fs.readFileSync(INPUT, 'utf8'));
const cache = new Map();
if (fs.existsSync(CACHE)) {
	for (const line of fs.readFileSync(CACHE, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		try { const r = JSON.parse(line); cache.set(r.isin, r); } catch { /* partial last line */ }
	}
}
const keyOf = (c) => c.nse_symbol || c.bse_scrip_code || c.bse_code;

// Output is rebuilt from the cache every few rows so downstream readers can use it while we run.
function writeOutput() {
	const lines = [COLS.join(',')];
	for (const c of universe) {
		const r = cache.get(c.isin);
		if (!r || !r.ok) continue;
		lines.push(csvLine({ ...c, ...r }));
	}
	fs.writeFileSync(OUTPUT + '.tmp', lines.join('\n') + '\n');
	fs.renameSync(OUTPUT + '.tmp', OUTPUT);
}

const todo = universe.filter((c) => !cache.get(c.isin)?.ok);
console.log(`universe ${universe.length}, cached ok ${universe.length - todo.length}, to fetch ${todo.length}`);
let n = 0;
for (const c of todo) {
	const slug = keyOf(c);
	let rec;
	try {
		const p = await fetchPage(slug);
		const parsed = p.html ? parseBreadcrumb(p.html) : null;
		rec = parsed
			? { isin: c.isin, ok: true, ...parsed, source: SOURCE, fetched_at: new Date().toISOString() }
			: { isin: c.isin, ok: false, error: p.notFound ? 'not found' : 'no breadcrumb' };
	} catch (e) {
		rec = { isin: c.isin, ok: false, error: String(e.message ?? e) };
	}
	cache.set(c.isin, rec);
	fs.appendFileSync(CACHE, JSON.stringify(rec) + '\n');
	if (++n % 25 === 0) { writeOutput(); console.log(`${n}/${todo.length}`); }
}
writeOutput();

const ok = universe.filter((c) => cache.get(c.isin)?.ok).map((c) => ({ ...c, ...cache.get(c.isin), mc: Number(c.market_cap_cr) || 0 }));
const failed = universe.filter((c) => !cache.get(c.isin)?.ok);
const group = (key) => {
	const m = new Map();
	for (const r of ok) { const k = key(r); const g = m.get(k) ?? { n: 0, mc: 0 }; g.n++; g.mc += r.mc; m.set(k, g); }
	return [...m].sort((a, b) => b[1].n - a[1].n || b[1].mc - a[1].mc);
};
const table = (title, rows) => [`## ${title}`, '', '| Name | Companies | Combined mcap (Rs cr) |', '|---|---|---|',
	...rows.map(([k, g]) => `| ${k} | ${g.n} | ${Math.round(g.mc).toLocaleString('en-IN')} |`), ''].join('\n');
const md = [
	'# Universe industry classification summary', '',
	`Source: ${SOURCE} (NSE 4-level classification as shown by Screener). Generated ${new Date().toISOString()}.`, '',
	`Coverage: ${ok.length} of ${universe.length} companies (${((ok.length / universe.length) * 100).toFixed(1)}%). Failed: ${failed.length}.`, '',
	table('Per macro', group((r) => r.macro)),
	table('Per sector', group((r) => `${r.macro} > ${r.sector}`)),
	table('Per basic industry', group((r) => `${r.macro} > ${r.sector} > ${r.industry} > ${r.basic_industry}`)),
	'## Failed', '',
	...(failed.length ? failed.map((c) => `- ${c.company_name} (${keyOf(c)}): ${cache.get(c.isin)?.error ?? 'not fetched'}`) : ['None']), ''
].join('\n');
fs.writeFileSync(SUMMARY, md);
console.log(`done: ok ${ok.length}, failed ${failed.length}`);