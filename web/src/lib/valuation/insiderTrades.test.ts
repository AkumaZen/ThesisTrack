import { describe, expect, it } from 'vitest';
import { holdingTimeline, insiderQuery, parseInsiderFilters, parseInsiderTrades, parseNseDay, parseSastDisclosures, sideOf, txnTypesFor } from './insiderTrades';

// Shaped like nseindia.com/api/corporates-pit and corporate-sast-reg29 (2026).
const PIT = {
	acqNameList: [],
	data: [
		{ acqMode: 'Off Market', acqName: 'BALANADU NARAYAN', acqfromDt: '13-Feb-2026', acqtoDt: '13-Feb-2026', afterAcqSharesNo: '1600', afterAcqSharesPer: '0', anex: '7(2)', befAcqSharesNo: '3920', befAcqSharesPer: '0.01', buyQuantity: '0', buyValue: '0', company: 'Reliance Industries Limited', date: '18-Feb-2026 19:06', derivativeType: '-', did: '563850', exchange: 'NA', personCategory: 'Other', secAcq: '2320', secType: 'Equity Shares', secVal: '3294168', sellValue: '0', sellquantity: '0', symbol: 'RELIANCE', tdpTransactionType: 'Sell', xbrl: 'https://nsearchives.nseindia.com/corporate/xbrl/IT_1.xml' },
		{ acqMode: 'Market Purchase', acqName: 'A PROMOTER', acqfromDt: '16-Feb-2026', acqtoDt: '17-Feb-2026', afterAcqSharesNo: '1,000,000', afterAcqSharesPer: '50.5', befAcqSharesNo: '900000', befAcqSharesPer: '49.5', company: 'Demo Ltd', date: '19-Feb-2026 10:00', did: '1', personCategory: 'Promoters', secAcq: '100,000', secType: 'Equity Shares', secVal: '25000000', symbol: 'demo', tdpTransactionType: 'Buy', xbrl: null },
		{ acqName: '-', symbol: 'X', date: '19-Feb-2026 10:00' },
		{ acqName: 'NOBODY', symbol: 'X', date: 'garbage' }
	]
};

describe('parseNseDay', () => {
	it('reads NSE dates', () => {
		expect(parseNseDay('13-Feb-2026')).toBe('2026-02-13');
		expect(parseNseDay('-')).toBeNull();
		expect(parseNseDay(null)).toBeNull();
	});
});

describe('parseInsiderTrades', () => {
	const rows = parseInsiderTrades(PIT);
	it('keeps usable rows and normalises the figures', () => {
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ nseSymbol: 'RELIANCE', personName: 'BALANADU NARAYAN', txnType: 'Sell', quantity: 2320, value: 3294168, beforePct: 0.01, afterShares: 1600, fromDate: '2026-02-13', personCategory: 'Other' });
		expect(rows[0].sourceUrl).toBe('https://nsearchives.nseindia.com/corporate/xbrl/IT_1.xml');
		expect(rows[1]).toMatchObject({ nseSymbol: 'DEMO', quantity: 100000, afterPct: 50.5, sourceUrl: null });
		expect(rows[0].broadcastAt.toISOString()).toBe('2026-02-18T13:36:00.000Z');
	});
	it('gives the same row the same key and different rows different keys', () => {
		expect(parseInsiderTrades(PIT)[0].dedupeKey).toBe(rows[0].dedupeKey);
		expect(rows[0].dedupeKey).not.toBe(rows[1].dedupeKey);
	});
	it('tolerates junk', () => {
		expect(parseInsiderTrades(null)).toEqual([]);
		expect(parseInsiderTrades({ data: 'x' })).toEqual([]);
		expect(parseInsiderTrades([null, 3])).toEqual([]);
	});
});

describe('sides', () => {
	it('maps NSE wording', () => {
		expect(sideOf('Buy')).toBe('buy');
		expect(sideOf('Sell')).toBe('sell');
		expect(sideOf('Pledge Revoke')).toBe('pledge');
		expect(sideOf('Other')).toBe('other');
		expect(txnTypesFor('pledge')).toContain('Pledge Revoke');
	});
});

describe('parseSastDisclosures', () => {
	const payload = {
		data: [
			{ acqSaleType: 'Acquisition', acqType: 'Equity shares', acquirerDate: '23-SEP-2026 to 23-SEP-2026', acquirerName: 'SUNENA GARG', acquisitionMode: 'Open Market', application_no: '179729', attachement: 'https://nsearchives.nseindia.com/corporate/SSWL.zip', company: 'Steel Strips Wheels Limited', noOfShareAcq: '100005', noOfShareAft: '5764179', noOfShareSale: null, promoterType: 'Y', regType: 'Reg29(2)', symbol: 'SSWL', timestamp: '16-Oct-2026 12:07', totAcqShare: '0.06', totAftShare: '3.66', totSaleShare: null },
			{ symbol: 'NO', acquirerName: 'X' }
		]
	};
	it('reads a filing', () => {
		const [s, ...rest] = parseSastDisclosures(payload);
		expect(rest).toHaveLength(0);
		expect(s).toMatchObject({ nseSymbol: 'SSWL', acquirerName: 'SUNENA GARG', action: 'Acquisition', isPromoter: true, sharesAcquired: 100005, sharesSold: null, pctAcquired: 0.06, pctAfter: 3.66, regulation: 'Reg29(2)' });
		expect(s.disclosedAt.toISOString()).toBe('2026-10-16T06:37:00.000Z');
	});
});

describe('filters', () => {
	it('reads values, converting lakh to rupees', () => {
		const f = parseInsiderFilters(new URLSearchParams('company=tata&person= jane  doe&category=Promoters&side=buy&minLakh=25&from=2026-02-01&page=2'));
		expect(f).toMatchObject({ company: 'tata', person: 'jane doe', category: 'Promoters', side: 'buy', minValue: 2_500_000, from: '2026-02-01', page: 2 });
		expect(insiderQuery(f)).toBe('?company=tata&person=jane+doe&category=Promoters&side=buy&minLakh=25&from=2026-02-01&page=2');
		expect(parseInsiderFilters(new URLSearchParams('category=Alien&side=x&minLakh=-4'))).toMatchObject({ category: null, side: null, minValue: null });
	});
});

describe('holdingTimeline', () => {
	it('merges insider trades and SAST filings newest first with the change in holding', () => {
		const trades = parseInsiderTrades(PIT);
		const sast = parseSastDisclosures({
			data: [{ acqSaleType: 'Disposal', acquirerName: 'FUND', symbol: 'DEMO', timestamp: '20-Feb-2026 09:00', noOfShareSale: '5000', totSaleShare: '0.5', totAftShare: '5', promoterType: 'N' }]
		});
		const t = holdingTimeline(trades.filter((r) => r.nseSymbol === 'DEMO'), sast);
		expect(t.map((e) => [e.source, e.person])).toEqual([['SAST', 'FUND'], ['PIT', 'A PROMOTER']]);
		expect(t[0]).toMatchObject({ shares: -5000, changePp: -0.5, afterPct: 5, category: 'Acquirer' });
		expect(t[1]).toMatchObject({ shares: 100000, changePp: 1, afterPct: 50.5 });
	});
});
