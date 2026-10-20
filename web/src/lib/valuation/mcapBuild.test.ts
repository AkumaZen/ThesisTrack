import { describe, expect, it } from 'vitest';
import {
	amfiRow,
	averageMcapCr,
	buildAngelLookups,
	buildListIndexes,
	buildUniverseRows,
	dedupeCompanies,
	filterAboveMcap,
	mapCompany,
	mergeBseMaps,
	NSE_SERIES_RANK,
	parseBseBhavcopy,
	parseNseList,
	isTrustUnit,
	sameCompanyName
} from './mcapBuild.js';
import { buildScripIndex, type ScripEntry } from './server/angelone';

// amfiRow cells: name, isin, bse symbol, bse cap, nse symbol, nse cap, msei symbol, msei cap
const amfi = (
	name: string,
	isin: string,
	bse: [string, number | string],
	nse: [string, number | string],
	msei: [string, number | string] = ['-', '-']
) => amfiRow([name, isin, bse[0], bse[1], nse[0], nse[1], msei[0], msei[1]]);

describe('averageMcapCr and filterAboveMcap', () => {
	it('averages the exchange caps that are present, like AMFI AVERAGE(E,G,I)', () => {
		expect(averageMcapCr(amfi('A', 'INE000A01010', ['A', 1000], ['A', 2000]))).toBe(1500);
		expect(averageMcapCr(amfi('A', 'INE000A01010', ['-', '-'], ['A', 700]))).toBe(700);
		expect(averageMcapCr(amfi('A', 'INE000A01010', ['-', '-'], ['-', '-']))).toBeNull();
	});

	it('keeps strictly above 500, sets aside MSEI-only rows, and has no upper bound', () => {
		const { kept, dropped } = filterAboveMcap([
			amfi('Exactly', 'INE000A01010', ['X', 500], ['X', 500]),
			amfi('Just over', 'INE000B01010', ['Y', 500.01], ['-', '-']),
			amfi('Huge', 'INE000C01010', ['H', 1873294], ['H', 1873278]),
			amfi('Msei only', 'INE000D01010', ['-', '-'], ['-', '-'], ['M', 900]),
			amfi('Small', 'INE000E01010', ['S', 100], ['S', 100])
		]);
		expect(kept.map((r) => r.name)).toEqual(['Just over', 'Huge']);
		expect(dropped.mseiOnly.map((r: { name: string }) => r.name)).toEqual(['Msei only']);
	});

	it('keeps one row per ISIN (the larger average) and rejects malformed ISINs', () => {
		const { kept, dropped } = filterAboveMcap([
			amfi('First', 'INE000A01010', ['A', 600], ['A', 600]),
			amfi('Again', 'INE000A01010', ['A', 900], ['A', 900]),
			amfi('Bad', 'XX000A01010', ['B', 900], ['B', 900])
		]);
		expect(kept.map((r) => [r.name, r.mcapCr])).toEqual([['Again', 900]]);
		expect(dropped.repeatedIsin.map((r: { name: string }) => r.name)).toEqual(['First']);
		expect(dropped.badIsin.map((r: { name: string }) => r.name)).toEqual(['Bad']);
	});
});

