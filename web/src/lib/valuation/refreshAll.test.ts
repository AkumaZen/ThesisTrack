import { describe, expect, it, vi } from 'vitest';
import { buildSteps, runSteps, type RefreshPlan, type RefreshStep, type StepOutcome } from './refreshAll';

const plan: RefreshPlan = {
	sectors: [
		{
			key: 'auto',
			label: 'Auto',
			subsectors: [
				{ key: 'ev', label: 'EV', symbols: ['TATAMOTORS', 'EXIDEIND'] },
				{ key: 'oem', label: 'OEM', symbols: ['tatamotors', 'MARUTI'] }
			]
		},
		{ key: 'it', label: 'IT', subsectors: [{ key: 'svc', label: 'Services', symbols: ['TCS', 'MARUTI'] }] }
	]
};

describe('buildSteps', () => {
	it('starts with the benchmark, then companies in sector and subsector order', () => {
		const steps = buildSteps(plan);
		expect(steps.map((s) => s.symbol)).toEqual([null, 'TATAMOTORS', 'EXIDEIND', 'MARUTI', 'TCS']);
	});
	it('refreshes a company shared by baskets once, at its first place', () => {
		const steps = buildSteps(plan);
		expect(steps.filter((s) => s.symbol === 'TATAMOTORS')).toHaveLength(1);
		expect(steps.find((s) => s.symbol === 'MARUTI')?.where).toBe('Auto > OEM');
	});
	it('handles an empty taxonomy', () => {
		expect(buildSteps({ sectors: [] })).toHaveLength(1);
	});
});

const steps = (n: number): RefreshStep[] => Array.from({ length: n }, (_, i) => ({ symbol: `S${i}`, where: 'W' }));

describe('runSteps', () => {
	it('counts ok, unlisted and failed, and keeps the failed steps', async () => {
		const send = vi.fn(async (s: RefreshStep): Promise<StepOutcome> =>
			s.symbol === 'S1' ? 'unlisted' : s.symbol === 'S2' ? 'failed' : 'ok'
		);
		const res = await runSteps(steps(4), { send, retryDelayMs: 0 });
		expect(res).toMatchObject({ done: 4, total: 4, ok: 2, unlisted: 1, failed: 1 });
		expect(res.failedSteps.map((s) => s.symbol)).toEqual(['S2']);
	});
	it('retries a failed step once and counts it ok if the retry works', async () => {
		let calls = 0;
		const send = async (): Promise<StepOutcome> => (++calls === 1 ? 'failed' : 'ok');
		const res = await runSteps(steps(1), { send, retryDelayMs: 0 });
		expect(calls).toBe(2);
		expect(res).toMatchObject({ ok: 1, failed: 0 });
	});
	it('never runs more than the allowed concurrency', async () => {
		let live = 0;
		let peak = 0;
		const send = async (): Promise<StepOutcome> => {
			peak = Math.max(peak, ++live);
			await new Promise((r) => setTimeout(r, 5));
			live--;
			return 'ok';
		};
		await runSteps(steps(10), { send, concurrency: 2 });
		expect(peak).toBe(2);
	});
	it('stops starting new steps once cancelled', async () => {
		let cancelled = false;
		const send = vi.fn(async (): Promise<StepOutcome> => {
			cancelled = true;
			return 'ok';
		});
		const res = await runSteps(steps(10), { send, concurrency: 1, isCancelled: () => cancelled });
		expect(send).toHaveBeenCalledTimes(1);
		expect(res.done).toBe(1);
		expect(res.total).toBe(10);
	});
	it('reports progress with the step in flight', async () => {
		const seen: string[] = [];
		await runSteps(steps(2), {
			send: async () => 'ok',
			concurrency: 1,
			onProgress: (p) => seen.push(`${p.done}/${p.current.map((s) => s.symbol).join(',')}`)
		});
		expect(seen).toContain('0/S0');
		expect(seen.at(-1)).toBe('2/');
	});
});
