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
