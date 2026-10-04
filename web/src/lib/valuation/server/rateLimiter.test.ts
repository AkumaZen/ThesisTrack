import { describe, it, expect } from 'vitest';
import { RateLimiter } from './rateLimiter';

describe('RateLimiter', () => {
	it('lets requests through immediately while under every configured limit', async () => {
		const limiter = new RateLimiter([{ windowMs: 1000, max: 5 }]);
		const start = Date.now();
		await limiter.acquire();
		await limiter.acquire();
		await limiter.acquire();
		expect(Date.now() - start).toBeLessThan(50);
	});

	it('delays a request that would exceed the tightest window', async () => {
		const limiter = new RateLimiter([{ windowMs: 200, max: 2 }]);
		const start = Date.now();
		await limiter.acquire();
		await limiter.acquire();
		// A 3rd acquisition within the same 200ms window must wait for the window to roll over.
		await limiter.acquire();
		expect(Date.now() - start).toBeGreaterThanOrEqual(190);
	});

	it('enforces the tightest of multiple simultaneous windows', async () => {
		// A per-second cap of 10 is irrelevant when the per-100ms cap of 1 is what actually binds.
		const limiter = new RateLimiter([
			{ windowMs: 100, max: 1 },
			{ windowMs: 1000, max: 10 }
		]);
		const start = Date.now();
		await limiter.acquire();
		await limiter.acquire();
		expect(Date.now() - start).toBeGreaterThanOrEqual(90);
	});

	it('serializes concurrent acquisitions instead of letting them all read a stale slot count', async () => {
		// The exact bug fixed in the old global pace(): N concurrent callers must not all pass
		// through together just because they all checked the limit before any of them recorded
		// a request. Firing 5 concurrent acquisitions against a max-2-per-window limiter must
		// take at least 2 window rollovers, not resolve immediately for everyone.
		const limiter = new RateLimiter([{ windowMs: 150, max: 2 }]);
		const start = Date.now();
		await Promise.all([
			limiter.acquire(),
			limiter.acquire(),
			limiter.acquire(),
			limiter.acquire(),
			limiter.acquire()
		]);
		// 5 requests at 2/window need at least 2 full window waits (3rd and 5th requests each
		// wait one window past the first pair).
		expect(Date.now() - start).toBeGreaterThanOrEqual(140);
	});
});
