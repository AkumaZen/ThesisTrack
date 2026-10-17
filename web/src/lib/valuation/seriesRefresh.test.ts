import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./cardCache', () => ({ forgetCards: vi.fn() }));

import { forgetCards } from './cardCache';
import { refreshSymbols } from './seriesRefresh';

const syms = (n: number) => Array.from({ length: n }, (_, i) => `S${i}`);
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const bad = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response;

afterEach(() => vi.unstubAllGlobals());

describe('refreshSymbols', () => {
	it('sends ceil(n/50) batch requests and counts refreshed, unlisted and failed', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push(url);
				if (url.endsWith('/refresh-batch')) {
					const { symbols } = JSON.parse(init!.body as string) as { symbols: string[] };
					return ok({
						results: symbols.map((s) => ({
							symbol: s,
							outcome: s === 'S1' ? 'unlisted' : s === 'S2' ? 'failed' : 'appended'
						}))
					});
				}
				return ok({});
			})
		);
		const progress: number[] = [];
		const r = await refreshSymbols(syms(120), (d) => progress.push(d));
		expect(calls.filter((u) => u.endsWith('/refresh-batch'))).toHaveLength(3);
		expect(calls.filter((u) => u.includes('/refresh-series'))).toHaveLength(0);
		expect(calls.filter((u) => u.endsWith('/refresh-benchmark'))).toHaveLength(1);
		expect(r).toEqual({ total: 120, refreshed: 118, unlisted: 1, failed: 1 });
		expect(progress).toEqual([0, 50, 100, 120]);
		expect(forgetCards).toHaveBeenCalledWith('/api/valuation/sector-rotation');
	});

	it('falls back to one request per company when a batch request fails', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				calls.push(url);
				if (url.endsWith('/refresh-batch')) return bad(502);
				if (url.includes('/S1/')) return bad(404);
				return ok({});
			})
		);
		const r = await refreshSymbols(syms(3), undefined, false);
		expect(calls.filter((u) => u.includes('/refresh-series'))).toHaveLength(3);
		expect(r).toMatchObject({ refreshed: 2, unlisted: 1, failed: 0 });
	});

	it('keeps a single company on its own endpoint', async () => {
		const fetchMock = vi.fn(async (_url: string) => ok({}));
		vi.stubGlobal('fetch', fetchMock);
		const r = await refreshSymbols(['TCS'], undefined, false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toContain('/company/TCS/refresh-series');
		expect(r.refreshed).toBe(1);
	});
});
