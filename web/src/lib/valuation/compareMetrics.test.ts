import { describe, expect, it } from 'vitest';
import {
	buildCatalog,
	formatValue,
	metricRuns,
	moveMetric,
	periodIndex,
	shownMetrics,
	unitFor,
	valueAt,
	yearColumns,
	type CatalogEntry,
	type CompareStatements
} from './compareMetrics';

function company(overrides: Partial<CompareStatements> = {}): CompareStatements {
	return {
		symbol: 'ABC',
		name: 'Abc Ltd',
		basis: 'consolidated',
		fetchedAt: 0,
		sections: [
			{
				id: 'mkt',
				labels: [],
				rows: [{ key: 'mkt:Current Price', label: 'Current Price', parent: null, unit: 'rs', values: [504] }]
			},
			{
				id: 'pl',
				labels: ['Mar 2024', 'Mar 2025', 'Mar 2026', 'TTM'],
				rows: [{ key: 'pl:Sales', label: 'Sales', parent: null, unit: 'cr', values: [900, 1107, 1175, 1200] }]
			},
			{
				id: 'bs',
				labels: ['Mar 2025', 'Mar 2026'],
				rows: [
					{ key: 'bs:Other Assets', label: 'Other Assets', parent: null, unit: 'cr', values: [652, 1027] },
					{
						key: 'bs:Other Assets>Inventories',
						label: 'Inventories',
						parent: 'Other Assets',
						unit: 'cr',
						values: [98, 145]
					}
				]
			},
			{
				id: 'sh',
				labels: ['Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026'],
				rows: [
					{
						key: 'sh:Promoters',
						label: 'Promoters',
						parent: null,
						unit: 'pct',
						values: [55, 54.8, 54.4, 54.39, 53.51]
					}
				]
			}
		],
		...overrides
	};
}

