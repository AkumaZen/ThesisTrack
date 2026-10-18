import { describe, expect, it } from 'vitest';
import {
	buildHoldingPayload,
	buildPriceAlertPayload,
	describePriceRule,
	evaluatePriceAlert,
	holdingChanges,
	isNewHoldingPeriod,
	triggerPrice,
	validateHoldingSettings,
	validatePriceAlert,
	type HoldingSnapshot
} from './alertRules';

describe('evaluatePriceAlert', () => {
	it('fires on a level at or beyond it, and not before', () => {
		expect(evaluatePriceAlert({ kind: 'above', threshold: 100, basePrice: null }, 100)).toBe(true);
		expect(evaluatePriceAlert({ kind: 'above', threshold: 100, basePrice: null }, 99.99)).toBe(false);
		expect(evaluatePriceAlert({ kind: 'below', threshold: 100, basePrice: null }, 100)).toBe(true);
		expect(evaluatePriceAlert({ kind: 'below', threshold: 100, basePrice: null }, 100.5)).toBe(false);
	});
	it('measures a percentage move from the base price', () => {
		const up = { kind: 'pct_up' as const, threshold: 10, basePrice: 200 };
		expect(triggerPrice(up)).toBe(220);
		expect(evaluatePriceAlert(up, 219.9)).toBe(false);
		expect(evaluatePriceAlert(up, 220)).toBe(true);
		const down = { kind: 'pct_down' as const, threshold: 5, basePrice: 200 };
		expect(triggerPrice(down)).toBe(190);
		expect(evaluatePriceAlert(down, 190)).toBe(true);
		expect(evaluatePriceAlert(down, 191)).toBe(false);
	});
	it('never fires without a usable price or base', () => {
		expect(evaluatePriceAlert({ kind: 'above', threshold: 1, basePrice: null }, null)).toBe(false);
		expect(evaluatePriceAlert({ kind: 'above', threshold: 1, basePrice: null }, 0)).toBe(false);
		expect(evaluatePriceAlert({ kind: 'pct_up', threshold: 1, basePrice: null }, 500)).toBe(false);
	});
});

describe('validatePriceAlert', () => {
	it('accepts a level and records the stored price', () => {
		expect(validatePriceAlert({ symbol: ' tcs ', kind: 'above', threshold: '4200.456' }, 4000)).toEqual({
			ok: true,
			value: { nseSymbol: 'TCS', kind: 'above', threshold: 4200.46, basePrice: 4000 }
		});
	});
	it('needs a stored price for a % move and rejects nonsense', () => {
		expect(validatePriceAlert({ symbol: 'TCS', kind: 'pct_up', threshold: 5 }, null)).toMatchObject({ ok: false });
		expect(validatePriceAlert({ symbol: 'TCS', kind: 'pct_up', threshold: 5 }, 100)).toMatchObject({ ok: true, value: { basePrice: 100 } });
		for (const body of [
			{ symbol: '', kind: 'above', threshold: 1 },
			{ symbol: 'TCS', kind: 'sideways', threshold: 1 },
			{ symbol: 'TCS', kind: 'above', threshold: 0 },
			{ symbol: 'TCS', kind: 'above', threshold: 'abc' },
			{ symbol: 'TCS', kind: 'pct_down', threshold: 100 },
			{ symbol: 'TCS', kind: 'pct_up', threshold: 101 },
			null
		]) {
			expect(validatePriceAlert(body, 100).ok).toBe(false);
		}
	});
});

describe('payloads', () => {
	it('words a price alert and links to the company', () => {
		const p = buildPriceAlertPayload({ id: 7, nseSymbol: 'TCS', kind: 'above', threshold: 4200, basePrice: 4000 }, 4210.5);
		expect(p.title).toBe('TCS: Rs 4,210.50');
		expect(p.body).toContain('rose to or above Rs 4,200.00');
		expect(p.url).toBe('/valuation/company/TCS');
		expect(p.tag).toBe('price-alert-7');
		expect(describePriceRule({ kind: 'pct_down', threshold: 5, basePrice: 200 })).toBe('Down 5% from Rs 200.00 (Rs 190.00)');
	});
});

describe('holding alerts', () => {
	const snap: HoldingSnapshot = { period: 'Sep 2026', prevPeriod: 'Jun 2026', promoters: 49, prevPromoters: 50.1, fiis: 12, prevFiis: 11, diis: 8.5, prevDiis: 8 };
	it('reports only groups beyond their own threshold, in either direction', () => {
		expect(holdingChanges({ promoterPp: 1, fiiPp: 1, diiPp: 1 }, snap)).toEqual([
			{ group: 'Promoter', from: 50.1, to: 49, change: -1.1 },
			{ group: 'FII', from: 11, to: 12, change: 1 }
		]);
		expect(holdingChanges({ promoterPp: null, fiiPp: 2, diiPp: null }, snap)).toEqual([]);
		expect(holdingChanges({ promoterPp: 0.5, fiiPp: null, diiPp: 0.5 }, { ...snap, prevPromoters: null }).map((c) => c.group)).toEqual(['DII']);
	});
	it('validates settings; empty means off', () => {
		expect(validateHoldingSettings({ promoterPp: '1.5', fiiPp: '', diiPp: null })).toEqual({ ok: true, value: { promoterPp: 1.5, fiiPp: null, diiPp: null } });
		expect(validateHoldingSettings({ promoterPp: 0 }).ok).toBe(false);
		expect(validateHoldingSettings({ fiiPp: 99 }).ok).toBe(false);
	});
	it('only a new quarter after a stored one counts', () => {
		expect(isNewHoldingPeriod(null, 'Sep 2026')).toBe(false);
		expect(isNewHoldingPeriod('Sep 2026', 'Sep 2026')).toBe(false);
		expect(isNewHoldingPeriod('Jun 2026', 'Sep 2026')).toBe(true);
	});
	it('words the message', () => {
		const p = buildHoldingPayload('ABC', snap, holdingChanges({ promoterPp: 1, fiiPp: null, diiPp: null }, snap));
		expect(p.title).toBe('ABC: shareholding changed');
		expect(p.body).toBe('Sep 2026 vs Jun 2026: Promoter 50.10% to 49.00% (-1.10 pts).');
		expect(p.tag).toBe('holding-ABC-Sep 2026');
	});
});
