import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { write, cached } = vi.hoisted(() => ({
	write: vi.fn().mockResolvedValue(undefined),
	cached: { rows: [] as unknown[] }
}));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: async () => cached.rows }) }),
		insert: () => ({ values: () => ({ onConflictDoUpdate: write }) })
	}
}));
vi.mock('$lib/server/db/valuationSchema', () => ({ companyCache: { symbol: 'symbol' } }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));
vi.mock('./screenerSlug', () => ({ bseSlugFor: async () => null }));

function page(populated: boolean, consolidated = false) {
	return `<div id="top"><h1>Example Ltd</h1></div>
		<ul id="top-ratios"><li><span class="name">Current Price</span>
		<span class="number">${populated ? '225' : ''}</span></li>
		<li><span class="name">Stock P/E</span><span class="number">${populated ? '50' : ''}</span></li></ul>
		<section id="profit-loss"><p class="sub">${consolidated ? 'Consolidated ' : ''}Figures in Rs. Crores</p>
		<table><thead><tr><th></th>${populated ? '<th>Mar 2025</th><th>Mar 2026</th>' : ''}</tr></thead>
		<tbody><tr><td>Sales +</td>${populated ? '<td>377</td><td>431</td>' : ''}</tr>
		<tr><td>Net Profit +</td>${populated ? '<td>0</td><td>45</td>' : ''}</tr></tbody></table></section>`;
}

beforeEach(() => {
	vi.resetModules();
	// The module spaces Screener requests 450 ms apart; waiting for real made these tests slow enough
	// to time out under load, and a timed-out test kept fetching into the next one's mock.
	vi.stubGlobal('setTimeout', (run: () => void) => {
		run();
		return 0;
	});
	write.mockClear();
	cached.rows = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('comparison standalone fallback', () => {
	it.each(['ELLEN', 'STALLION'])('loads %s standalone data when consolidated has placeholder rows', async (symbol) => {
		const request = vi.fn(async (url: string) =>
			new Response(page(!url.includes('/consolidated/')))
		);
		vi.stubGlobal('fetch', request);
		const { getCompareStatements } = await import('./compareStatements');
		const data = await getCompareStatements(symbol, { refresh: true });
		expect(request.mock.calls.map(([url]) => url)).toEqual([
			`https://www.screener.in/company/${symbol}/consolidated/`,
			`https://www.screener.in/company/${symbol}/`
		]);
		expect(data.basis).toBe('standalone_only');
		expect(data.sections.find((s) => s.id === 'mkt')?.rows[0].values).toEqual([225]);
		expect(data.sections.find((s) => s.id === 'pl')?.labels).toEqual(['Mar 2025', 'Mar 2026']);
		expect(data.sections.find((s) => s.id === 'pl')?.rows[0].values).toEqual([377, 431]);
		expect(write).toHaveBeenCalledOnce();
	});

	it.each([true, false])('keeps populated pages without an unnecessary fallback (consolidated=%s)', async (consolidated) => {
		const request = vi.fn(async () => new Response(page(true, consolidated)));
		vi.stubGlobal('fetch', request);
		const { getCompareStatements } = await import('./compareStatements');
		const data = await getCompareStatements('LINDEINDIA', { refresh: true });
		expect(request).toHaveBeenCalledOnce();
		expect(data.basis).toBe(consolidated ? 'consolidated' : 'standalone_only');
		expect(data.sections.find((s) => s.id === 'pl')?.rows[1].values).toEqual([0, 45]);
	});

	it('refetches blank results cached before the fallback fix', async () => {
		cached.rows = [{ fetchedAt: Date.now(), data: { shapeVersion: 1, sections: [] } }];
		const request = vi.fn(async (url: string) => new Response(page(!url.includes('/consolidated/'))));
		vi.stubGlobal('fetch', request);
		const { getCompareStatements } = await import('./compareStatements');
		const data = await getCompareStatements('ELLEN');
		expect(request).toHaveBeenCalledTimes(2);
		expect(data.sections.find((s) => s.id === 'pl')?.rows[0].values).toEqual([377, 431]);
	});

	it('does not cache a successful-looking empty company when both pages lack statements', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(page(false))));
		const { getCompareStatements } = await import('./compareStatements');
		await expect(getCompareStatements('EMPTY', { refresh: true })).rejects.toThrow(
			'No financial statements available on Screener: EMPTY'
		);
		expect(write).not.toHaveBeenCalled();
	});
});

