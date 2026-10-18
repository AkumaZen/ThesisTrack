import { describe, expect, it } from 'vitest';
import { buildResultsRow, filterResults, quarterOptions, sortResults, type ResultsCompany } from './quarterlyResults';

const q = (label: string, sales: number | null, netProfit: number | null, opmPct: number | null) => ({
	label,
	sales,
	netProfit,
	opmPct
});

const company = (over: Partial<ResultsCompany> = {}): ResultsCompany => ({
	symbol: 'AAA',
	name: 'Alpha Ltd',
	industry: 'Chemicals',
	sector: 'Materials',
	baskets: ['Specialty Chemicals'],
	quarters: [
		q('Jun 2025', 100, 10, 20),
		q('Sep 2025', 110, 12, 21),
		q('Dec 2025', 120, 14, 22),
		q('Mar 2026', 130, 15, 23),
		q('Jun 2026', 150, 20, 25)
	],
	...over
});

describe('buildResultsRow', () => {
	it('compares the latest quarter with a year earlier and the quarter before', () => {
		const r = buildResultsRow(company())!;
		expect(r.quarter).toBe('Jun 2026');
		expect(r.salesYoY).toBeCloseTo(50, 6);
		expect(r.salesQoQ).toBeCloseTo((150 / 130 - 1) * 100, 6);
		expect(r.profitYoY).toBeCloseTo(100, 6);
		expect(r.profitQoQ).toBeCloseTo((20 / 15 - 1) * 100, 6);
		expect(r.opm).toBe(25);
		expect(r.opmYoYPp).toBe(5);
		expect(r.opmQoQPp).toBe(2);
	});

	it('leaves a comparison blank when the quarter is not there', () => {
		const r = buildResultsRow(company({ quarters: [q('Mar 2026', 130, 15, 23), q('Jun 2026', 150, 20, 25)] }))!;
		expect(r.salesQoQ).toBeCloseTo((150 / 130 - 1) * 100, 6);
		expect(r.salesYoY).toBeNull();
		expect(r.opmYoYPp).toBeNull();
	});

	it('does not invent growth off a zero or negative base', () => {
		const r = buildResultsRow(company({ quarters: [q('Jun 2025', 100, -5, 20), q('Jun 2026', 150, 20, 25)] }))!;
		expect(r.profitYoY).toBeNull();
		expect(r.salesYoY).toBeCloseTo(50, 6);
	});

	it('is null with no usable quarters', () => {
		expect(buildResultsRow(company({ quarters: [] }))).toBeNull();
		expect(buildResultsRow(company({ quarters: null }))).toBeNull();
		expect(buildResultsRow(company({ quarters: [q('TTM', 1, 1, 1)] }))).toBeNull();
	});
});

describe('filter, sort and quarters', () => {
	const rows = [
		buildResultsRow(company())!,
		buildResultsRow(
			company({
				symbol: 'BBB',
				name: 'Beta Banks',
				industry: 'Banks',
				baskets: [],
				quarters: [q('Mar 2025', 10, 1, null), q('Mar 2026', 12, 2, null)]
			})
		)!,
		buildResultsRow(company({ symbol: 'CCC', name: 'Gamma', quarters: [q('Jun 2026', 5, 1, 10)] }))!
	];
	const none = { query: '', industry: '', basket: '', symbols: null, quarter: '' };

	it('filters by search, industry, basket, watchlist and quarter', () => {
		expect(filterResults(rows, { ...none, query: 'beta' }).map((r) => r.symbol)).toEqual(['BBB']);
		expect(filterResults(rows, { ...none, industry: 'Chemicals' }).map((r) => r.symbol)).toEqual(['AAA', 'CCC']);
		expect(filterResults(rows, { ...none, basket: 'Specialty Chemicals' }).map((r) => r.symbol)).toEqual(['AAA', 'CCC']);
		expect(filterResults(rows, { ...none, symbols: new Set(['CCC']) }).map((r) => r.symbol)).toEqual(['CCC']);
		expect(filterResults(rows, { ...none, quarter: 'Mar 2026' }).map((r) => r.symbol)).toEqual(['BBB']);
	});

	it('sorts with blanks last in both directions', () => {
		expect(sortResults(rows, 'opm', -1).map((r) => r.symbol)).toEqual(['AAA', 'CCC', 'BBB']);
		expect(sortResults(rows, 'opm', 1).map((r) => r.symbol)).toEqual(['CCC', 'AAA', 'BBB']);
		expect(sortResults(rows, 'quarter', -1)[2].symbol).toBe('BBB');
	});

	it('lists quarters newest first with counts', () => {
		expect(quarterOptions(rows)).toEqual([
			{ label: 'Jun 2026', count: 2 },
			{ label: 'Mar 2026', count: 1 }
		]);
	});
});
