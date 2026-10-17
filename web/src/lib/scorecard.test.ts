import { describe, expect, it } from 'vitest';
import { buildRow, computeScorecard, daysBetween, niftyReturn, stats, type ScorecardInput } from './scorecard';

const nifty = {
	dates: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'],
	closes: [20000, 21000, 22000, 24000]
};

function input(over: Partial<ScorecardInput> = {}): ScorecardInput {
	return {
		id: 1,
		companyId: 'AAA',
		companyName: 'Aaa Ltd',
		sector: 'Auto',
		owner: 'asha',
		conviction: 3,
		outcome: 'played_out',
		entryDate: '2026-01-01',
		entryPrice: 100,
		needsPrice: false,
		entryPriceSource: 'manual',
		exitDate: '2026-03-01',
		sellPrice: 130,
		current: { date: '2026-04-01', price: 150 },
		series: null,
		killFired: false,
		lesson: null,
		...over
	};
}

describe('niftyReturn over the holding window', () => {
	it('measures between the two session closes', () => {
		expect(niftyReturn(nifty, '2026-01-01', '2026-03-01')).toBeCloseTo(10);
	});
	it('uses the last session on or before a non-trading date', () => {
		expect(niftyReturn(nifty, '2026-01-15', '2026-03-20')).toBeCloseTo(10);
	});
	it('is null when history does not reach the entry date or is missing', () => {
		expect(niftyReturn(nifty, '2025-12-01', '2026-03-01')).toBeNull();
		expect(niftyReturn(null, '2026-01-01', '2026-03-01')).toBeNull();
	});
});

describe('buildRow', () => {
	it('closed thesis: return at the sell price, vs Nifty in points, holding days', () => {
		const r = buildRow(input(), nifty);
		expect(r.returnPct).toBeCloseTo(30);
		expect(r.niftyPct).toBeCloseTo(10);
		expect(r.vsNifty).toBeCloseTo(20);
		expect(r.holdDays).toBe(59);
		expect(r.endSource).toBe('sell_decision');
	});
	it('closed thesis without a sell prices the exit from the stored close on or before the exit date', () => {
		const r = buildRow(input({ sellPrice: null, series: { dates: ['2026-02-27', '2026-03-02'], closes: [90, 95] } }), nifty);
		expect(r.endPrice).toBe(90);
		expect(r.endSource).toBe('stored_close');
		expect(r.returnPct).toBeCloseTo(-10);
	});
	it('closed thesis with no exit price is excluded', () => {
		expect(buildRow(input({ sellPrice: null }), nifty).excluded).toBe('no_exit_price');
	});
	it('open thesis gets a paper return at the latest stored close', () => {
		const r = buildRow(input({ outcome: 'open', exitDate: null, sellPrice: null }), nifty);
		expect(r.closed).toBe(false);
		expect(r.returnPct).toBeCloseTo(50);
		expect(r.endSource).toBe('latest_close');
		expect(r.niftyPct).toBeCloseTo(20);
	});
	it('excludes unpriced theses from the maths', () => {
		expect(buildRow(input({ entryPrice: null, needsPrice: true, entryPriceSource: null }), nifty).excluded).toBe('no_entry_price');
		expect(buildRow(input({ entryPrice: null, entryPriceSource: 'no_data' }), nifty).excluded).toBe('no_data');
		expect(buildRow(input({ entryPrice: 0 }), nifty).returnPct).toBeNull();
		expect(buildRow(input({ outcome: 'open', current: null }), nifty).excluded).toBe('no_current_price');
	});
	it('vs Nifty is null when Nifty history is missing, but the return stands', () => {
		const r = buildRow(input(), null);
		expect(r.returnPct).toBeCloseTo(30);
		expect(r.vsNifty).toBeNull();
	});
});

describe('daysBetween', () => {
	it('counts days and rejects reversed or bad dates', () => {
		expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
		expect(daysBetween('2026-02-01', '2026-01-01')).toBeNull();
		expect(daysBetween('x', '2026-01-01')).toBeNull();
	});
});

