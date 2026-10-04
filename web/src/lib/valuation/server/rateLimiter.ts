/**
 * Multi-window sliding-rate limiter — Angel One documents separate per-second, per-minute and
 * per-hour caps on the same endpoint, and all three apply simultaneously (a burst that respects
 * the per-second cap can still blow the per-minute one). `acquire()` blocks until a request can
 * be made without exceeding ANY configured window, then records it.
 *
 * Acquisitions are serialized through a promise chain (the same pattern used for the old global
 * `pace()`), not just internally consistent — without this, two concurrent callers can both read
 * the same "slot is free" state before either records its request, letting both through when
 * only one should pass.
 */
export class RateLimiter {
	private timestamps: number[] = [];
	private queue: Promise<void> = Promise.resolve();

	constructor(private readonly limits: { windowMs: number; max: number }[]) {}

	acquire(): Promise<void> {
		const gate = this.queue.then(() => this.waitForSlot());
		// Keep the chain alive even if a caller's downstream request throws — acquire() itself
		// never rejects, so this is just defensive against an unexpected future change.
		this.queue = gate.catch(() => {});
		return gate;
	}

	private async waitForSlot(): Promise<void> {
		for (;;) {
			const now = Date.now();
			let waitMs = 0;
			for (const { windowMs, max } of this.limits) {
				const inWindow = this.timestamps.filter((t) => now - t < windowMs);
				if (inWindow.length >= max) {
					waitMs = Math.max(waitMs, windowMs - (now - inWindow[0]) + 5);
				}
			}
			if (waitMs <= 0) break;
			await new Promise((r) => setTimeout(r, waitMs));
		}
		this.timestamps.push(Date.now());
		const maxWindow = Math.max(...this.limits.map((l) => l.windowMs));
		const cutoff = Date.now() - maxWindow;
		this.timestamps = this.timestamps.filter((t) => t > cutoff);
	}
}

// Angel One's documented hard limits for the endpoints this app actually calls, each targeted
// at ~75% of the documented ceiling to absorb bursts/retries without tripping the real limit
// (see instructions/caching-performance-instructions.md §2 for the source table). Endpoints this
// app doesn't call (searchScrip, getProfile, portfolio/RMS, margin batch) have no limiter here —
// add one if a future feature starts calling them.
export const loginLimiter = new RateLimiter([{ windowMs: 1000, max: 1 }]);

export const candlesLimiter = new RateLimiter([
	{ windowMs: 1000, max: 2 }, // 75% of 3/sec
	{ windowMs: 60_000, max: 135 }, // 75% of 180/min
	{ windowMs: 3_600_000, max: 3750 } // 75% of 5000/hour
]);

export const ltpLimiter = new RateLimiter([
	{ windowMs: 1000, max: 7 }, // 75% of 10/sec
	{ windowMs: 60_000, max: 375 }, // 75% of 500/min
	{ windowMs: 3_600_000, max: 3750 } // 75% of 5000/hour
]);

export const quoteLimiter = new RateLimiter([
	{ windowMs: 1000, max: 7 },
	{ windowMs: 60_000, max: 375 },
	{ windowMs: 3_600_000, max: 3750 }
]);
