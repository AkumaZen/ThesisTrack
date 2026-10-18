import { describe, expect, it } from 'vitest';
import { aggregateSectorEarnings, isThinCoverage } from './sectorEarnings';

const q = (label: string, sales: number | null, netProfit: number | null) => ({ label, sales, netProfit });

/** Five consecutive quarters ending Jun 2026. */
const five = (base: number, profit: number) => [
	q('Jun 2025', base, profit),
	q('Sep 2025', base + 10, profit + 1),
	q('Dec 2025', base + 20, profit + 2),
	q('Mar 2026', base + 30, profit + 3),
	q('Jun 2026', base * 2, profit * 2)
];

describe('aggregateSectorEarnings', () => {
	it('sums members per quarter and computes YoY on the same members', () => {
		const e = aggregateSectorEarnings({ A: five(100, 10), B: five(200, 20) }, 2);
		expect(e.coveredMembers).toBe(2);
		expect(e.quarters.map((x) => x.label)).toEqual(['Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026']);
		const last = e.quarters[4];
		expect(last.sales).toBe(600);
		expect(last.netProfit).toBe(60);
		expect(last.reporting).toBe(2);
		expect(last.yoyMembers).toBe(2);
		expect(last.salesYoY).toBeCloseTo(100);
		expect(last.profitYoY).toBeCloseTo(100);
		// The oldest quarters have no year-ago quarter stored: no YoY, not a made-up one.
		expect(e.quarters[0].salesYoY).toBeNull();
		expect(e.quarters[0].yoyMembers).toBe(0);
	});

	it('keeps growth on matched members when one member has not reported the latest quarter', () => {
		const late = five(200, 20).slice(0, 4); // no Jun 2026 yet
		const e = aggregateSectorEarnings({ A: five(100, 10), B: late }, 2);
		const last = e.quarters[4];
		expect(last.reporting).toBe(1);
		expect(last.sales).toBe(200);
		// Only A is behind the YoY: 200 vs 100, not 200 vs 300.
		expect(last.yoyMembers).toBe(1);
		expect(last.salesYoY).toBeCloseTo(100);
	});

	it('reports coverage: members with no stored quarters are not counted as covered', () => {
		const e = aggregateSectorEarnings({ A: five(100, 10), B: null, C: [], D: undefined }, 4);
		expect(e.totalMembers).toBe(4);
		expect(e.coveredMembers).toBe(1);
		expect(isThinCoverage(e)).toBe(true);
		expect(isThinCoverage(aggregateSectorEarnings({ A: five(1, 1), B: five(1, 1), C: null }, 3))).toBe(false);
	});

	it('returns no quarters when nothing is stored', () => {
		const e = aggregateSectorEarnings({ A: null, B: [] }, 2);
		expect(e.quarters).toEqual([]);
		expect(e.coveredMembers).toBe(0);
		expect(aggregateSectorEarnings({}, 0).quarters).toEqual([]);
		expect(isThinCoverage(aggregateSectorEarnings({}, 0))).toBe(false);
	});

	it('skips quarters missing a figure or with an unreadable label', () => {
		const e = aggregateSectorEarnings(
			{ A: [q('Jun 2025', 100, 10), q('Sep 2025', null, 5), q('FY26', 1, 1)] },
			1
		);
		expect(e.quarters.map((x) => x.label)).toEqual(['Jun 2025']);
	});

	it('leaves profit growth empty when the year-ago total is not positive', () => {
		const rows = [q('Jun 2025', 100, -5), q('Sep 2025', 1, 1), q('Dec 2025', 1, 1), q('Mar 2026', 1, 1), q('Jun 2026', 120, 8)];
		const last = aggregateSectorEarnings({ A: rows }, 1).quarters[4];
		expect(last.salesYoY).toBeCloseTo(20);
		expect(last.profitYoY).toBeNull();
	});

	it('keeps only the latest maxQuarters quarters', () => {
		const rows = Array.from({ length: 12 }, (_, i) =>
			q(`${['Mar', 'Jun', 'Sep', 'Dec'][i % 4]} ${2023 + Math.floor(i / 4)}`, 100 + i, 10)
		);
		// Mar 2023, Jun 2023, ... ordering by calendar month, not array position
		const e = aggregateSectorEarnings({ A: rows }, 1, 8);
		expect(e.quarters).toHaveLength(8);
		expect(e.quarters[7].label).toBe('Dec 2025');
		expect(e.quarters[7].salesYoY).not.toBeNull();
	});
});