describe('bank statements', () => {
	const bankPage = `<div id="top"><h1>Example Bank</h1></div><div data-company-id="1234"></div>
		<section id="profit-loss"><p class="sub">Consolidated Figures in Rs. Crores</p>
		<table><thead><tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr></thead><tbody>
		<tr><td>Revenue <button onclick="Company.showSchedule('Revenue', 'profit-loss', this)">+</button></td><td>1,000</td><td>1,200</td></tr>
		<tr><td>Financing Profit</td><td>300</td><td>360</td></tr>
		<tr><td>Financing Margin %</td><td>30%</td><td>30%</td></tr>
		<tr><td>Net Profit</td><td>200</td><td>240</td></tr></tbody></table></section>`;

	it('files Revenue and Financing Margin under the rows other companies use', async () => {
		const request = vi.fn(async (url: string) =>
			url.includes('/schedules/')
				? Response.json({ 'Interest Earned': { 'Mar 2025': '900', 'Mar 2026': '1,050' } })
				: new Response(bankPage)
		);
		vi.stubGlobal('fetch', request);
		const { getCompareStatements } = await import('./compareStatements');
		const pl = (await getCompareStatements('BANK', { refresh: true })).sections.find((s) => s.id === 'pl')!;
		expect(pl.rows.map((r) => r.key)).toEqual([
			'pl:Sales',
			'pl:Sales>Interest Earned',
			'pl:Operating Profit',
			'pl:OPM %',
			'pl:Net Profit'
		]);
		expect(pl.rows[1]).toMatchObject({ parent: 'Sales', values: [900, 1050] });
		expect(pl.rows[3]).toMatchObject({ unit: 'pct', values: [30, 30] });
		// The breakdown is still asked for by Screener's own label.
		expect(request.mock.calls.some(([url]) => url.includes('parent=Revenue&'))).toBe(true);
	});
});

describe('valuation multiples', () => {
	const withId = page(true, true).replace('<div id="top">', '<div data-company-id="77"></div><div id="top">');
	const chart = {
		datasets: [
			{ metric: 'Market Cap to Sales', values: [['2025-03-21', '4.1'], ['2025-03-28', 4.4], ['2026-02-27', 5], ['2026-10-09', 3.2]] },
			{ metric: 'Price to Earning', values: [['2025-03-28', 30], ['2026-03-31', 28], ['2026-10-09', 25]] },
			{ metric: 'Median PE', values: [['2025-03-28', '24']] }
		]
	};

	it('reads each multiple at the year end and today, from one chart request', async () => {
		const request = vi.fn(async (url: string) =>
			url.includes('/chart/') ? Response.json(chart) : new Response(withId)
		);
		vi.stubGlobal('fetch', request);
		const { getCompareStatements } = await import('./compareStatements');
		const data = await getCompareStatements('ABC', { refresh: true });
		const charts = request.mock.calls.map(([url]) => url).filter((u) => u.includes('/chart/'));
		expect(charts).toHaveLength(1);
		expect(charts[0]).toContain('/api/company/77/chart/?q=Price%20to%20Earning-EV%20Multiple-');
		expect(charts[0]).toContain('&consolidated=true');

		const val = data.sections.find((s) => s.id === 'val')!;
		expect(val.labels).toEqual(['Mar 2025', 'Mar 2026']);
		// P/E first, as listed; Mar 2026 sales multiple has no point within two weeks of the year end.
		expect(val.rows).toEqual([
			{ key: 'val:P/E', label: 'P/E', parent: null, unit: 'x', values: [30, 28] },
			{ key: 'val:Price to sales', label: 'Price to sales', parent: null, unit: 'x', values: [4.4, null] }
		]);
		const mkt = data.sections.find((s) => s.id === 'mkt')!;
		expect(mkt.rows.find((r) => r.key === 'mkt:Price to sales')).toMatchObject({ unit: 'x', values: [3.2] });
		expect(mkt.rows.some((r) => r.key === 'mkt:P/E')).toBe(false);
		expect(data.sections.map((s) => s.id)).toEqual(['mkt', 'val', 'pl', 'bs', 'cf', 'ratios', 'sh']);
	});

	it('still returns the statements when the chart request fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => (url.includes('/chart/') ? new Response('', { status: 500 }) : new Response(withId)))
		);
		const { getCompareStatements } = await import('./compareStatements');
		const data = await getCompareStatements('ABC', { refresh: true });
		expect(data.sections.some((s) => s.id === 'val')).toBe(false);
		expect(data.sections.find((s) => s.id === 'pl')?.rows[0].values).toEqual([377, 431]);
	});
});

describe('Refresh', () => {
	const storedAt = (ageMs: number) => [
		{ fetchedAt: Date.now() - ageMs, data: { shapeVersion: 4, symbol: 'ELLEN', name: 'Cached', basis: 'consolidated', sections: [] } }
	];

	it('reuses a fetch from the last few minutes instead of asking Screener again', async () => {
		cached.rows = storedAt(60_000);
		const request = vi.fn(async () => new Response(page(true)));
		vi.stubGlobal('fetch', request);
		const { getCompareStatements } = await import('./compareStatements');
		expect((await getCompareStatements('ELLEN', { refresh: true })).name).toBe('Cached');
		expect(request).not.toHaveBeenCalled();
	});

	it('fetches again once the last fetch is older than that', async () => {
		cached.rows = storedAt(6 * 60_000);
		const request = vi.fn(async () => new Response(page(true)));
		vi.stubGlobal('fetch', request);
		const { getCompareStatements } = await import('./compareStatements');
		expect((await getCompareStatements('ELLEN', { refresh: true })).name).toBe('Example Ltd');
		expect(request).toHaveBeenCalledOnce();
	});
});
