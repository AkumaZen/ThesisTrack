// @ts-nocheck - plain JS shared with scripts/build-mcap-universe.mjs (node cannot run .ts); typed by its tests.
// Builds the market cap universe CSV (every NSE/BSE company above a market cap floor) from the AMFI
// six-month average market cap file, ISIN-verified against the exchanges' own security lists and
// Angel One's scrip master. Pure functions only: the script does the downloading and file reading.
import { parseCsvText } from './mcapUniverse.js';

export const MIN_MCAP_CR = 500;
export const MCAP_SOURCE = 'AMFI avg mcap (6m to 30-Jun-2026)';

/** Same series order as NSE_SERIES_RANK in server/angelone.ts (a test keeps the two in step). */
export const NSE_SERIES_RANK = { EQ: 0, BE: 1, SM: 2, RR: 3, IV: 3, BZ: 4 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const symText = (v) => {
	const s = typeof v === 'string' ? v.trim() : '';
	return s === '' || s === '-' ? '' : s;
};

/** One AMFI sheet row (cell values from "Company name" on: name, ISIN, BSE symbol, BSE cap, NSE
 *  symbol, NSE cap, MSEI symbol, MSEI cap) as a plain object. Caps that are not numbers ("-") are null. */
export function amfiRow(cells) {
	const [name, isin, bseSymbol, bseCr, nseSymbol, nseCr, mseiSymbol, mseiCr] = cells;
	return {
		name: String(name ?? '').trim().replace(/\s+/g, ' '),
		isin: String(isin ?? '').trim().toUpperCase(),
		bseSymbol: symText(bseSymbol),
		nseSymbol: symText(nseSymbol),
		mseiSymbol: symText(mseiSymbol),
		bseCr: isNum(bseCr) ? bseCr : null,
		nseCr: isNum(nseCr) ? nseCr : null,
		mseiCr: isNum(mseiCr) ? mseiCr : null
	};
}

/** AMFI's "Average of All Exchanges": the plain average of the exchange caps that are present
 *  (its formula is AVERAGE(E,G,I), which skips blanks). Null when no exchange has a cap. */
export function averageMcapCr(row) {
	const caps = [row.bseCr, row.nseCr, row.mseiCr].filter(isNum);
	return caps.length ? caps.reduce((a, b) => a + b, 0) / caps.length : null;
}

/** Companies strictly above `minCr`, one row per ISIN (the larger average wins a repeat), with the
 *  average attached. Rows with a cap only on MSEI (no NSE/BSE listing) are set aside, not counted. */
export function filterAboveMcap(rows, minCr = MIN_MCAP_CR) {
	const byIsin = new Map();
	const dropped = { mseiOnly: [], below: 0, repeatedIsin: [], badIsin: [] };
	for (const r of rows) {
		const avg = averageMcapCr(r);
		if (avg == null || !(avg > minCr)) {
			dropped.below++;
			continue;
		}
		if (r.bseCr == null && r.nseCr == null) {
			dropped.mseiOnly.push(r);
			continue;
		}
		if (!/^IN[A-Z0-9]{10}$/.test(r.isin)) {
			dropped.badIsin.push(r);
			continue;
		}
		const row = { ...r, mcapCr: avg };
		const prev = byIsin.get(r.isin);
		if (prev) {
			dropped.repeatedIsin.push(prev.mcapCr >= avg ? row : prev);
			if (prev.mcapCr >= avg) continue;
		}
		byIsin.set(r.isin, row);
	}
	return { kept: [...byIsin.values()], dropped };
}

// ---- exchange lists -----------------------------------------------------------------------

function headerIndex(header, ...names) {
	const norm = header.map((h) => h.trim().toUpperCase().replace(/[\s_]+/g, ' '));
	for (const n of names) {
		const i = norm.indexOf(n);
		if (i >= 0) return i;
	}
	return -1;
}

/** NSE's EQUITY_L.csv (or the SME list): ISIN -> { symbol, series, name }. Header spacing differs between
 *  the two files ("ISIN NUMBER" vs "ISIN_NUMBER"), so columns are found by name. */
export function parseNseList(text) {
	const table = parseCsvText(text);
	const out = new Map();
	if (table.length === 0) return out;
	const h = table[0];
	const iSym = headerIndex(h, 'SYMBOL');
	const iName = headerIndex(h, 'NAME OF COMPANY');
	const iSeries = headerIndex(h, 'SERIES');
	const iIsin = headerIndex(h, 'ISIN NUMBER');
	if (iSym < 0 || iSeries < 0 || iIsin < 0) throw new Error('Unexpected NSE list header: ' + h.join(','));
	for (const c of table.slice(1)) {
		const isin = (c[iIsin] ?? '').trim().toUpperCase();
		if (!/^IN[A-Z0-9]{10}$/.test(isin)) continue;
		const symbol = (c[iSym] ?? '').trim().toUpperCase();
		const series = (c[iSeries] ?? '').trim().toUpperCase();
		const prev = out.get(isin);
		const rank = (s) => NSE_SERIES_RANK[s] ?? 9;
		if (!prev || rank(series) < rank(prev.series)) out.set(isin, { isin, symbol, series, name: iName >= 0 ? (c[iName] ?? '').trim() : '' });
	}
	return out;
}

/** BSE's UDiFF equity bhavcopy (the active scrip list API is blocked for scripts): ISIN ->
 *  { code, ticker, name, volume }. The scrip code is FinInstrmId. Merging several days (see
 *  mergeBseMaps) catches scrips that did not trade on one particular day. */
export function parseBseBhavcopy(text) {
	const table = parseCsvText(text);
	const out = new Map();
	if (table.length === 0) return out;
	const h = table[0];
	const iCode = headerIndex(h, 'FININSTRMID');
	const iIsin = headerIndex(h, 'ISIN');
	const iTicker = headerIndex(h, 'TCKRSYMB');
	const iName = headerIndex(h, 'FININSTRMNM');
	const iVol = headerIndex(h, 'TTLTRADGVOL');
	if (iCode < 0 || iIsin < 0 || iTicker < 0) throw new Error('Unexpected BSE bhavcopy header: ' + h.slice(0, 12).join(','));
	for (const c of table.slice(1)) {
		const isin = (c[iIsin] ?? '').trim().toUpperCase();
		const code = (c[iCode] ?? '').trim();
		if (!/^IN[A-Z0-9]{10}$/.test(isin) || !/^\d{5,6}$/.test(code)) continue;
		const volume = Number(c[iVol]) || 0;
		const prev = out.get(isin);
		if (!prev || volume > prev.volume) out.set(isin, { isin, code, ticker: (c[iTicker] ?? '').trim().toUpperCase(), name: iName >= 0 ? (c[iName] ?? '').trim() : '', volume });
	}
	return out;
}

/** Union of several days' BSE maps; the newest map (first) wins for an ISIN present in more than one. */
export function mergeBseMaps(maps) {
	const out = new Map();
	for (const m of maps) for (const [isin, v] of m) if (!out.has(isin)) out.set(isin, v);
	return out;
}

/** Angel One scrip master lookups: the best NSE series per symbol (name), and BSE equity rows by scrip
 *  code (the BSE token is the numeric code). Same rules as buildScripIndex in server/angelone.ts. */
export function buildAngelLookups(entries) {
	const nseByName = new Map();
	const bseByCode = new Map();
	const rank = (symbol) => NSE_SERIES_RANK[symbol.split('-').pop() ?? ''] ?? -1;
	for (const e of entries) {
		if (e.exch_seg === 'NSE' && e.symbol.includes('-')) {
			const r = rank(e.symbol);
			if (r === -1) continue;
			const key = e.name.toUpperCase();
			const cur = nseByName.get(key);
			if (!cur || r < rank(cur.symbol)) nseByName.set(key, e);
		} else if (e.exch_seg === 'BSE' && !e.symbol.includes('-') && !e.instrumenttype && e.symbol === e.name) {
			bseByCode.set(String(e.token), e);
		}
	}
	return { nseByName, bseByCode };
}

// ---- mapping ------------------------------------------------------------------------------

const ABBREV = { co: 'company', corp: 'corporation', ltd: 'limited', pvt: 'private', inds: 'industries', ind: 'industries', and: '' };
const nameTokens = (s) =>
	new Set(
		s
			.toLowerCase()
			.replace(/&/g, ' ')
			.replace(/[^a-z0-9 ]/g, ' ')
			.split(' ')
			.filter(Boolean)
			.map((w) => (w in ABBREV ? ABBREV[w] : w))
			.filter((w) => w && w !== 'limited' && w !== 'company' && w !== 'the')
	);

/** Whether two company names are plausibly the same company (abbreviations like Co./Ltd. folded, at least
 *  60% of the tokens shared). Only used to accept a ticker match when the ISIN is not on the exchange lists. */
export function sameCompanyName(a, b) {
	const x = nameTokens(a);
	const y = nameTokens(b);
	if (x.size === 0 || y.size === 0) return false;
	let shared = 0;
	for (const t of x) if (y.has(t)) shared++;
	return shared / Math.max(x.size, y.size) >= 0.6;
}

/** Ticker lookups over the exchange lists (the NSE symbol and the BSE ticker identify a listing). */
export function buildListIndexes(nseList, bseMap) {
	const nseBySymbol = new Map();
	for (const v of nseList.values()) nseBySymbol.set(v.symbol, v);
	const bseByTicker = new Map();
	for (const v of bseMap.values()) if (!bseByTicker.has(v.ticker)) bseByTicker.set(v.ticker, v);
	return { nseBySymbol, bseByTicker };
}

/** One company's output row. ISIN-verified: the NSE symbol and BSE scrip code come from the exchanges' own
 *  lists by ISIN, then to Angel One tokens. AMFI can still carry a company's pre-split or pre-conversion ISIN
 *  (TD Power, Kirloskar Pneumatic): when the ISIN is on neither list but AMFI's own ticker is on a list under a
 *  matching company name, that listing is taken with the exchange's current ISIN, and match_method says
 *  'symbol+name'. NSE is the price source when Angel One has it, else BSE. */
export function mapCompany(c, lists, angel) {
	const { nseList, bseMap, nseBySymbol, bseByTicker } = lists;
	let nse = nseList.get(c.isin);
	let bse = bseMap.get(c.isin);
	let via = nse || bse ? 'isin' : '';
	if (!via) {
		const n = c.nseSymbol ? nseBySymbol.get(c.nseSymbol.toUpperCase()) : undefined;
		const b = c.bseSymbol ? bseByTicker.get(c.bseSymbol.toUpperCase()) : undefined;
		if (n && sameCompanyName(c.name, n.name)) nse = n;
		if (b && sameCompanyName(c.name, b.name)) bse = b;
		if (nse || bse) {
			via = 'symbol+name';
			if (nse && !bse) bse = bseMap.get(nse.isin);
			if (bse && !nse) nse = nseList.get(bse.isin);
		}
	}
	const isin = nse?.isin ?? bse?.isin ?? c.isin;
	const aNse = nse ? angel.nseByName.get(nse.symbol) : undefined;
	const aBse = bse ? angel.bseByCode.get(bse.code) : undefined;
	const priceExchange = aNse ? 'NSE' : aBse ? 'BSE' : '';
	const listedOn = c.bseCr != null && c.nseCr != null ? 'Both' : c.nseCr != null ? 'NSE' : 'BSE';
	return {
		company_name: c.name,
		isin,
		nse_symbol: nse?.symbol ?? '',
		bse_code: aBse?.symbol ?? bse?.ticker ?? '',
		market_cap_cr: c.mcapCr.toFixed(2),
		mcap_source: MCAP_SOURCE,
		mcap_as_of: '2026-06-30',
		listed_on: listedOn,
		angel_nse_token: aNse?.token ?? '',
		angel_nse_symbol: aNse?.symbol ?? '',
		angel_bse_token: aBse?.token ?? '',
		angel_bse_symbol: aBse?.symbol ?? '',
		bse_scrip_code: bse?.code ?? '',
		price_exchange: priceExchange,
		price_source_status: priceExchange ? 'matched' : 'No price source',
		match_method: priceExchange ? via : '',
		_inNseList: Boolean(nse),
		_inBseList: Boolean(bse),
		_amfiIsin: c.isin,
		_amfiNse: c.nseSymbol,
		_amfiBse: c.bseSymbol
	};
}

// ---- REITs and InvITs ---------------------------------------------------------------------

/** REIT and InvIT units are trusts, not companies. NSE puts them in the RR and IV series (which Angel One keeps
 *  in the symbol suffix), their ISIN carries the units type code 25, and their names say REIT, InvIT or
 *  "<Real Estate | Infrastructure | Realty> Trust".
 *  Plain company names that merely contain "Trust" (Master Trust Ltd., The Investment Trust of India) do not match. */
const TRUST_NAME = /\bREIT\b|\bInvIT\b|Real Estate (Investment )?Trust|Infrastructure (Investment )?Trust|Realty Trust/i;
/** An ISIN's two-digit instrument type (characters 8-9) is 25 for REIT/InvIT units and 01 for equity shares. */
const TRUST_ISIN = /^IN[A-Z][A-Z0-9]{4}25[A-Z0-9]{3}$/;
export function isTrustUnit(name, angelNseSymbol = '', isin = '') {
	return TRUST_NAME.test(name) || /-(RR|IV)$/.test(angelNseSymbol) || TRUST_ISIN.test(isin);
}

// ---- one company, one row -----------------------------------------------------------------

const normName = (s) =>
	s
		.toLowerCase()
		.replace(/&/g, 'and')
		.replace(/[^a-z0-9 ]/g, ' ')
		.split(' ')
		.filter(Boolean)
		.filter((w, i, a) => !(i === a.length - 1 && (w === 'limited' || w === 'ltd')))
		.join(' ');

/** The same company can hold two ISINs (a face value split, a re-ISIN'd share, a DVR class). Rows are grouped
 *  when their normalised names are equal, or when they share an AMFI ticker and the same first word of the name.
 *  Per group the row that is on an exchange list, then NSE-priced, then larger wins. Returns the kept rows and
 *  one record per dropped row (with the row it lost to) for the report. */
export function dedupeCompanies(rows) {
	const parent = rows.map((_, i) => i);
	const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	const union = (a, b) => (parent[find(a)] = find(b));
	const byName = new Map();
	const bySymbol = new Map();
	rows.forEach((r, i) => {
		const n = normName(r.company_name);
		if (byName.has(n)) union(i, byName.get(n));
		else byName.set(n, i);
		const first = n.split(' ')[0];
		for (const s of new Set([r._amfiNse, r._amfiBse].filter(Boolean))) {
			const key = `${s}|${first}`;
			if (bySymbol.has(key)) union(i, bySymbol.get(key));
			else bySymbol.set(key, i);
		}
	});
	const groups = new Map();
	rows.forEach((r, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), r]));
	const kept = [];
	const dropped = [];
	const score = (r) => [Number(r._inNseList || r._inBseList), Number(r.price_exchange === 'NSE'), Number(r.market_cap_cr)];
	for (const g of groups.values()) {
		if (g.length === 1) {
			kept.push(g[0]);
			continue;
		}
		const ranked = [...g].sort((a, b) => {
			const sa = score(a);
			const sb = score(b);
			return sb[0] - sa[0] || sb[1] - sa[1] || sb[2] - sa[2];
		});
		kept.push(ranked[0]);
		for (const r of ranked.slice(1)) dropped.push({ isin: r._amfiIsin ?? r.isin, company_name: r.company_name, market_cap_cr: r.market_cap_cr, keptIsin: ranked[0].isin, keptName: ranked[0].company_name });
	}
	const order = new Map(rows.map((r, i) => [r.isin, i]));
	kept.sort((a, b) => Number(b.market_cap_cr) - Number(a.market_cap_cr) || order.get(a.isin) - order.get(b.isin));
	return { kept, dropped };
}

