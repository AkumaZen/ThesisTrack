import { describe, expect, it, vi } from 'vitest';

vi.mock('./angelone', () => ({ fetchLiveSnapshots: vi.fn() }));

import { liveSnapshotsFor } from './liveBatch';

const snap = (ltp: number) => ({ ltp, tradeVolume: 5 });
const batch = (
	r: Partial<{ snapshots: Record<string, number>; unlisted: string[]; missing: string[]; failed: string[] }>
) =>
	vi.fn(async () => ({
		snapshots: new Map(Object.entries(r.snapshots ?? {}).map(([s, p]) => [s, snap(p)])),
		unlisted: r.unlisted ?? [],
		missing: r.missing ?? [],
		failed: r.failed ?? []
	}));

describe('liveSnapshotsFor', () => {
	it('answers from the batch with no single calls', async () => {
		const fallback = vi.fn();
		const fetchBatch = batch({ snapshots: { A: 10, B: 20 } });
		const out = await liveSnapshotsFor(['a', 'B'], fallback, fetchBatch);
		expect(out.get('A')).toEqual(snap(10));
		expect(out.get('B')).toEqual(snap(20));
		expect(fetchBatch).toHaveBeenCalledTimes(1);
		expect(fallback).not.toHaveBeenCalled();
	});

	it('keeps unlisted symbols null without a single call', async () => {
		const fallback = vi.fn();
		const out = await liveSnapshotsFor(['GUJGASLTD'], fallback, batch({ unlisted: ['GUJGASLTD'] }));
		expect(out.get('GUJGASLTD')).toBeNull();
		expect(fallback).not.toHaveBeenCalled();
	});

	it('falls back per symbol for failed and unanswered symbols only', async () => {
		const fallback = vi.fn(async (s: string) => snap(s === 'C' ? 30 : 40));
		const out = await liveSnapshotsFor(
			['A', 'C', 'D'],
			fallback,
			batch({ snapshots: { A: 10 }, failed: ['C'], missing: ['D'] })
		);
		expect(fallback.mock.calls.map((c) => c[0])).toEqual(['C', 'D']);
		expect(out.get('C')).toEqual(snap(30));
		expect(out.get('D')).toEqual(snap(40));
	});

	it('falls back for everything when the batch call itself throws', async () => {
		const fallback = vi.fn(async () => snap(1));
		const out = await liveSnapshotsFor(['A', 'B'], fallback, vi.fn().mockRejectedValue(new Error('boom')));
		expect(fallback).toHaveBeenCalledTimes(2);
		expect(out.size).toBe(2);
	});

	it('records a fallback failure as that symbol error and carries on', async () => {
		const fallback = vi.fn(async (s: string) => {
			if (s === 'A') throw new Error('ANGEL_LTP_FAILED');
			return snap(2);
		});
		const out = await liveSnapshotsFor(['A', 'B'], fallback, vi.fn().mockRejectedValue(new Error('x')));
		expect(out.get('A')).toBeInstanceOf(Error);
		expect(out.get('B')).toEqual(snap(2));
	});
});
