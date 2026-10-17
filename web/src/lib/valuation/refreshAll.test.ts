import { describe, expect, it, vi } from 'vitest';
import {
	buildSteps,
	runSteps,
	stepsForFailed,
	summariseBatch,
	type RefreshPlan,
	type RefreshStep,
	type StepResult
} from './refreshAll';

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
		expect(steps.map((s) => s.symbols)).toEqual([null, ['TATAMOTORS', 'EXIDEIND', 'MARUTI', 'TCS']]);
	});
	it('refreshes a company shared by baskets once, at its first place', () => {
		const all = buildSteps(plan).flatMap((s) => s.symbols ?? []);
		expect(all.filter((s) => s === 'TATAMOTORS')).toHaveLength(1);
		expect(buildSteps(plan)[1].sectorOf?.MARUTI).toBe('Auto');
	});
	it('names the sectors each batch covers, in order', () => {
		expect(buildSteps(plan)[1].where).toBe('Auto, IT');
	});
	it('splits into batches of the given size, keeping sector order', () => {
		const steps = buildSteps(plan, 3);
		expect(steps.map((s) => s.symbols)).toEqual([null, ['TATAMOTORS', 'EXIDEIND', 'MARUTI'], ['TCS']]);
		expect(steps[1].where).toBe('Auto');
		expect(steps[2].where).toBe('IT');
	});
	it('uses batches of 50 by default', () => {
		const big: RefreshPlan = {
			sectors: [
				{
					key: 'a',
					label: 'A',
					subsectors: [{ key: 's', label: 'S', symbols: Array.from({ length: 120 }, (_, i) => `S${i}`) }]
				}
			]
		};
		expect(buildSteps(big).map((s) => s.symbols?.length)).toEqual([undefined, 50, 50, 20]);
	});
	it('handles an empty taxonomy', () => {
		expect(buildSteps({ sectors: [] })).toHaveLength(1);
	});
});

describe('summariseBatch', () => {
	it('counts appended, full and unchanged as refreshed, and keeps failures', () => {
		const r = summariseBatch([
			{ symbol: 'A', outcome: 'appended' },
			{ symbol: 'B', outcome: 'full' },
			{ symbol: 'C', outcome: 'unchanged' },
			{ symbol: 'D', outcome: 'unlisted' },
			{ symbol: 'E', outcome: 'failed' }
		]);
		expect(r).toEqual({ ok: 3, unlisted: 1, failed: ['E'] });
	});
});

const step = (symbols: string[] | null): RefreshStep => ({ symbols, where: 'W' });
const okResult = (s: RefreshStep): StepResult => ({ ok: s.symbols?.length ?? 1, unlisted: 0, failed: [] });

describe('runSteps', () => {
	it('counts ok, unlisted and failed across batches, and keeps the failed companies', async () => {
		const send = vi.fn(async (s: RefreshStep): Promise<StepResult> =>
			s.symbols?.[0] === 'S0' ? { ok: 1, unlisted: 1, failed: ['S2'] } : okResult(s)
		);
		const res = await runSteps([step(['S0', 'S1', 'S2']), step(['S3'])], { send, retryDelayMs: 0 });
		// S2 failed in the first pass, and the one retry (sent as ['S2']) succeeded.
		expect(res).toMatchObject({ done: 4, total: 4, stepsDone: 2, ok: 3, unlisted: 1, failed: 0 });
	});
	it('retries only the failed companies once, then reports them', async () => {
		const sent: (string[] | null)[] = [];
		const send = async (s: RefreshStep): Promise<StepResult> => {
			sent.push(s.symbols);
			return s.symbols?.includes('BAD')
				? { ok: s.symbols.length - 1, unlisted: 0, failed: ['BAD'] }
				: okResult(s);
		};
		const res = await runSteps([{ symbols: ['A', 'BAD'], where: 'W', sectorOf: { BAD: 'Banks' } }], {
			send,
			retryDelayMs: 0
		});
		expect(sent).toEqual([['A', 'BAD'], ['BAD']]);
		expect(res.failed).toBe(1);
		expect(res.failedItems).toEqual([{ symbol: 'BAD', where: 'Banks' }]);
	});
	it('fails the benchmark step as Nifty 50', async () => {
		const send = async (): Promise<StepResult> => ({ ok: 0, unlisted: 0, failed: ['Nifty 50'] });
		const res = await runSteps([step(null)], { send, retryDelayMs: 0 });
		expect(res.failedItems).toEqual([{ symbol: null, where: 'W' }]);
	});
	it('numbers batches, not the benchmark', async () => {
		const seen: string[] = [];
		await runSteps([step(null), step(['A']), step(['B'])], {
			send: async (s) => okResult(s),
			onProgress: (p) => seen.push(`${p.batchIndex}/${p.batchTotal}`)
		});
		expect(seen).toContain('1/2');
		expect(seen.at(-1)).toBe('2/2');
	});
	it('runs one request at a time', async () => {
		let live = 0;
		let peak = 0;
		const send = async (s: RefreshStep): Promise<StepResult> => {
			peak = Math.max(peak, ++live);
			await new Promise((r) => setTimeout(r, 5));
			live--;
			return okResult(s);
		};
		await runSteps([step(['A']), step(['B']), step(['C'])], { send });
		expect(peak).toBe(1);
	});
	it('stops starting new steps once cancelled', async () => {
		let cancelled = false;
		const send = vi.fn(async (s: RefreshStep): Promise<StepResult> => {
			cancelled = true;
			return okResult(s);
		});
		const res = await runSteps([step(['A']), step(['B']), step(['C'])], { send, isCancelled: () => cancelled });
		expect(send).toHaveBeenCalledTimes(1);
		expect(res).toMatchObject({ done: 1, total: 3 });
	});
});

describe('stepsForFailed', () => {
	it('puts the benchmark first and repacks companies in order', () => {
		const steps = stepsForFailed([
			{ symbol: 'A', where: 'X' },
			{ symbol: null, where: 'Nifty 50 benchmark' },
			{ symbol: 'B', where: 'Y' }
		]);
		expect(steps.map((s) => s.symbols)).toEqual([null, ['A', 'B']]);
		expect(steps[1].where).toBe('X, Y');
	});
});
