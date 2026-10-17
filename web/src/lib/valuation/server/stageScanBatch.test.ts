import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('./stageScanEngine', () => ({ getStageScanResult: vi.fn(), LIVE_TTL_MS: 600000 }));

import { getStageScanBatch } from './stageScanBatch';
import type { StageScanResult } from '../stageScan';

const result = { stage: 'Stage 1 Base' } as unknown as StageScanResult;
const snap = { ltp: 10, tradeVolume: 3 };

function deps(over: Record<string, unknown> = {}) {
	const scan = vi.fn(async (_s: string, _l: unknown) => result);
	const liveFor = vi.fn(async (symbols: string[]) => new Map(symbols.map((s) => [s, snap])));
	return {
		scan,
		liveFor,
		d: { marketOpen: () => true, staleLive: async (s: string[]) => s, liveFor, scan, ...over }
	};
}

describe('getStageScanBatch', () => {
	it('gets the live overlay of every stale symbol from one batched look-up', async () => {
		const { d, liveFor, scan } = deps();
		const out = await getStageScanBatch(['a', 'B'], d);
		expect(liveFor).toHaveBeenCalledTimes(1);
		expect(liveFor).toHaveBeenCalledWith(['A', 'B']);
		expect(scan).toHaveBeenCalledWith('A', snap);
		expect(out.map((i) => i.symbol)).toEqual(['A', 'B']);
	});

	it('makes no quote call when the market is closed', async () => {
		const { d, liveFor, scan } = deps({ marketOpen: () => false });
		await getStageScanBatch(['A'], d);
		expect(liveFor).not.toHaveBeenCalled();
		expect(scan).toHaveBeenCalledWith('A', undefined);
	});

	it('only looks up the symbols whose overlay is stale', async () => {
		const { d, liveFor } = deps({ staleLive: async () => ['B'] });
		await getStageScanBatch(['A', 'B'], d);
		expect(liveFor).toHaveBeenCalledWith(['B']);
	});

	it('leaves the cached overlay when the batch found no price or errored (no repeat call)', async () => {
		const { d, scan } = deps({
			liveFor: async () =>
				new Map<string, null | Error>([
					['A', null],
					['B', new Error('x')]
				])
		});
		await getStageScanBatch(['A', 'B'], d);
		expect(scan).toHaveBeenNthCalledWith(1, 'A', null);
		expect(scan).toHaveBeenNthCalledWith(2, 'B', null);
	});

	it('still scans when the batched look-up throws, and isolates one symbol failure', async () => {
		const { d } = deps({
			liveFor: async () => {
				throw new Error('down');
			},
			scan: vi.fn(async (s: string) => {
				if (s === 'B') throw new Error('bad candles');
				return result;
			})
		});
		const out = await getStageScanBatch(['A', 'B'], d);
		expect(out[0]).toMatchObject({ symbol: 'A', result });
		expect(out[1]).toMatchObject({ symbol: 'B', result: null, error: 'bad candles' });
	});
});
