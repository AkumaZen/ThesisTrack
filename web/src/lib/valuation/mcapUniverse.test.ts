import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
	CSV_COLUMNS,
	MCAP_BANDS,
	chooseSymbol,
	formatCr,
	mcapBand,
	mcapPeriodLabel,
	parseCsvText,
	parseUniverseCsv,
	planImport
} from './mcapUniverse.js';
import { buildScripIndex, type ScripEntry } from './server/angelone';
import { SCANNER_MCAP_KEYS } from '../viewMemory';

const HEADER = CSV_COLUMNS.join(',');

/** One CSV line from named fields; anything not given is blank. */
function line(f: Record<string, string>): string {
	const base: Record<string, string> = {
		company_name: 'Acme Ltd.',
		isin: 'INE000A01010',
		market_cap_cr: '1000.5',
		mcap_source: 'AMFI avg mcap (6m to 30-Jun-2026)',
		mcap_as_of: '2026-06-30',
		listed_on: 'Both',
		price_source_status: 'matched',
		match_method: 'symbol',
		...f
	};
	return CSV_COLUMNS.map((c) => (/[",]/.test(base[c] ?? '') ? `"${base[c].replace(/"/g, '""')}"` : (base[c] ?? ''))).join(',');
}
const nseRow = (f: Record<string, string> = {}) =>
	line({ nse_symbol: 'ACME', bse_code: 'ACME', angel_nse_token: '11', angel_nse_symbol: 'ACME-EQ', price_exchange: 'NSE', ...f });
const bseRow = (f: Record<string, string> = {}) =>
	line({ isin: 'INE000B01010', bse_code: 'BONDO', angel_bse_token: '500001', angel_bse_symbol: 'BONDO', bse_scrip_code: '500001', price_exchange: 'BSE', listed_on: 'BSE', ...f });
const noneRow = (f: Record<string, string> = {}) =>
	line({ isin: 'INE000C01010', company_name: 'Ghost Ltd.', nse_symbol: 'GHOST', price_exchange: '', price_source_status: 'No price source', match_method: 'none', ...f });
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('parseCsvText', () => {
	it('handles quoted commas, doubled quotes, CRLF and a BOM', () => {
		expect(parseCsvText('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
			['a', 'b'],
			['x, y', 'say "hi"']
		]);
	});
});

describe('parseUniverseCsv', () => {
	it('reads rows and chooses their symbols', () => {
		const { rows, duplicates } = parseUniverseCsv(csv(nseRow(), bseRow(), noneRow()));
		expect(rows.map((r) => [r.isin, r.symbol, r.price_exchange])).toEqual([
			['INE000A01010', 'ACME', 'NSE'],
			['INE000B01010', 'BONDO', 'BSE'],
			['INE000C01010', null, null]
		]);
		expect(rows[0].market_cap_cr).toBe(1000.5);
		expect(duplicates).toEqual([]);
	});

	it('fails loudly on an unexpected or missing column', () => {
		expect(() => parseUniverseCsv([`${HEADER},surprise`, nseRow() + ',x'].join('\n'))).toThrow(/Unexpected: surprise/);
		expect(() => parseUniverseCsv([HEADER.replace('isin,', ''), 'x'].join('\n'))).toThrow(/Missing: isin/);
		expect(() => parseUniverseCsv('')).toThrow(/empty/);
	});

	it('rejects bad rows and names them', () => {
		expect(() => parseUniverseCsv(csv(nseRow({ isin: 'nope' })))).toThrow(/bad ISIN/);
		expect(() => parseUniverseCsv(csv(nseRow({ market_cap_cr: 'abc' })))).toThrow(/market_cap_cr/);
		expect(() => parseUniverseCsv(csv(nseRow({ mcap_as_of: '30/06/2026' })))).toThrow(/mcap_as_of/);
		expect(() => parseUniverseCsv(csv(nseRow({ price_exchange: 'MSEI' })))).toThrow(/price_exchange/);
		expect(() => parseUniverseCsv(csv(nseRow(), nseRow()))).toThrow(/duplicate ISIN/);
		expect(() => parseUniverseCsv(csv(nseRow({ nse_symbol: '' })))).toThrow(/no usable ticker/);
	});

	it('lets the NSE-priced company keep a shared ticker', () => {
		const { rows, duplicates } = parseUniverseCsv(
			csv(
				bseRow({ isin: 'INE000D01010', company_name: 'Jash New', angel_bse_symbol: 'JASH', bse_code: 'JASH', market_cap_cr: '2574.81' }),
				nseRow({ isin: 'INE000E01010', company_name: 'Jash Old', nse_symbol: 'JASH', market_cap_cr: '2569.24' })
			)
		);
		expect(rows.map((r) => r.symbol)).toEqual([null, 'JASH']);
		expect(duplicates).toEqual([{ isin: 'INE000D01010', company_name: 'Jash New', kept: 'INE000E01010', symbol: 'JASH' }]);
	});

	const real = path.resolve(__dirname, '../../../../research/companies_mcap_500_20000cr.csv');
	it.skipIf(!fs.existsSync(real))('reads the AMFI file: 1,496 companies, 14 without a price source', () => {
		const { rows } = parseUniverseCsv(fs.readFileSync(real, 'utf8'));
		expect(rows).toHaveLength(1496);
		expect(rows.filter((r) => r.price_source_status === 'No price source')).toHaveLength(14);
		expect(rows.filter((r) => r.symbol === null && r.price_source_status === 'matched')).toHaveLength(1); // JASH twin
	});
});

describe('chooseSymbol', () => {
	it('uses the NSE symbol when priced on NSE, the BSE ticker when only BSE, none otherwise', () => {
		expect(chooseSymbol({ price_exchange: 'NSE', nse_symbol: 'tcs', price_source_status: 'matched' })).toBe('TCS');
		expect(chooseSymbol({ price_exchange: 'BSE', nse_symbol: '', angel_bse_symbol: 'KAMAHOLD', price_source_status: 'matched' })).toBe('KAMAHOLD');
		expect(chooseSymbol({ price_exchange: 'BSE', bse_code: 'ABC', price_source_status: 'matched' })).toBe('ABC');
		expect(chooseSymbol({ price_exchange: '', nse_symbol: 'GHOST', price_source_status: 'No price source' })).toBeNull();
		// A company with an NSE symbol on file but no price source never gets a symbol.
		expect(chooseSymbol({ price_exchange: 'NSE', nse_symbol: 'X', price_source_status: 'No price source' })).toBeNull();
	});
	it('keeps symbols with & and punctuation, drops unusable ones', () => {
		expect(chooseSymbol({ price_exchange: 'NSE', nse_symbol: 'M&M', price_source_status: 'matched' })).toBe('M&M');
		expect(chooseSymbol({ price_exchange: 'NSE', nse_symbol: 'a b', price_source_status: 'matched' })).toBeNull();
	});
});

describe('BSE-only companies price through the existing resolver', () => {
	const entry = (exch_seg: string, symbol: string, token: string, name = symbol): ScripEntry => ({ exch_seg, symbol, name, token, instrumenttype: '' });

	it('finds the BSE listing by the BSE ticker, and the NSE one by the NSE symbol', () => {
		const { rows } = parseUniverseCsv(csv(nseRow(), bseRow()));
		const index = buildScripIndex([
			entry('NSE', 'ACME-EQ', '11', 'ACME'),
			entry('BSE', 'ACME', '500000'),
			entry('BSE', 'BONDO', '500001')
		]);
		const nse = index.get(rows[0].symbol!);
		const bse = index.get(rows[1].symbol!);
		expect(nse).toMatchObject({ exch_seg: 'NSE', token: '11' });
		// BSE-only: no NSE listing, so the resolver falls back to the BSE equity row the table's token also names.
		expect(bse).toMatchObject({ exch_seg: 'BSE', token: '500001' });
		expect(bse?.token).toBe(rows[1].angel_bse_token);
	});

	it('leaves a company with no price source out of the index lookups entirely', () => {
		const { rows } = parseUniverseCsv(csv(noneRow()));
		expect(rows[0].symbol).toBeNull();
	});
});

describe('planImport', () => {
	const mk = (over: Record<string, unknown> = {}) => ({
		isin: 'INE000A01010',
		company_name: 'Acme Ltd.',
		nse_symbol: 'ACME',
		bse_code: 'ACME',
		market_cap_cr: 1000.5,
		mcap_as_of: '2026-06-30',
		listed_on: 'Both',
		angel_nse_token: '11',
		angel_nse_symbol: 'ACME-EQ',
		angel_bse_token: null,
		angel_bse_symbol: null,
		bse_scrip_code: null,
		price_exchange: 'NSE',
		price_source_status: 'matched',
		match_method: 'symbol',
		symbol: 'ACME',
		active: true,
		...over
	});

	it('counts new rows on a first load', () => {
		const { rows } = parseUniverseCsv(csv(nseRow(), bseRow(), noneRow()));
		const plan = planImport([], rows);
		expect(plan.counts).toMatchObject({ new: 3, updated: 0, unchanged: 0, deactivated: 0, matchedNse: 1, matchedBse: 1, noPriceSource: 1, total: 3 });
	});

	it('is idempotent: a second run over the same file changes nothing', () => {
		const { rows } = parseUniverseCsv(csv(nseRow(), bseRow(), noneRow()));
		const stored = rows.map((r) => ({ ...r, active: true, market_cap_cr: String(r.market_cap_cr) }));
		const plan = planImport(stored, rows);
		expect(plan.counts).toMatchObject({ new: 0, updated: 0, unchanged: 3, deactivated: 0 });
	});

	it('updates changed rows, deactivates rows missing from the file, and reactivates returners', () => {
		const incoming = parseUniverseCsv(csv(nseRow({ market_cap_cr: '1200' }), bseRow())).rows;
		const existing = [
			mk(), // changed cap
			mk({ isin: 'INE000B01010', company_name: 'Bondo', nse_symbol: null, bse_code: 'BONDO', symbol: 'BONDO', price_exchange: 'BSE', angel_bse_token: '500001', angel_bse_symbol: 'BONDO', bse_scrip_code: '500001', listed_on: 'BSE', market_cap_cr: 1000.5, active: false }), // back after being dropped
			mk({ isin: 'INE000Z01010', company_name: 'Gone', symbol: 'GONE' }), // not in the file
			mk({ isin: 'INE000Y01010', company_name: 'Already gone', symbol: null, active: false }) // stays inactive, not counted again
		];
		const plan = planImport(existing, incoming);
		expect(plan.toUpdate.map((r) => r.isin).sort()).toEqual(['INE000A01010', 'INE000B01010']);
		expect(plan.toDeactivate).toEqual(['INE000Z01010']);
		expect(plan.counts).toMatchObject({ new: 0, updated: 2, deactivated: 1 });
	});

	it('treats a numeric string from the database as equal to the file value', () => {
		const incoming = parseUniverseCsv(csv(nseRow({ market_cap_cr: '1000.50' }))).rows;
		expect(planImport([mk({ market_cap_cr: '1000.50' })], incoming).counts.unchanged).toBe(1);
	});
});

describe('market cap bands', () => {
	it('puts each cap in its band, a lower edge in the band above', () => {
		expect(mcapBand(500.01)).toBe('m500');
		expect(mcapBand(1999.99)).toBe('m500');
		expect(mcapBand(2000)).toBe('m2000');
		expect(mcapBand(4999.99)).toBe('m2000');
		expect(mcapBand(5000)).toBe('m5000');
		expect(mcapBand(9999.99)).toBe('m5000');
		expect(mcapBand(10000)).toBe('m10000');
		expect(mcapBand(19974.07)).toBe('m10000');
	});
	it('files a company with no cap under Not in list', () => {
		expect(mcapBand(null)).toBe('none');
		expect(mcapBand(undefined)).toBe('none');
	});
	it('matches the keys the scanner remembers', () => {
		expect(['all', ...MCAP_BANDS.map((b) => b.key)]).toEqual([...SCANNER_MCAP_KEYS]);
	});
});

describe('labels', () => {
	it('names the six-month period ending at the as-of date', () => {
		expect(mcapPeriodLabel('2026-06-30')).toBe('Avg mcap Jan-Jun 2026');
		expect(mcapPeriodLabel('2025-12-31')).toBe('Avg mcap Jul-Dec 2025');
		expect(mcapPeriodLabel('2026-03-31')).toBe('Avg mcap Oct 2025-Mar 2026');
		expect(mcapPeriodLabel('')).toBe('Avg mcap');
	});
	it('formats crore amounts', () => {
		expect(formatCr(8383.09)).toBe('8,383 Cr');
		expect(formatCr(undefined)).toBe('-');
	});
});
