import { describe, expect, it } from 'vitest';
import {
	detectFairValueCrossing,
	detectNearBreakout,
	detectSectorFlip,
	fairValueMessage,
	nearBreakoutMessage,
	sectorFlipMessage
} from './alerts';

describe('detectFairValueCrossing', () => {
	it('seeds silently the first time (no previous state)', () => {
		expect(detectFairValueCrossing(null, 'at_or_above')).toEqual({
			next: 'at_or_above',
			crossing: null
		});
		expect(detectFairValueCrossing(null, 'below').crossing).toBeNull();
	});

	it('fires once on the way up and once on the way down', () => {
		expect(detectFairValueCrossing('below', 'at_or_above').crossing).toBe('up');
		expect(detectFairValueCrossing('at_or_above', 'below').crossing).toBe('down');
	});

	it('does not re-fire while the price stays on the same side (no spam while hovering)', () => {
		let state: string | null = 'below';
		let fired = 0;
		for (const side of ['below', 'below', 'at_or_above', 'at_or_above', 'at_or_above'] as const) {
			const r = detectFairValueCrossing(state, side);
			if (r.crossing) fired++;
			state = r.next;
		}
		expect(fired).toBe(1);
	});

	it('treats corrupted stored state like a first sighting', () => {
		expect(detectFairValueCrossing('garbage', 'below').crossing).toBeNull();
	});
});

describe('detectSectorFlip', () => {
	it('seeds silently the first time', () => {
		expect(detectSectorFlip(null, 'Rotating In').flippedTo).toBeNull();
	});

	it('alerts on a flip into Rotating In and Rotating Out', () => {
		expect(detectSectorFlip('Neutral', 'Rotating In').flippedTo).toBe('Rotating In');
		expect(detectSectorFlip('Rotating Out', 'Rotating In').flippedTo).toBe('Rotating In');
		expect(detectSectorFlip('Neutral', 'Rotating Out').flippedTo).toBe('Rotating Out');
	});

	it('records a move to Neutral without alerting, and never repeats an unchanged signal', () => {
		expect(detectSectorFlip('Rotating In', 'Neutral')).toEqual({
			next: 'Neutral',
			flippedTo: null
		});
		expect(detectSectorFlip('Rotating In', 'Rotating In').flippedTo).toBeNull();
	});

	it('alerts again after leaving and re-entering Rotating In', () => {
		const out = detectSectorFlip('Rotating In', 'Neutral');
		expect(detectSectorFlip(out.next, 'Rotating In').flippedTo).toBe('Rotating In');
	});
});

describe('detectNearBreakout', () => {
	it('seeds silently the first time, even if already Near Breakout', () => {
		expect(detectNearBreakout(null, 'Near Stage 2 Breakout').entered).toBe(false);
	});

	it('fires only on entering Near Breakout from another stage', () => {
		expect(detectNearBreakout('Stage 1 Base', 'Near Stage 2 Breakout').entered).toBe(true);
		expect(detectNearBreakout('Near Stage 2 Breakout', 'Near Stage 2 Breakout').entered).toBe(
			false
		);
		expect(detectNearBreakout('Near Stage 2 Breakout', 'Confirmed Stage 2 Breakout').entered).toBe(
			false
		);
		expect(detectNearBreakout('Stage 3', 'Stage 4').entered).toBe(false);
	});
});

describe('messages carry the numbers that triggered the alert', () => {
	it('fair value', () => {
		expect(fairValueMessage('up', 'Acme Ltd', 512, 500)).toBe(
			'Acme Ltd reached fair value: ₹512.00 is at or above ₹500.00.'
		);
		expect(fairValueMessage('down', 'Acme Ltd', 480, 500)).toContain('fell back below fair value');
	});

	it('sector flip and breakout', () => {
		expect(sectorFlipMessage('Defence', 'sector', 'Rotating In', 4.25)).toBe(
			'Defence sector flipped to Rotating In (1M RS vs Nifty +4.3%).'
		);
		expect(sectorFlipMessage('Defence', 'basket', 'Rotating Out', null)).toBe(
			'Defence basket flipped to Rotating Out.'
		);
		expect(nearBreakoutMessage('Acme Ltd', 'Stage 1 Base', 1.234)).toBe(
			'Acme Ltd entered Near Stage 2 Breakout (was Stage 1 Base). 1.2% below resistance.'
		);
	});
});
