// Slows password guessing: after MAX_FAILURES wrong passwords for one account inside the window,
// further attempts are refused until the lockout expires. In-memory on purpose - this is a
// brake on guessing, not an audit log, and a restart clearing it is harmless for a small team.

export interface ThrottleOptions {
	maxFailures: number;
	windowMs: number;
	lockoutMs: number;
	now?: () => number;
}

export class LoginThrottle {
	private failures = new Map<string, number[]>();
	private lockedUntil = new Map<string, number>();
	private readonly now: () => number;

	constructor(private opts: ThrottleOptions) {
		this.now = opts.now ?? Date.now;
	}

	/** Milliseconds until another attempt is allowed (0 = allowed now). */
	retryAfterMs(key: string): number {
		const until = this.lockedUntil.get(key) ?? 0;
		const remaining = until - this.now();
		if (remaining > 0) return remaining;
		if (until) this.lockedUntil.delete(key);
		return 0;
	}

	recordFailure(key: string): void {
		const t = this.now();
		const recent = (this.failures.get(key) ?? []).filter((x) => t - x < this.opts.windowMs);
		recent.push(t);
		if (recent.length >= this.opts.maxFailures) {
			this.lockedUntil.set(key, t + this.opts.lockoutMs);
			this.failures.delete(key);
		} else {
			this.failures.set(key, recent);
		}
	}

	recordSuccess(key: string): void {
		this.failures.delete(key);
		this.lockedUntil.delete(key);
	}
}

/** Shared instance: 5 wrong passwords in 10 minutes locks that account for 5 minutes. */
export const loginThrottle = new LoginThrottle({
	maxFailures: 5,
	windowMs: 10 * 60 * 1000,
	lockoutMs: 5 * 60 * 1000
});
