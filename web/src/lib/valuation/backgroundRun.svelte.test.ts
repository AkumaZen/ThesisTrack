import { describe, expect, it, vi } from 'vitest';
import { BackgroundRun, getRun, backgroundRuns } from './backgroundRun.svelte';
import { runSteps, type RefreshStep, type StepResult } from './refreshAll';

const step = (symbols: string[]): RefreshStep => ({ symbols, where: 'W' });
const okAll = async (s: RefreshStep): Promise<StepResult> => ({ ok: s.symbols?.length ?? 1, unlisted: 0, failed: [] });

describe('BackgroundRun', () => {
	it('runs to done, totals the work and calls every attached panel with afterRun\'s value', async () => {
		const run = new BackgroundRun<string>({
			title: 'T',
			href: '/x',
			retrySize: 50,
			plan: async () => [step(['A', 'B']), step(['C'])],
			send: okAll,
			afterRun: async () => 'reloaded'
		});
		const seen: string[] = [];
		const detach = run.attach((v) => void seen.push(v));
		expect(run.views).toBe(1);
		await run.start();
		expect(run.phase).toBe('done');
		expect(run.allOk).toBe(3);
		expect(run.total).toBe(3);
		expect(seen).toEqual(['reloaded']);
		detach();
		expect(run.views).toBe(0);
	});

	it('keeps running with no panel attached (the page was left)', async () => {
		const run = new BackgroundRun({ title: 'T', href: '/x', retrySize: 50, plan: async () => [step(['A'])], send: okAll });
		const detach = run.attach(() => {});
		const started = run.start();
		detach();
		await started;
		expect(run.phase).toBe('done');
		expect(run.allOk).toBe(1);
	});

	it('stops starting new steps once cancelled', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const send = vi.fn(async (s: RefreshStep) => {
			await gate;
			return okAll(s);
		});
		const run = new BackgroundRun({ title: 'T', href: '/x', retrySize: 50, plan: async () => [step(['A']), step(['B'])], send });
		const started = run.start();
		await vi.waitFor(() => expect(run.phase).toBe('running'));
		run.cancel();
		expect(run.phase).toBe('cancelling');
		release();
		await started;
		expect(send).toHaveBeenCalledTimes(1);
		expect(run.cancelled).toBe(true);
		expect(run.phase).toBe('done');
	});

	it('reports an empty plan as nothing to do and a failed plan as an error', async () => {
		const empty = new BackgroundRun({ title: 'T', href: '/x', retrySize: 50, plan: async () => [] });
		await empty.start();
		expect(empty.phase).toBe('idle');
		expect(empty.nothingToDo).toBe(true);
		const broken = new BackgroundRun({ title: 'T', href: '/x', retrySize: 50, plan: async () => Promise.reject(new Error('500')) });
		await broken.start();
		expect(broken.phase).toBe('idle');
		expect(broken.planError).toMatch(/Try again/);
	});

	it('does not start twice while busy', async () => {
		const plan = vi.fn(async () => [step(['A'])]);
		const run = new BackgroundRun({ title: 'T', href: '/x', retrySize: 50, plan, send: okAll });
		await Promise.all([run.start(), run.start()]);
		expect(plan).toHaveBeenCalledTimes(1);
	});

	it('retries only the failed companies', async () => {
		let fail = true;
		const send = vi.fn(async (s: RefreshStep): Promise<StepResult> =>
			fail ? { ok: 1, unlisted: 0, failed: ['B'], errors: { B: 'timeout' } } : okAll(s)
		);
		const run = new BackgroundRun({ title: 'T', href: '/x', retrySize: 50, plan: async () => [step(['A', 'B'])], send, retryDelayMs: 0 });
		await run.start();
		expect(run.progress?.failedItems).toEqual([{ symbol: 'B', where: 'W', error: 'timeout' }]);
		fail = false;
		run.retryFailed();
		await vi.waitFor(() => expect(run.phase).toBe('done'));
		expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ symbols: ['B'] }));
		expect(run.progress?.failedItems).toEqual([]);
	});
});

describe('getRun', () => {
	it('returns one shared run per key and lists it for the indicator', () => {
		const make = () => ({ title: 'T', href: '/x', retrySize: 50, plan: async () => [] });
		const a = getRun('k-test', make);
		expect(getRun('k-test', make)).toBe(a);
		expect(backgroundRuns.list).toContain(a);
	});
});

describe('runSteps unlisted tracking', () => {
	it('collects the companies with no price source', async () => {
		const res = await runSteps([step(['A', 'X'])], {
			send: async () => ({ ok: 1, unlisted: 1, failed: [], unlistedSymbols: ['X'] })
		});
		expect(res.unlistedItems).toEqual(['X']);
	});
});
