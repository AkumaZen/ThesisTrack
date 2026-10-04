import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_CACHE_TTL_MS, fetchCard, forgetCards, peekCard } from './cardCache';

function reply(status: number, body: unknown) {
	return new Response(JSON.stringify(body), { status });
}

describe('cardCache', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		forgetCards();
		fetchMock = vi.fn(async (url: string) => reply(200, { url }));
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('asks once and reuses the answer', async () => {
		const a = await fetchCard('/api/x');
		const b = await fetchCard('/api/x');
		expect(a).toEqual({ status: 200, body: { url: '/api/x' } });
		expect(b).toBe(a);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(peekCard('/api/x')).toBe(a);
	});

	it('shares one request between cards asking at the same time', async () => {
		await Promise.all([fetchCard('/api/y'), fetchCard('/api/y'), fetchCard('/api/y')]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('asks again after a Refresh (fresh) and after the answer goes stale', async () => {
		vi.useFakeTimers();
		await fetchCard('/api/z');
		await fetchCard('/api/z', { fresh: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(CARD_CACHE_TTL_MS + 1);
		expect(peekCard('/api/z')).toBeUndefined();
		await fetchCard('/api/z');
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('remembers "no prices" (404) but not failures', async () => {
		fetchMock.mockResolvedValueOnce(reply(404, { message: 'none' }));
		fetchMock.mockResolvedValueOnce(reply(500, { message: 'down' }));
		expect((await fetchCard('/api/none')).status).toBe(404);
		expect((await fetchCard('/api/down')).status).toBe(500);
		expect(peekCard('/api/none')?.status).toBe(404);
		expect(peekCard('/api/down')).toBeUndefined();
	});

	it('forgets only the answers under a prefix', async () => {
		await fetchCard('/api/valuation/sector-rotation/banks');
		await fetchCard('/api/valuation/company/TCS/growth-series');
		forgetCards('/api/valuation/sector-rotation');
		expect(peekCard('/api/valuation/sector-rotation/banks')).toBeUndefined();
		expect(peekCard('/api/valuation/company/TCS/growth-series')).toBeDefined();
	});

	it('runs at most four requests at once', async () => {
		let live = 0;
		let peak = 0;
		fetchMock.mockImplementation(async (url: string) => {
			peak = Math.max(peak, ++live);
			await new Promise((r) => setTimeout(r, 5));
			live--;
			return reply(200, { url });
		});
		await Promise.all(Array.from({ length: 10 }, (_, i) => fetchCard(`/api/p${i}`)));
		expect(fetchMock).toHaveBeenCalledTimes(10);
		expect(peak).toBe(4);
	});
});