describe('exchange list parsers', () => {
	const NSE = `SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
ABC,Abc Limited,BE,01-JAN-2000,1,1,INE111A01011,1
ABC,Abc Limited,EQ,01-JAN-2000,1,1,INE111A01011,1
XYZ,"Xyz, Inc Limited",EQ,01-JAN-2001,1,1,INE222B01012,1
`;
	it('reads the NSE list by header name and prefers EQ over BE for an ISIN', () => {
		const m = parseNseList(NSE);
		expect(m.get('INE111A01011')).toMatchObject({ symbol: 'ABC', series: 'EQ', isin: 'INE111A01011' });
		expect(m.get('INE222B01012')?.name).toBe('Xyz, Inc Limited');
	});

	it('reads the SME list header too', () => {
		const m = parseNseList(
			'SYMBOL,NAME_OF_COMPANY,SERIES,DATE_OF_LISTING,PAID_UP_VALUE,ISIN_NUMBER,FACE_VALUE,\nSMEX,Sme X Limited,ST,12-Oct-26,10,INE2O2Y01016,10,\n'
		);
		expect(m.get('INE2O2Y01016')).toMatchObject({ symbol: 'SMEX', series: 'ST' });
	});

	it('rejects a list with unknown columns', () => {
		expect(() => parseNseList('A,B,C\n1,2,3\n')).toThrow(/Unexpected NSE list header/);
	});

	const bhav = (rows: string[][]) =>
		['TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,FinInstrmNm,TtlTradgVol', ...rows.map((r) => r.join(','))].join('\n');

	it('reads the BSE bhavcopy: ISIN to numeric scrip code, ticker, name; skips rows without a valid ISIN or code', () => {
		const m = parseBseBhavcopy(
			bhav([
				['d', 'd', 'CM', 'BSE', 'STK', '500002', 'INE117A01022', 'ABB', 'A', 'ABB INDIA LIMITED', '100'],
				['d', 'd', 'CM', 'BSE', 'STK', '700001', '', 'NOISIN', 'A', 'No ISIN', '1'],
				['d', 'd', 'CM', 'BSE', 'STK', 'ABCD', 'INE333C01013', 'BADCODE', 'A', 'Bad code', '1']
			])
		);
		expect([...m.keys()]).toEqual(['INE117A01022']);
		expect(m.get('INE117A01022')).toMatchObject({ code: '500002', ticker: 'ABB' });
	});

	it('merges days with the first (newest) map winning', () => {
		const a = new Map([['INE1', { code: '1' }]]);
		const b = new Map([
			['INE1', { code: '2' }],
			['INE2', { code: '3' }]
		]);
		const m = mergeBseMaps([a, b] as never);
		expect([m.get('INE1'), m.get('INE2')]).toEqual([{ code: '1' }, { code: '3' }]);
	});
});

describe('Angel lookups', () => {
	const entry = (exch_seg: string, symbol: string, token: string, name = symbol.replace(/-[A-Z]+$/, ''), instrumenttype = ''): ScripEntry => ({
		exch_seg,
		symbol,
		name,
		token,
		instrumenttype
	});
	const entries = [
		entry('NSE', 'ZED-BE', '1'),
		entry('NSE', 'ZED-EQ', '2'),
		entry('NSE', 'SMEX-SM', '3'),
		entry('NSE', 'ABC26OCTFUT', '4', 'ABC', 'FUTSTK'),
		entry('BSE', 'ZED', '500001'),
		entry('BSE', 'BONDO', '500002', 'BONDO', 'GS'),
		entry('BSE', 'ZED-X', '500003', 'ZED')
	];

	it('ranks NSE series like the app resolver and takes BSE equity rows by scrip code', () => {
		const l = buildAngelLookups(entries);
		expect(l.nseByName.get('ZED')?.token).toBe('2');
		expect(l.nseByName.get('SMEX')?.token).toBe('3');
		expect(l.nseByName.has('ABC')).toBe(false);
		expect([...l.bseByCode.keys()]).toEqual(['500001']);
	});

	it('agrees with buildScripIndex for every NSE symbol (same series ranking)', () => {
		const l = buildAngelLookups(entries);
		const idx = buildScripIndex(entries);
		for (const [name, e] of l.nseByName) expect(idx.get(name)?.token).toBe(e.token);
		expect(Object.keys(NSE_SERIES_RANK)).toEqual(['EQ', 'BE', 'SM', 'RR', 'IV', 'BZ']);
	});
});

