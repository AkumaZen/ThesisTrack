import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './loginThrottle';

function make() {
	let t = 1_000_000;
	const throttle = new LoginThrottle({
		maxFailures: 3,
		windowMs: 60_000,
		lockoutMs: 120_000,
		now: () => t
	});
	return { throttle, advance: (ms: number) => (t += ms) };
}

describe('LoginThrottle', () => {
	it('allows attempts until the failure limit, then locks', () => {
		const { throttle } = make();
		throttle.recordFailure('a');
		throttle.recordFailure('a');
		expect(throttle.retryAfterMs('a')).toBe(0);
		throttle.recordFailure('a');
		expect(throttle.retryAfterMs('a')).toBe(120_000);
	});

	it('unlocks after the lockout and then starts counting fresh', () => {
		const { throttle, advance } = make();
		for (let i = 0; i < 3; i++) throttle.recordFailure('a');
		advance(119_000);
		expect(throttle.retryAfterMs('a')).toBe(1_000);
		advance(2_000);
		expect(throttle.retryAfterMs('a')).toBe(0);
		throttle.recordFailure('a');
		throttle.recordFailure('a');
		expect(throttle.retryAfterMs('a')).toBe(0); // only 2 fresh failures
	});

	it('forgets old failures outside the window', () => {
		const { throttle, advance } = make();
		throttle.recordFailure('a');
		throttle.recordFailure('a');
		advance(61_000);
		throttle.recordFailure('a');
		expect(throttle.retryAfterMs('a')).toBe(0);
	});

	it('a success clears the count, and accounts are independent', () => {
		const { throttle } = make();
		throttle.recordFailure('a');
		throttle.recordFailure('a');
		throttle.recordSuccess('a');
		throttle.recordFailure('a');
		expect(throttle.retryAfterMs('a')).toBe(0);
		for (let i = 0; i < 3; i++) throttle.recordFailure('b');
		expect(throttle.retryAfterMs('b')).toBeGreaterThan(0);
		expect(throttle.retryAfterMs('a')).toBe(0);
	});
});
