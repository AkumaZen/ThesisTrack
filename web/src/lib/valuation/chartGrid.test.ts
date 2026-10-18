import { describe, expect, it } from 'vitest';
import { changeVsPrev, lastChangePct, missingCloseChunks, sparkPoints, type GridItem } from './chartGrid';

describe('sparkPoints', () => {
	it('scales to the series own range', () => {
		expect(sparkPoints([10, 20, 15], 100, 10)).toBe('0.0,10.0 50.0,0.0 100.0,5.0');
	});
	it('draws a flat series along the bottom without dividing by zero', () => {
		expect(sparkPoints([5, 5, 5], 100, 10)).toBe('0.0,10.0 50.0,10.0 100.0,10.0');
	});
	it('is null with fewer than two usable closes', () => {
		expect(sparkPoints(null)).toBeNull();
		expect(sparkPoints([])).toBeNull();
		expect(sparkPoints([7])).toBeNull();
		expect(sparkPoints([7, Number.NaN])).toBeNull();
	});
});

describe('changes', () => {
	it('lastChangePct uses the last two closes', () => {
		expect(lastChangePct([1, 100, 110])).toBeCloseTo(10);
		expect(lastChangePct([100])).toBeNull();
		expect(lastChangePct([0, 5])).toBeNull();
		expect(lastChangePct(null)).toBeNull();
	});
	it('changeVsPrev needs both numbers and a positive base', () => {
		expect(changeVsPrev(110, 100)).toBeCloseTo(10);
		expect(changeVsPrev(null, 100)).toBeNull();
		expect(changeVsPrev(100, null)).toBeNull();
		expect(changeVsPrev(100, 0)).toBeNull();
	});
});

describe('missingCloseChunks', () => {
	const item = (symbol: string, closes?: number[]): GridItem => ({ symbol, name: symbol, price: 1, changePct: 0, closes });
	it('asks only for visible tiles without closes, in chunks', () => {
		const items = [item('A', [1, 2]), item('B'), item('C'), item('D'), item('E')];
		expect(missingCloseChunks(items, 4, {}, 2)).toEqual([['B', 'C'], ['D']]);
	});
	it('skips symbols already fetched, even when nothing came back for them', () => {
		const items = [item('A'), item('B')];
		expect(missingCloseChunks(items, 2, { A: [1, 2] })).toEqual([['B']]);
		expect(missingCloseChunks(items, 2, { A: [], B: [] })).toEqual([]);
	});
});
