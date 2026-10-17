// @ts-nocheck - plain JS shared with the import script (node cannot run .ts); typed by its tests.
// The breakout scanner's wider universe (valuation.mcap_universe): reading the AMFI-derived CSV,
// choosing each company's app symbol, working out what an import changes, and bucketing market
// caps. Plain JavaScript with no imports so scripts/import-mcap-universe.mjs, the server and the
// scanner page all share one copy (same pattern as lib/entryPrice.js).

/** The CSV header, exactly and in order (research/README_companies_mcap.md). Anything else fails. */
export const CSV_COLUMNS = [
	'company_name',
	'isin',
	'nse_symbol',
	'bse_code',
	'market_cap_cr',
	'mcap_source',
	'mcap_as_of',
	'listed_on',
	'angel_nse_token',
	'angel_nse_symbol',
	'angel_bse_token',
	'angel_bse_symbol',
	'bse_scrip_code',
	'price_exchange',
	'price_source_status',
	'match_method'
];

export const NO_PRICE_SOURCE = 'No price source';
const ISIN_RE = /^IN[A-Z0-9]{10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Same shape the sector manager accepts for a ticker (sectorEdit.ts SYMBOL_RE). */
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._-]{0,29}$/;

/** Splits CSV text into rows of fields. Handles quoted fields, doubled quotes and CRLF. */
export function parseCsvText(text) {
	const rows = [];
	let row = [];
	let field = '';
	let quoted = false;
	const src = text.replace(/^﻿/, '');
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (quoted) {
			if (ch === '"' && src[i + 1] === '"') {
				field += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else field += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && src[i + 1] === '\n') i++;
			row.push(field);
			field = '';
			if (row.some((f) => f !== '')) rows.push(row);
			row = [];
		} else field += ch;
	}
	row.push(field);
	if (row.some((f) => f !== '')) rows.push(row);
	return rows;
}

/** The app ticker for a company: the NSE symbol when it is priced on NSE, the BSE ticker when only
 *  BSE has it, null when Angel One has no price source. Upper-cased; null if it is not a usable ticker. */
export function chooseSymbol(row) {
	if (row.price_source_status === NO_PRICE_SOURCE) return null;
	let raw = '';
	if (row.price_exchange === 'NSE') raw = row.nse_symbol || '';
	else if (row.price_exchange === 'BSE') raw = row.angel_bse_symbol || row.bse_code || '';
	const symbol = raw.trim().toUpperCase();
	return SYMBOL_RE.test(symbol) ? symbol : null;
}

/** Reads and checks the CSV. Throws one Error listing everything wrong (header first); on success
 *  returns the rows ready to store, each with its `symbol`. When two companies would share a
 *  ticker, the NSE-priced one (then the larger market cap) keeps it and the other gets no symbol:
 *  `duplicates` lists the losers. */
export function parseUniverseCsv(text) {
	const table = parseCsvText(text);
	if (table.length === 0) throw new Error('The file is empty.');
	const header = table[0].map((h) => h.trim());
	const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
	const extra = header.filter((h) => !CSV_COLUMNS.includes(h));
	if (missing.length > 0 || extra.length > 0 || header.length !== CSV_COLUMNS.length) {
		throw new Error(
			`Unexpected header. ${missing.length ? `Missing: ${missing.join(', ')}. ` : ''}${extra.length ? `Unexpected: ${extra.join(', ')}. ` : ''}Expected: ${CSV_COLUMNS.join(',')}`
		);
	}
	const errors = [];
	const rows = [];
	const seen = new Set();
	for (let n = 1; n < table.length; n++) {
		const cells = table[n];
		const line = n + 1;
		if (cells.length !== header.length) {
			errors.push(`Line ${line}: ${cells.length} fields, expected ${header.length}.`);
			continue;
		}
		const r = Object.fromEntries(header.map((h, i) => [h, cells[i].trim()]));
		const problems = [];
		if (!ISIN_RE.test(r.isin)) problems.push(`bad ISIN "${r.isin}"`);
		else if (seen.has(r.isin)) problems.push(`duplicate ISIN ${r.isin}`);
		else seen.add(r.isin);
		if (!r.company_name) problems.push('empty company_name');
		const mcap = Number(r.market_cap_cr);
		if (!r.market_cap_cr || !Number.isFinite(mcap) || mcap <= 0) problems.push(`bad market_cap_cr "${r.market_cap_cr}"`);
		if (!DATE_RE.test(r.mcap_as_of) || Number.isNaN(Date.parse(r.mcap_as_of))) problems.push(`bad mcap_as_of "${r.mcap_as_of}"`);
		if (!['NSE', 'BSE', ''].includes(r.price_exchange)) problems.push(`bad price_exchange "${r.price_exchange}"`);
		if (!['matched', NO_PRICE_SOURCE].includes(r.price_source_status)) problems.push(`bad price_source_status "${r.price_source_status}"`);
		if (r.price_source_status === 'matched' && !r.price_exchange) problems.push('matched but no price_exchange');
		if (r.price_source_status === 'matched' && !chooseSymbol(r)) problems.push('matched but no usable ticker');
		if (problems.length > 0) {
			errors.push(`Line ${line} (${r.isin || r.company_name}): ${problems.join('; ')}.`);
			continue;
		}
		rows.push({
			isin: r.isin,
			company_name: r.company_name,
			nse_symbol: r.nse_symbol || null,
			bse_code: r.bse_code || null,
			market_cap_cr: mcap,
			mcap_as_of: r.mcap_as_of,
			listed_on: r.listed_on || null,
			angel_nse_token: r.angel_nse_token || null,
			angel_nse_symbol: r.angel_nse_symbol || null,
			angel_bse_token: r.angel_bse_token || null,
			angel_bse_symbol: r.angel_bse_symbol || null,
			bse_scrip_code: r.bse_scrip_code || null,
			price_exchange: r.price_exchange || null,
			price_source_status: r.price_source_status,
			match_method: r.match_method || null,
			symbol: chooseSymbol(r)
		});
	}
	if (errors.length > 0) {
		const shown = errors.slice(0, 15);
		throw new Error(`${errors.length} bad row(s):\n${shown.join('\n')}${errors.length > shown.length ? `\n...and ${errors.length - shown.length} more.` : ''}`);
	}
	return { rows, duplicates: resolveDuplicateSymbols(rows) };
}

