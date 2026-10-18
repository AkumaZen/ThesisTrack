import { describe, expect, it } from 'vitest';
import { formatQty } from './dealFormat';
import { buildDealPayload, dealKey, holdingChange, parseLargeDeals, shouldNotifyDeal } from './deals';
import { parseScreenerShareholding } from './server/shareholding';

// Shaped like nseindia.com/api/snapshot-capital-market-largedeal (2026-10-16).
const SNAPSHOT = {
	as_on_date: '16-Oct-2026',
	BULK_DEALS_DATA: [
		{ buySell: 'BUY', clientName: 'ALPHAGREP SECURITIES PRIVATE LIMITED', date: '16-Oct-2026', name: 'Aurum PropTech Limited', qty: '562862', remarks: '-', symbol: 'AURUM', watp: '254.33' },
		{ buySell: 'BUY', clientName: 'ALPHAGREP SECURITIES PRIVATE LIMITED', date: '16-Oct-2026', name: 'Aurum PropTech Limited', qty: '562862', remarks: '-', symbol: 'AURUM', watp: '254.33' }
	],
	BLOCK_DEALS_DATA: [
		{ buySell: 'SELL', clientName: 'BOFA SECURITIES EUROPE SA', date: '15-Oct-2026', name: 'ETERNAL LIMITED', qty: '5,337,584', remarks: null, symbol: 'ETERNAL', watp: '316' }
	],
	SHORT_DEALS_DATA: [{ buySell: null, clientName: null, date: '15-Oct-2026', name: '360 ONE WAM LIMITED', qty: '500', remarks: null, symbol: '360ONE', watp: null }]
};

describe('parseLargeDeals', () => {
	it('reads bulk and block deals, drops short-selling rows, and collapses exact repeats', () => {
		const deals = parseLargeDeals(SNAPSHOT);
		expect(deals).toHaveLength(2);
		expect(deals[0]).toMatchObject({ kind: 'bulk', nseSymbol: 'AURUM', dealDate: '2026-10-16', side: 'BUY', quantity: 562862, price: 254.33 });
		expect(deals[1]).toMatchObject({ kind: 'block', nseSymbol: 'ETERNAL', side: 'SELL', quantity: 5337584 });
	});
	it('tolerates junk', () => {
		expect(parseLargeDeals(null)).toEqual([]);
		expect(parseLargeDeals({ BULK_DEALS_DATA: [null, { symbol: 'X' }] })).toEqual([]);
	});
});

describe('dealKey (dedupe)', () => {
	const [a] = parseLargeDeals(SNAPSHOT);
	const { dedupeKey, ...base } = a;
	it('is stable and ignores client name case', () => {
		expect(dealKey(base)).toBe(dedupeKey);
		expect(dealKey({ ...base, clientName: base.clientName.toLowerCase() })).toBe(dedupeKey);
	});
	it('differs when quantity, price, side or day differ', () => {
		for (const change of [{ quantity: 1 }, { price: 255 }, { side: 'SELL' as const }, { dealDate: '2026-10-15' }, { kind: 'block' as const }]) {
			expect(dealKey({ ...base, ...change })).not.toBe(dedupeKey);
		}
	});
});

describe('deal alerts', () => {
	const NOW = new Date('2026-10-17T05:00:00Z');
	it('formats quantities the Indian way', () => {
		expect(formatQty(5337584)).toBe('53.4 lakh');
		expect(formatQty(12000000)).toBe('1.2 crore');
		expect(formatQty(4500)).toBe('4,500');
	});
	it('builds a push with the kind in the title', () => {
		const p = buildDealPayload({ id: 9, kind: 'block', nseSymbol: 'ETERNAL', side: 'BUY', quantity: 5337584, price: 316, clientName: 'BOFA' });
		expect(p.title).toBe('[Block deal] ETERNAL: bought 53.4 lakh shares');
		expect(p.body).toBe('BOFA bought 53.4 lakh shares at Rs 316.');
		expect(p.tag).toBe('deal-9');
	});
	it('notifies only deals first seen after tracking began and not older than 3 days', () => {
		const since = new Date('2026-10-16T00:00:00Z');
		expect(shouldNotifyDeal('2026-10-16', new Date('2026-10-16T12:00:00Z'), since, NOW)).toBe(true);
		expect(shouldNotifyDeal('2026-10-16', new Date('2026-10-15T12:00:00Z'), since, NOW)).toBe(false);
		expect(shouldNotifyDeal('2026-10-10', new Date('2026-10-16T12:00:00Z'), since, NOW)).toBe(false);
	});
});

describe('holdingChange', () => {
	it('is the point change to two decimals', () => {
		expect(holdingChange(17.24, 15.74)).toBe(1.5);
		expect(holdingChange(10.39, 10.92)).toBe(-0.53);
		expect(holdingChange(null, 1)).toBeNull();
	});
});

describe('parseScreenerShareholding', () => {
	const html = `<html><body><section id="shareholding"><table><thead><tr><th></th><th>Mar 2026</th><th>Jun 2026</th><th>Sep 2026</th></tr></thead><tbody>
		<tr><td>Promoters&nbsp;+</td><td>28.29%</td><td>28.29%</td><td>28.29%</td></tr>
		<tr><td>FIIs +</td><td>7.08%</td><td>15.74%</td><td>17.24%</td></tr>
		<tr><td>DIIs +</td><td>8.57%</td><td>10.92%</td><td>10.39%</td></tr>
		<tr><td>Public +</td><td>56.02%</td><td>45.02%</td><td>44.06%</td></tr>
		<tr><td>No. of Shareholders</td><td>8,03,693</td><td>7,32,721</td><td>7,64,828</td></tr></tbody></table></section>
		<ul><li>Promoters have pledged 73.0% of their holding.</li></ul></body></html>`;
	it('takes the last two quarters and the pledge sentence', () => {
		expect(parseScreenerShareholding(html)).toEqual({
			period: 'Sep 2026', promoters: 28.29, fiis: 17.24, diis: 10.39, public: 44.06, pledgedPct: 73,
			prevPeriod: 'Jun 2026', prevPromoters: 28.29, prevFiis: 15.74, prevDiis: 10.92, prevPublic: 45.02
		});
	});
	it('returns null when the page has no pattern, and pledge null when not mentioned', () => {
		expect(parseScreenerShareholding('<html><body>nothing</body></html>')).toBeNull();
		expect(parseScreenerShareholding(html.replace('Promoters have pledged 73.0% of their holding.', ''))?.pledgedPct).toBeNull();
	});
});
