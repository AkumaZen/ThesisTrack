import { describe, expect, it } from 'vitest';
import { thesisCreate } from './server/schemas/thesis';
import { validateEntryDate } from './server/services/entryPrice';
import { chooseBackfill, closeOnOrBefore, formatReturn, isValidPrice, latestClose, resolveEntryPrice, returnPct } from './entryPrice.js';

const dates = ['2026-10-01', '2026-10-02', '2026-10-05'];
const closes = [100, 110, 120];

describe('closeOnOrBefore / latestClose', () => {
	it('uses the exact session when stored', () => {
		expect(closeOnOrBefore(dates, closes, '2026-10-02')).toEqual({ date: '2026-10-02', price: 110 });
	});
	it('falls back to the last session before a weekend date', () => {
		expect(closeOnOrBefore(dates, closes, '2026-10-04')).toEqual({ date: '2026-10-02', price: 110 });
	});
	it('is null before the first stored session, for empty data and for bad dates', () => {
		expect(closeOnOrBefore(dates, closes, '2026-09-30')).toBeNull();
		expect(closeOnOrBefore([], [], '2026-10-04')).toBeNull();
		expect(closeOnOrBefore(dates, closes, 'yesterday')).toBeNull();
	});
	it('skips unusable closes', () => {
		expect(closeOnOrBefore(dates, [100, 110, NaN], '2026-10-05')).toEqual({ date: '2026-10-02', price: 110 });
		expect(closeOnOrBefore(dates, [100, 110, 0], '2026-10-05')).toEqual({ date: '2026-10-02', price: 110 });
	});
	it('latestClose is the newest session', () => {
		expect(latestClose(dates, closes)).toEqual({ date: '2026-10-05', price: 120 });
	});
});

describe('returnPct / formatReturn', () => {
	it('computes gains and losses', () => {
		expect(returnPct(100, 125)).toBeCloseTo(25);
		expect(returnPct(200, 150)).toBeCloseTo(-25);
		expect(returnPct(100, 100)).toBe(0);
	});
	it('guards missing, zero and negative prices', () => {
		expect(returnPct(null, 10)).toBeNull();
		expect(returnPct(10, undefined)).toBeNull();
		expect(returnPct(0, 10)).toBeNull();
		expect(returnPct(-5, 10)).toBeNull();
		expect(returnPct(10, 0)).toBeNull();
		expect(returnPct(10, -1)).toBeNull();
		expect(returnPct(NaN, 10)).toBeNull();
		expect(returnPct(Infinity, 10)).toBeNull();
	});
	it('always spells out the sign', () => {
		expect(formatReturn(12.34)).toBe('+12.3%');
		expect(formatReturn(-4)).toBe('-4.0%');
		expect(formatReturn(0)).toBe('0.0%');
		expect(formatReturn(null)).toBe('');
	});
});

describe('required price validation', () => {
	it('accepts only finite numbers above zero', () => {
		expect(isValidPrice(1)).toBe(true);
		for (const bad of [0, -1, NaN, Infinity, '5', null, undefined]) expect(isValidPrice(bad)).toBe(false);
	});
	it('the create schema rejects zero, negative and non-numeric prices but allows none', () => {
		const base = { nse_ticker: 'ABC', name: 'Abc', classification: { broad_industry: 'a', specific_niche: 'b', operating_model: 'factory' } };
		expect(thesisCreate.safeParse({ ...base, entry_price: 0 }).success).toBe(false);
		expect(thesisCreate.safeParse({ ...base, entry_price: -3 }).success).toBe(false);
		expect(thesisCreate.safeParse({ ...base, entry_price: '12' }).success).toBe(false);
		expect(thesisCreate.safeParse({ ...base, entry_price: 12.5, entry_date: '2026-10-01' }).success).toBe(true);
		expect(thesisCreate.safeParse({ ...base, entry_date: '01/10/2026' }).success).toBe(false);
		expect(thesisCreate.safeParse(base).success).toBe(true);
	});
	it('rejects future and impossible dates', () => {
		expect(validateEntryDate('2026-10-18', '2026-10-17')).toMatch(/future/);
		expect(validateEntryDate('2026-02-31', '2026-10-17')).toMatch(/real date/);
		expect(validateEntryDate('2026-10-17', '2026-10-17')).toBeNull();
	});
});

describe('resolveEntryPrice fallback chain', () => {
	const stored = { date: '2026-10-02', price: 110 };
	it('a typed price wins over a stored one', () => {
		expect(resolveEntryPrice({ manual: 99, date: '2026-10-04', stored, listed: true })).toEqual({ ok: true, price: 99, source: 'manual', priceDate: '2026-10-04' });
	});
	it('rejects a typed price that is not above zero', () => {
		expect(resolveEntryPrice({ manual: 0, date: '2026-10-04', stored, listed: true }).ok).toBe(false);
		expect(resolveEntryPrice({ manual: -2, date: '2026-10-04', stored: null, listed: false }).ok).toBe(false);
	});
	it('without a typed price it uses the stored close and its session date', () => {
		expect(resolveEntryPrice({ date: '2026-10-04', stored, listed: true })).toEqual({ ok: true, price: 110, source: 'auto', priceDate: '2026-10-02' });
	});
	it('with nothing stored and a listed symbol it errors and says how to send entry_price', () => {
		for (const listed of [true, null]) {
			const r = resolveEntryPrice({ date: '2026-10-04', stored: null, listed });
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error).toContain('entry_price');
		}
	});
	it('a symbol with no price source is accepted as no data', () => {
		expect(resolveEntryPrice({ date: '2026-10-04', stored: null, listed: false })).toEqual({ ok: true, price: null, source: 'no_data', priceDate: null });
	});
});

describe('no_data thesis later gets a manual price', () => {
	it('a typed price is accepted for a symbol with no price source and recorded as manual', () => {
		expect(resolveEntryPrice({ manual: 321, date: '2026-10-10', stored: null, listed: false })).toEqual({ ok: true, price: 321, source: 'manual', priceDate: '2026-10-10' });
	});
});

describe('chooseBackfill ordering', () => {
	const history = { date: '2026-10-02', price: 110 };
	it('prefers the recorded buy price over history', () => {
		expect(chooseBackfill({ firstBuy: { price: 95, date: '2026-09-01' }, history })).toEqual({ price: 95, date: '2026-09-01', source: 'backfill_buy', needsPrice: false });
	});
	it('uses the stored close at creation when there is no buy', () => {
		expect(chooseBackfill({ firstBuy: null, history })).toEqual({ price: 110, date: '2026-10-02', source: 'backfill_history', needsPrice: false });
	});
	it('ignores an unusable buy price', () => {
		expect(chooseBackfill({ firstBuy: { price: 0, date: '2026-09-01' }, history }).source).toBe('backfill_history');
	});
	it('flags needs-price when nothing is available', () => {
		expect(chooseBackfill({ firstBuy: null, history: null })).toEqual({ price: null, date: null, source: null, needsPrice: true });
	});
});
