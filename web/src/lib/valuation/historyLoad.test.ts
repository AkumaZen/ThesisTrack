import { describe, expect, it } from 'vitest';
import { HISTORY_BATCH_SIZE, historySteps, newlyLoaded } from './historyLoad';

describe('historySteps', () => {
	const syms = Array.from({ length: 60 }, (_, i) => `S${i}`);

	it('packs the companies into small batches, in order', () => {
		const steps = historySteps(syms);
		expect(HISTORY_BATCH_SIZE).toBeLessThanOrEqual(50);
		expect(steps.map((s) => s.symbols!.length)).toEqual([25, 25, 10]);
		expect(steps.flatMap((s) => s.symbols!)).toEqual(syms);
	});

	it('drops duplicates and upper-cases', () => {
		expect(historySteps(['abc', 'ABC', 'xyz']).flatMap((s) => s.symbols!)).toEqual(['ABC', 'XYZ']);
	});

	it('has no steps when there is nothing to load', () => {
		expect(historySteps([])).toEqual([]);
	});
});

describe('newlyLoaded', () => {
	it('is what was planned minus what is still missing', () => {
		expect(newlyLoaded(['A', 'B', 'C'], ['b'])).toEqual(['A', 'C']);
		expect(newlyLoaded(['A'], ['A'])).toEqual([]);
	});
});
