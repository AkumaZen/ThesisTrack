import { describe, expect, it } from 'vitest';
import { daysBetween, staleReasons, staleThesis } from './staleThesis';

const base = { today: '2026-10-17', priceAtReview: 100, currentPrice: 100 };

describe('staleThesis', () => {
	it('90 days is not stale, 91 is', () => {
		expect(staleThesis({ ...base, lastReviewed: '2026-07-19' }).stale).toBe(false); // 90 days
		expect(staleThesis({ ...base, lastReviewed: '2026-07-18' })).toMatchObject({ stale: true, days: 91, oldReview: true });
	});

	it('+20 and -20 are stale, 19.9 is not', () => {
		const at = (currentPrice: number) => staleThesis({ ...base, lastReviewed: '2026-10-01', currentPrice });
		expect(at(120).bigMove).toBe(true);
		expect(at(80).bigMove).toBe(true);
		expect(at(119.9).stale).toBe(false);
		expect(at(80.1).stale).toBe(false);
		expect(staleThesis({ ...base, lastReviewed: '2026-10-01', priceAtReview: 80, currentPrice: 96 }).bigMove).toBe(true);
	});

	it('judges on days only when a price is missing', () => {
		const r = staleThesis({ ...base, lastReviewed: '2026-10-01', priceAtReview: null, currentPrice: 500 });
		expect(r).toMatchObject({ stale: false, movePct: null, bigMove: false });
		expect(staleThesis({ ...base, lastReviewed: '2026-01-01', priceAtReview: null }).stale).toBe(true);
		expect(staleThesis({ ...base, lastReviewed: '2026-10-01', currentPrice: null }).movePct).toBeNull();
	});

	it('unusable review date gives no day reason', () => {
		expect(staleThesis({ ...base, lastReviewed: null })).toMatchObject({ days: null, oldReview: false });
		expect(daysBetween('nope', '2026-10-17')).toBeNull();
	});

	it('words both reasons and none when fresh', () => {
		const r = staleThesis({ today: '2026-10-17', lastReviewed: '2026-06-01', priceAtReview: 100, currentPrice: 130 });
		expect(staleReasons(r, 100, 130)).toEqual([
			'Not reviewed in 138 days',
			'Price moved +30.0% since last review (\u20B9100 to \u20B9130)'
		]);
		expect(staleReasons(staleThesis({ ...base, lastReviewed: '2026-10-10' }))).toEqual([]);
	});
});