/** Two companies must not share a ticker. The NSE-priced one wins, then the larger market cap
 *  (first in the file on a tie); the others lose their symbol. Mutates `rows`, returns the losers. */
export function resolveDuplicateSymbols(rows) {
	const bySymbol = new Map();
	for (const r of rows) {
		if (r.symbol) bySymbol.set(r.symbol, [...(bySymbol.get(r.symbol) ?? []), r]);
	}
	const losers = [];
	for (const group of bySymbol.values()) {
		if (group.length < 2) continue;
		const ranked = [...group].sort(
			(a, b) => Number(b.price_exchange === 'NSE') - Number(a.price_exchange === 'NSE') || b.market_cap_cr - a.market_cap_cr
		);
		for (const loser of ranked.slice(1)) {
			loser.symbol = null;
			losers.push({ isin: loser.isin, company_name: loser.company_name, kept: ranked[0].isin, symbol: ranked[0].symbol });
		}
	}
	return losers;
}

const STORED_FIELDS = CSV_COLUMNS.filter((c) => c !== 'mcap_source').concat('symbol');

const same = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : (a ?? null) === (b ?? null));

/** What importing `incoming` (parseUniverseCsv rows) over `existing` (rows already stored, any
 *  `active` state) would change, matched by ISIN. A row that comes back after being deactivated
 *  counts as updated. Rows not in the file and still active are to be deactivated. */
export function planImport(existing, incoming) {
	const stored = new Map(existing.map((r) => [r.isin, r]));
	const inFile = new Set(incoming.map((r) => r.isin));
	const toInsert = [];
	const toUpdate = [];
	let unchanged = 0;
	for (const row of incoming) {
		const old = stored.get(row.isin);
		if (!old) toInsert.push(row);
		else if (!old.active || STORED_FIELDS.some((f) => !same(row[f], old[f]))) toUpdate.push(row);
		else unchanged++;
	}
	const toDeactivate = existing.filter((r) => r.active && !inFile.has(r.isin)).map((r) => r.isin);
	const activeRows = incoming;
	return {
		toInsert,
		toUpdate,
		toDeactivate,
		counts: {
			new: toInsert.length,
			updated: toUpdate.length,
			unchanged,
			deactivated: toDeactivate.length,
			matchedNse: activeRows.filter((r) => r.symbol && r.price_exchange === 'NSE').length,
			matchedBse: activeRows.filter((r) => r.symbol && r.price_exchange === 'BSE').length,
			noPriceSource: activeRows.filter((r) => r.price_source_status === NO_PRICE_SOURCE).length,
			total: incoming.length
		}
	};
}

// ---- market cap bands -------------------------------------------------------------------

/** The scanner's market cap filter, by Rs crore. 'none' is a company that is not in the list. */
export const MCAP_BANDS = [
	{ key: 'm500', label: '500 - 2,000 Cr', min: 500, max: 2000 },
	{ key: 'm2000', label: '2,000 - 5,000 Cr', min: 2000, max: 5000 },
	{ key: 'm5000', label: '5,000 - 10,000 Cr', min: 5000, max: 10000 },
	{ key: 'm10000', label: '10,000 - 20,000 Cr', min: 10000, max: 20000 },
	{ key: 'none', label: 'Not in list', min: 0, max: 0 }
];

/** The band a market cap falls in; a lower edge belongs to the band above it (2,000 is 2,000-5,000).
 *  No cap means 'none'. Caps outside 500-20,000 (a stale row) go to the nearest end band. */
export function mcapBand(mcapCr) {
	if (mcapCr == null || !Number.isFinite(mcapCr)) return 'none';
	if (mcapCr < 2000) return 'm500';
	if (mcapCr < 5000) return 'm2000';
	if (mcapCr < 10000) return 'm5000';
	return 'm10000';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Avg mcap Jan-Jun 2026" for a six-month average ending at `asOf` (YYYY-MM-DD). */
export function mcapPeriodLabel(asOf) {
	const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(asOf ?? '');
	if (!m) return 'Avg mcap';
	const endYear = Number(m[1]);
	const endMonth = Number(m[2]) - 1;
	const startMonth = (endMonth + 7) % 12;
	const startYear = endMonth >= 5 ? endYear : endYear - 1;
	return `Avg mcap ${MONTHS[startMonth]}${startYear === endYear ? '' : ` ${startYear}`}-${MONTHS[endMonth]} ${endYear}`;
}

/** Crore amounts the way the page shows them: "8,383 Cr". */
export function formatCr(mcapCr) {
	return mcapCr == null ? '-' : `${Math.round(mcapCr).toLocaleString('en-IN')} Cr`;
}