describe('computeScorecard', () => {
	const set: ScorecardInput[] = [
		input({ id: 1, sellPrice: 130, conviction: 5 }), // +30, 59 days
		input({ id: 2, sellPrice: 80, conviction: 5, owner: 'ben', outcome: 'invalidated', killFired: true, current: { date: '2026-04-01', price: 60 } }), // -20, held -40
		input({ id: 3, sellPrice: 110, conviction: null, owner: 'ben', sector: 'Power' }), // +10
		input({ id: 4, outcome: 'open', exitDate: null, sellPrice: null }), // open +50
		input({ id: 5, entryPrice: null, needsPrice: true, entryPriceSource: null }),
		input({ id: 6, entryPrice: null, entryPriceSource: 'no_data', companyId: 'GUJGASLTD' })
	];
	const sc = computeScorecard(set, nifty);

	it('headline uses closed theses only', () => {
		expect(sc.headline.count).toBe(3);
		expect(sc.headline.wins).toBe(2);
		expect(sc.headline.hitRate).toBeCloseTo(66.67, 1);
		expect(sc.headline.avgReturn).toBeCloseTo(6.67, 1);
		expect(sc.headline.avgVsNifty).toBeCloseTo(-3.33, 1);
		expect(sc.headline.avgHoldDays).toBe(59);
		expect(sc.open.count).toBe(1);
	});
	it('a flat 0.0% is not a win', () => {
		const flat = buildRow(input({ sellPrice: 100 }), nifty);
		expect(stats([flat]).hitRate).toBe(0);
	});
	it('per analyst', () => {
		const ben = sc.byAnalyst.find((a) => a.owner === 'ben')!;
		expect(ben.closed.count).toBe(2);
		expect(ben.closed.hitRate).toBe(50);
		expect(sc.byAnalyst.find((a) => a.owner === 'asha')!.openCount).toBe(1);
	});
	it('conviction buckets', () => {
		const five = sc.byConviction.find((b) => b.key === 'Conviction 5')!;
		expect(five.stats.count).toBe(2);
		expect(five.stats.avgReturn).toBeCloseTo(5);
		expect(sc.byConviction.find((b) => b.key === 'Not rated')!.stats.count).toBe(1);
	});
	it('kill-trigger estimate compares return at exit with return if held to today', () => {
		expect(sc.killTriggers).toHaveLength(1);
		expect(sc.killTriggers[0].atExit).toBeCloseTo(-20);
		expect(sc.killTriggers[0].ifHeld).toBeCloseTo(-40);
		expect(sc.killTriggers[0].difference).toBeCloseTo(20);
	});
	it('best and worst never overlap', () => {
		expect(sc.best.map((r) => r.id)).toEqual([1, 3, 2]);
		expect(sc.worst).toHaveLength(0);
	});
	it('sector grouping', () => {
		expect(sc.bySector.map((s) => s.key).sort()).toEqual(['Auto', 'Power']);
	});
	it('lists unpriced theses and keeps them out of every figure', () => {
		expect(sc.withoutEntryPrice.map((w) => w.id).sort()).toEqual([5, 6]);
		expect(sc.rows.find((r) => r.id === 5)!.returnPct).toBeNull();
		expect(sc.headline.count + sc.open.count).toBe(4);
	});
	it('worst shows distinct calls once there are six', () => {
		const many = Array.from({ length: 6 }, (_, i) => input({ id: 10 + i, sellPrice: 100 + i * 10 }));
		const s = computeScorecard(many, nifty);
		expect(s.best.map((r) => r.id)).toEqual([15, 14, 13]);
		expect(s.worst.map((r) => r.id)).toEqual([10, 11, 12]);
	});
	it('lessons are newest first and closed only', () => {
		const s = computeScorecard(
			[
				input({ id: 1, exitDate: '2026-02-01', lesson: 'old' }),
				input({ id: 2, exitDate: '2026-03-01', lesson: ' new ' }),
				input({ id: 3, outcome: 'open', exitDate: null, lesson: 'ignored' })
			],
			nifty
		);
		expect(s.lessons.map((l) => l.lesson)).toEqual(['new', 'old']);
	});
	it('empty input is safe', () => {
		const s = computeScorecard([], null);
		expect(s.headline.hitRate).toBeNull();
		expect(s.best).toEqual([]);
	});
});