describe('ISIN mapping and dedupe', () => {
	const HEAD = 'SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE\n';
	const NSE = parseNseList(
		HEAD +
			'TDP,TD Power Systems Limited,EQ,x,1,1,INE419M01035,1\nBOTH,Both Co Limited,EQ,x,1,1,INE500A01010,1\nNOTOKEN,No Token Limited,EQ,x,1,1,INE600A01010,1\n'
	);
	const bseRow = (isin: string, code: string, ticker: string, name: string) => [isin, { isin, code, ticker, name, volume: 1 }] as const;
	const BSE = new Map([
		bseRow('INE419M01035', '533553', 'TDP', 'T D POWER SYSTEMS LTD.'),
		bseRow('INE500A01010', '500500', 'BOTH', 'BOTH CO LTD'),
		bseRow('INE700A01010', '544001', 'BSEONLY', 'BSE ONLY LIMITED')
	]);
	const e = (exch_seg: string, symbol: string, token: string, name = symbol.replace(/-[A-Z]+$/, '')) => ({
		exch_seg,
		symbol,
		name,
		token,
		instrumenttype: ''
	});
	const angel = buildAngelLookups([e('NSE', 'TDP-EQ', '10'), e('NSE', 'BOTH-EQ', '20'), e('BSE', 'BOTH', '500500'), e('BSE', 'BSEONLY', '544001'), e('BSE', 'TDP', '533553')]);
	const lists = { nseList: NSE, bseMap: BSE, ...buildListIndexes(NSE, BSE) };

	it('prefers the NSE price source when Angel has it, else BSE, else none', () => {
		const rows = filterAboveMcap([
			amfi('Both Co Ltd', 'INE500A01010', ['BOTH', 1000], ['BOTH', 1000]),
			amfi('BSE Only Limited', 'INE700A01010', ['BSEONLY', 800], ['-', '-']),
			amfi('No Token Ltd', 'INE600A01010', ['-', '-'], ['NOTOKEN', 900]),
			amfi('Ghost Ltd', 'INE900A01010', ['GHOST', 700], ['-', '-'])
		]).kept.map((c) => mapCompany(c, lists, angel));
		expect(rows.map((r) => [r.isin, r.price_exchange, r.price_source_status, r.match_method])).toEqual([
			['INE500A01010', 'NSE', 'matched', 'isin'],
			['INE700A01010', 'BSE', 'matched', 'isin'],
			['INE600A01010', '', 'No price source', ''],
			['INE900A01010', '', 'No price source', '']
		]);
		expect(rows[0]).toMatchObject({
			nse_symbol: 'BOTH',
			angel_nse_token: '20',
			angel_nse_symbol: 'BOTH-EQ',
			angel_bse_token: '500500',
			bse_scrip_code: '500500',
			listed_on: 'Both'
		});
		expect(rows[1]).toMatchObject({ nse_symbol: '', angel_bse_token: '544001', angel_bse_symbol: 'BSEONLY', listed_on: 'BSE' });
	});

	it('takes the exchange ISIN when AMFI carries a stale one but ticker and name agree', () => {
		const c = filterAboveMcap([amfi('TD Power Systems Ltd', 'INE419M01027', ['TDP', 1000], ['TDP', 1000])]).kept[0];
		expect(mapCompany(c, lists, angel)).toMatchObject({
			isin: 'INE419M01035',
			price_exchange: 'NSE',
			match_method: 'symbol+name',
			bse_scrip_code: '533553'
		});
	});

	it('does not accept a ticker whose company name differs', () => {
		const c = filterAboveMcap([amfi('Totally Different Industries', 'INE419M01027', ['TDP', 1000], ['TDP', 1000])]).kept[0];
		expect(mapCompany(c, lists, angel)).toMatchObject({ price_exchange: '', price_source_status: 'No price source' });
	});

	it('sameCompanyName folds Co./Ltd. and rejects other companies', () => {
		expect(sameCompanyName('Kirloskar Pneumatic Co.Ltd.', 'Kirloskar Pneumatic Company Limited')).toBe(true);
		expect(sameCompanyName('J.B. Chemicals & Pharmaceuticals Lt', 'Totally Other Limited')).toBe(false);
	});

	it('keeps one row for a company holding two ISINs, preferring the listed one, and reports the loser', () => {
		const { rows, report } = buildUniverseRows(
			[
				amfi('Jash Engineering Ltd.', 'INE039O01011', ['-', '-'], ['JASH', 2569]),
				amfi('JASH ENGINEERING LIMITED', 'INE039O01029', ['JASH', 2575], ['-', '-']),
				amfi('Other Co Ltd', 'INE111A01011', ['OTH', 900], ['-', '-'])
			],
			parseNseList(HEAD + 'JASH,Jash Engineering Limited,EQ,x,2,1,INE039O01029,2\n'),
			new Map([bseRow('INE039O01029', '544402', 'JASH', 'JASH ENGINEERING LIMITED')]),
			buildAngelLookups([e('NSE', 'JASH-EQ', '13982'), e('BSE', 'JASH', '544402')])
		);
		expect(rows.map((r) => r.isin).sort()).toEqual(['INE039O01029', 'INE111A01011']);
		expect(report.duplicates).toHaveLength(1);
		expect(report.duplicates[0]).toMatchObject({ isin: 'INE039O01011', keptIsin: 'INE039O01029' });
		expect(report).toMatchObject({ total: 2, nsePriced: 1, bsePriced: 0 });
		expect(report.unmatched.map((u) => u.isin)).toEqual(['INE111A01011']);
	});

	it('does not merge different companies that merely share a first word', () => {
		const a = { company_name: 'Tata Power Ltd', isin: 'INE1', _amfiNse: 'TATAPOWER', _amfiBse: '', _inNseList: true, price_exchange: 'NSE', market_cap_cr: '10' };
		const b = { company_name: 'Tata Steel Ltd', isin: 'INE2', _amfiNse: 'TATASTEEL', _amfiBse: '', _inNseList: true, price_exchange: 'NSE', market_cap_cr: '20' };
		expect(dedupeCompanies([a, b] as never).dropped).toEqual([]);
	});
});