describe('compareMetrics', () => {
	it('picks the latest completed years and skips TTM', () => {
		expect(yearColumns(company(), 2)).toEqual(['Mar 2025', 'Mar 2026']);
		expect(yearColumns(company(), 5)).toEqual(['Mar 2024', 'Mar 2025', 'Mar 2026']);
	});

	it('reads annual values by year and market values regardless of year', () => {
		const c = company();
		expect(valueAt(c, 'pl:Sales', 'Mar 2025')).toBe(1107);
		expect(valueAt(c, 'bs:Other Assets>Inventories', 'Mar 2026')).toBe(145);
		expect(valueAt(c, 'mkt:Current Price', 'now')).toBe(504);
		expect(valueAt(c, 'pl:Sales', 'Mar 2020')).toBeNull();
		expect(valueAt(c, 'pl:Missing', 'Mar 2026')).toBeNull();
	});

	it('aligns quarterly shareholding to the year end, not the newest quarter', () => {
		const c = company();
		expect(valueAt(c, 'sh:Promoters', 'Mar 2026')).toBe(54.39);
		// No quarter within the year ending Mar 2025 is reported.
		expect(valueAt(c, 'sh:Promoters', 'Mar 2025')).toBeNull();
	});

	it('builds one catalog in section order and keeps sub-rows beside their parent', () => {
		const other = company({
			symbol: 'XYZ',
			sections: [
				{
					id: 'bs',
					labels: ['Mar 2026'],
					rows: [
						{
							key: 'bs:Other Assets>Trade receivables',
							label: 'Trade receivables',
							parent: 'Other Assets',
							unit: 'cr',
							values: [425]
						},
						{ key: 'bs:CWIP', label: 'CWIP', parent: null, unit: 'cr', values: [10] }
					]
				}
			]
		});
		const keys = buildCatalog([company(), other]).map((m) => m.key);
		expect(keys).toEqual([
			'mkt:Current Price',
			'pl:Sales',
			'bs:Other Assets',
			'bs:Other Assets>Inventories',
			'bs:Other Assets>Trade receivables',
			'bs:CWIP',
			'sh:Promoters'
		]);
		expect(buildCatalog([company()]).find((m) => m.key === 'pl:Sales')?.label).toBe('Revenue');
	});

	const entry = (key: string, parent: string | null = null): CatalogEntry => ({
		key,
		section: key.split(':')[0] as CatalogEntry['section'],
		label: key,
		parent,
		unit: 'cr'
	});
	const catalog = [
		entry('mkt:Market Cap'),
		entry('pl:Sales'),
		entry('bs:Fixed Assets'),
		entry('bs:CWIP'),
		entry('bs:Other Assets'),
		entry('bs:Other Assets>Inventories', 'Other Assets'),
		entry('bs:Other Assets>Trade receivables', 'Other Assets')
	];
	const keys = (ms: CatalogEntry[]) => ms.map((m) => m.key);

	it('shows metrics in statement order until the person arranges them', () => {
		const selected = ['bs:CWIP', 'mkt:Market Cap', 'bs:Missing', 'bs:Fixed Assets'];
		expect(keys(shownMetrics(catalog, selected, false))).toEqual(['mkt:Market Cap', 'bs:Fixed Assets', 'bs:CWIP']);
		expect(keys(shownMetrics(catalog, selected, true))).toEqual(['bs:CWIP', 'mkt:Market Cap', 'bs:Fixed Assets']);
	});

	it('moves a metric and keeps unshown keys in their slots', () => {
		// Shown in statement order: Market Cap, Sales, Fixed Assets, CWIP. Move CWIP to second.
		const selected = ['pl:Sales', 'bs:Missing', 'bs:CWIP', 'mkt:Market Cap', 'bs:Fixed Assets'];
		const shown = keys(shownMetrics(catalog, selected, false));
		const next = moveMetric(selected, shown, 3, 1);
		expect(next).toEqual(['mkt:Market Cap', 'bs:Missing', 'bs:CWIP', 'pl:Sales', 'bs:Fixed Assets']);
		expect(keys(shownMetrics(catalog, next, true))).toEqual(['mkt:Market Cap', 'bs:CWIP', 'pl:Sales', 'bs:Fixed Assets']);
		expect(moveMetric(selected, shown, 9, 0)).toBe(selected);
	});

	it('gives each run of one section its own header, and indents sub-rows only under their parent', () => {
		const arranged = shownMetrics(
			catalog,
			['mkt:Market Cap', 'bs:Fixed Assets', 'bs:CWIP', 'pl:Sales', 'bs:Other Assets>Inventories', 'bs:Other Assets', 'bs:Other Assets>Trade receivables'],
			true
		);
		const runs = metricRuns(arranged);
		expect(runs.map((r) => [r.title, keys(r.metrics)])).toEqual([
			['Market', ['mkt:Market Cap']],
			['Balance sheet', ['bs:Fixed Assets', 'bs:CWIP']],
			['Profit & loss', ['pl:Sales']],
			['Balance sheet', ['bs:Other Assets>Inventories', 'bs:Other Assets', 'bs:Other Assets>Trade receivables']]
		]);
		expect(new Set(runs.map((r) => r.id)).size).toBe(4);
		expect(runs[3].metrics.map((m) => m.indent)).toEqual([false, false, true]);
	});

	it('reads period labels and units', () => {
		expect(periodIndex('Mar 2026')).toBe(2026 * 12 + 2);
		expect(periodIndex('TTM')).toBeNull();
		expect(unitFor('pl', 'OPM %', false)).toBe('pct');
		expect(unitFor('ratios', 'Debtor Days', false)).toBe('days');
		expect(unitFor('pl', 'EPS in Rs', false)).toBe('rs');
		expect(unitFor('mkt', 'Stock P/E', false)).toBe('x');
		expect(unitFor('bs', 'Reserves', false)).toBe('cr');
	});

	it('formats values with Indian grouping and units', () => {
		expect(formatValue(null, 'cr')).toBe('—');
		expect(formatValue(123456, 'cr')).toBe('1,23,456');
		expect(formatValue(22.75, 'rs')).toBe('₹22.75');
		expect(formatValue(27, 'pct')).toBe('27%');
	});

	it('keeps small crore amounts visible and never shows -0', () => {
		expect(formatValue(0.45, 'cr')).toBe('0.45');
		expect(formatValue(3.6, 'cr')).toBe('3.6');
		expect(formatValue(-0.4, 'cr')).toBe('-0.4');
		expect(formatValue(99.994, 'cr')).toBe('99.99');
		expect(formatValue(431.4, 'cr')).toBe('431');
		expect(formatValue(-0.001, 'cr')).toBe('0');
		expect(formatValue(-0.001, 'pct')).toBe('0%');
		expect(formatValue(1250, 'count')).toBe('1,250');
	});
});
