import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The guard wraps globalThis.fetch once, at import, so the stub must be in place first.
const realFetch = globalThis.fetch;
const stub = vi.fn(async () => new Response('ok'));

describe('guest fetch guard', () => {
	let mod: typeof import('./guestContext');

	beforeEach(async () => {
		vi.resetModules();
		delete (globalThis as Record<symbol, unknown>)[Symbol.for('thesis-tracker.guest-fetch-guard')];
		stub.mockClear();
		globalThis.fetch = stub as unknown as typeof fetch;
		mod = await import('./guestContext');
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		delete (globalThis as Record<symbol, unknown>)[Symbol.for('thesis-tracker.guest-fetch-guard')];
		vi.restoreAllMocks();
	});

	it('lets every fetch through outside a guest request', async () => {
		expect(mod.inGuestContext()).toBe(false);
		await fetch('https://www.screener.in/company/TCS/');
		expect(stub).toHaveBeenCalledTimes(1);
	});

	it('blocks other origins for a guest and counts them, but allows the app itself', async () => {
		await mod.runAsGuest('http://app.test', async () => {
			expect(mod.inGuestContext()).toBe(true);
			await expect(fetch('https://www.nseindia.com/api/quote')).rejects.toBeInstanceOf(mod.GuestLiveFetchError);
			await expect(fetch(new URL('https://api.openai.com/v1'))).rejects.toThrow(/signed-in users/);
			await fetch('/api/companies');
			await fetch('http://app.test/api/valuation/valuations');
			expect(mod.guestBlockedFetches()).toBe(2);
		});
		expect(stub).toHaveBeenCalledTimes(2);
		expect(mod.guestBlockedFetchTotal()).toBe(2);
		expect(mod.guestBlockedFetches()).toBe(0);
	});
});
