import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RS_THRESHOLDS,
	detectRsBand,
	parseThresholds,
	rsBand,
	rsThresholdMessage
} from './rsThresholds';

describe('weekly/monthly RS thresholds', () => {
	it('defaults to +/-2% weekly and +/-5% monthly', () => {
		expect(DEFAULT_RS_THRESHOLDS).toEqual({ weeklyPct: 2, monthlyPct: 5 });
	});

	it('bands relative strength around the threshold, inclusive at the line', () => {
		expect(rsBand(2.0, 2)).toBe('strong');
		expect(rsBand(1.99, 2)).toBe('neutral');
		expect(rsBand(0, 2)).toBe('neutral');
		expect(rsBand(-1.99, 2)).toBe('neutral');
		expect(rsBand(-2.0, 2)).toBe('weak');
		expect(rsBand(7.4, 5)).toBe('strong');
		expect(rsBand(4.9, 5)).toBe('neutral');
	});

	it('seeds silently on first sight, even if already strong', () => {
		expect(detectRsBand(null, 'strong')).toEqual({ next: 'strong', entered: null });
		expect(detectRsBand('garbage', 'weak').entered).toBeNull();
	});

	it('alerts once on entering strong or weak and not while it stays there', () => {
		expect(detectRsBand('neutral', 'strong').entered).toBe('strong');
		expect(detectRsBand('neutral', 'weak').entered).toBe('weak');
		expect(detectRsBand('weak', 'strong').entered).toBe('strong'); // straight across
		expect(detectRsBand('strong', 'strong').entered).toBeNull();
		expect(detectRsBand('weak', 'weak').entered).toBeNull();
	});

	it('records a return to neutral without alerting, then alerts again on a re-cross', () => {
		const back = detectRsBand('strong', 'neutral');
		expect(back).toEqual({ next: 'neutral', entered: null });
		expect(detectRsBand(back.next, 'strong').entered).toBe('strong');
	});

	it('does not spam while hovering around the line', () => {
		let state: string | null = 'neutral';
		let fired = 0;
		for (const v of [1.9, 2.1, 2.3, 2.0, 2.4, 2.6]) {
			const r = detectRsBand(state, rsBand(v, 2));
			if (r.entered) fired++;
			state = r.next;
		}
		expect(fired).toBe(1);
	});

	it('describes the move with the actual numbers', () => {
		expect(rsThresholdMessage('Defence', 'sector', 'weekly', 'strong', 2.64, 2)).toBe(
			'Defence sector: weekly relative strength vs Nifty is +2.6%, above +2%.'
		);
		expect(rsThresholdMessage('Chip Design & IP', 'basket', 'monthly', 'weak', -6.12, 5)).toBe(
			'Chip Design & IP basket: monthly relative strength vs Nifty is -6.1%, below -5%.'
		);
	});

	it('validates threshold input', () => {
		expect(parseThresholds({ weeklyPct: 3, monthlyPct: 8 })).toEqual({
			value: { weeklyPct: 3, monthlyPct: 8 }
		});
		expect(parseThresholds({ weeklyPct: 3.456 })).toEqual({ value: { weeklyPct: 3.46 } });
		for (const bad of [
			null,
			[],
			'x',
			{},
			{ weeklyPct: 'x' },
			{ weeklyPct: NaN },
			{ weeklyPct: 0.1 },
			{ monthlyPct: 51 },
			{ monthlyPct: -5 }
		]) {
			expect('error' in parseThresholds(bad), JSON.stringify(bad)).toBe(true);
		}
	});
});