describe('REIT and InvIT units are not companies', () => {
	it('catches the trusts by name, series suffix or ISIN unit code, and keeps real companies', () => {
		for (const [name, sym, isin] of [
			['EMBASSY OFFICE PARKS REIT', '', 'INE041025011'],
			['Nexus Select Trust', '', 'INE0NDH25011'],
			['Brookfield India Real Estate Trust', '', 'INE0FDU25010'],
			['Knowledge Realty Trust', '', 'INE1JAR25012'],
			['Some Roads InvIT', '', 'INE000A23014'],
			['Highways Infrastructure Trust', '', 'INE000A01010'],
			['Unit Co', 'UNITCO-RR', 'INE000A01010'],
			['Unit Co', 'UNITCO-IV', 'INE000A01010']
		])
			expect(isTrustUnit(name, sym, isin), name + sym).toBe(true);
		for (const [name, sym, isin] of [
			['Master Trust Ltd.', 'MASTERTR-EQ', 'INE677D01037'],
			['THE INVESTMENT TRUST OF INDIA LIMITED', 'THEINVEST-EQ', 'INE924D01017'],
			['Reitzel India Limited', 'REITZEL-EQ', 'INE000A01010'],
			['Reliance Industries Ltd', 'RELIANCE-EQ', 'INE002A01018']
		])
			expect(isTrustUnit(name, sym, isin), name).toBe(false);
	});

	it('leaves trusts out of the built universe and reports them', () => {
		const e = (exch_seg: string, symbol: string, token: string) => ({ exch_seg, symbol, name: symbol.replace(/-[A-Z]+$/, ''), token, instrumenttype: '' });
		const { rows, report } = buildUniverseRows(
			[
				amfi('Mindspace Business Parks REIT', 'INE0CCU25019', ['MINDSPACE', 30449], ['-', '-']),
				amfi('Plain Co Ltd', 'INE111A01011', ['PLAIN', 900], ['-', '-'])
			],
			new Map(),
			new Map([
				['INE0CCU25019', { isin: 'INE0CCU25019', code: '543000', ticker: 'MINDSPACE', name: 'MINDSPACE', volume: 1 }],
				['INE111A01011', { isin: 'INE111A01011', code: '500111', ticker: 'PLAIN', name: 'PLAIN', volume: 1 }]
			]),
			buildAngelLookups([e('BSE', 'MINDSPACE', '543000'), e('BSE', 'PLAIN', '500111')])
		);
		expect(rows.map((r) => r.isin)).toEqual(['INE111A01011']);
		expect(report.trusts.map((t) => t.isin)).toEqual(['INE0CCU25019']);
	});
});