/** The whole build: filter, map by ISIN, dedupe. Returns the rows (CSV order, without the private fields)
 *  and a report of what was dropped and what has no price source. */
export function buildUniverseRows(amfiRows, nseList, bseMap, angel, minCr = MIN_MCAP_CR) {
	const { kept, dropped } = filterAboveMcap(amfiRows, minCr);
	const lists = { nseList, bseMap, ...buildListIndexes(nseList, bseMap) };
	const allMapped = kept.map((c) => mapCompany(c, lists, angel));
	const trusts = allMapped.filter((r) => isTrustUnit(r.company_name, r.angel_nse_symbol, r.isin));
	const mapped = allMapped.filter((r) => !trusts.includes(r));
	const { kept: unique, dropped: duplicates } = dedupeCompanies(mapped);
	const rows = unique.map(({ _inNseList, _inBseList, _amfiIsin, _amfiNse, _amfiBse, ...r }) => r);
	const reIsined = unique.filter((r) => r._amfiIsin !== r.isin).map((r) => ({ company_name: r.company_name, amfiIsin: r._amfiIsin, isin: r.isin, symbol: r.nse_symbol || r.angel_bse_symbol }));
	return {
		rows,
		report: {
			total: rows.length,
			nsePriced: rows.filter((r) => r.price_exchange === 'NSE').length,
			bsePriced: rows.filter((r) => r.price_exchange === 'BSE').length,
			unmatched: rows.filter((r) => !r.price_exchange).map((r) => ({ isin: r.isin, company_name: r.company_name, market_cap_cr: r.market_cap_cr })),
			duplicates,
			trusts: trusts.map((r) => ({ isin: r.isin, company_name: r.company_name, market_cap_cr: r.market_cap_cr })),
			reIsined,
			dropped
		}
	};
}

const csvField = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV text in the column order the importer expects. */
export function rowsToCsv(rows, columns) {
	return [columns.join(','), ...rows.map((r) => columns.map((c) => csvField(String(r[c] ?? ''))).join(','))].join('\n') + '\n';
}
