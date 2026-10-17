import { describe, expect, it } from 'vitest';
import { interpretSparkline, isFinalTrend } from './trendState';

describe('interpretSparkline', () => {
	it('shows closes when the server has a series', () => {
		expect(interpretSparkline(200, { closes: [1, 2, 3] })).toEqual({ state: 'ok', closes: [1, 2, 3] });
	});
	it('treats a series too short to draw as not stored', () => {
		expect(interpretSparkline(200, { closes: [1] }).state).toBe('not_stored');
		expect(interpretSparkline(200, {}).state).toBe('not_stored');
	});
	it('separates a symbol with no price source from one not fetched yet', () => {
		expect(interpretSparkline(404, { reason: 'unlisted' }).state).toBe('unlisted');
		expect(interpretSparkline(404, { reason: 'not_stored' }).state).toBe('not_stored');
	});
	it('treats timeouts, throttling and server errors as temporary', () => {
		for (const status of [0, 429, 500, 502, 504]) expect(interpretSparkline(status, null).state).toBe('error');
		// a 404 with no reason (e.g. an old server or a proxy page) must not read as "unlisted"
		expect(interpretSparkline(404, null).state).toBe('error');
	});
});

describe('isFinalTrend', () => {
	it('only remembers answers that cannot change by asking again', () => {
		expect(isFinalTrend('ok')).toBe(true);
		expect(isFinalTrend('unlisted')).toBe(true);
		for (const s of ['not_stored', 'error', 'loading', 'fetching', undefined] as const) {
			expect(isFinalTrend(s)).toBe(false);
		}
	});
});
