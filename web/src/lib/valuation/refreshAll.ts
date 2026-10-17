// "Refresh all sectors": the client walks the whole sector tree in batches of up to 50 companies
// (Vercel Hobby functions time out, so no single server call could do it). Order: the Nifty 50
// every sector is measured against, then the companies sector by sector, subsector by subsector,
// each once. The server brings each batch up to date from one quote request where it can
// (POST /api/valuation/refresh-batch).
// Sector and subsector figures are built from their companies' stored prices, so refreshing the
// companies in that order is what refreshes them.
import { forgetCards } from './cardCache';

export interface RefreshPlan {
	sectors: {
		key: string;
		label: string;
		subsectors: { key: string; label: string; symbols: string[] }[];
	}[];
}

/** Matches the server's limit (BATCH_SIZE in server/batchRefresh.ts) and Angel One's 50 tokens per quote. */
export const BATCH_SIZE = 50;

export interface RefreshStep {
	/** null is the Nifty 50 benchmark. */
	symbols: string[] | null;
	/** Which sectors the step covers, for the progress line: "Auto & Mobility, Banks". */
	where: string;
	/** The sector each symbol sits in, for the list of failures. */
	sectorOf?: Record<string, string>;
}

/** What one step achieved, in companies. */
export interface StepResult {
	/** Refreshed (appended, full history or already current). */
	ok: number;
	unlisted: number;
	failed: string[];
}

/** A company that failed, with where it sits. */
export interface FailedItem {
	symbol: string | null;
	where: string;
}

/** Benchmark first, then every company in sector then subsector order in batches of `size`. A
 *  company in several baskets is refreshed once, at its first place. */
export function buildSteps(plan: RefreshPlan, size = BATCH_SIZE): RefreshStep[] {
	const steps: RefreshStep[] = [{ symbols: null, where: 'Nifty 50 benchmark' }];
	const seen = new Set<string>();
	const ordered: { symbol: string; sector: string }[] = [];
	for (const sector of plan.sectors) {
		for (const sub of sector.subsectors) {
			for (const raw of sub.symbols) {
				const symbol = raw.toUpperCase();
				if (seen.has(symbol)) continue;
				seen.add(symbol);
				ordered.push({ symbol, sector: sector.label });
			}
		}
	}
	steps.push(...batchSteps(ordered, size));
	return steps;
}

/** Packs symbols (already in order) into steps of at most `size`, naming the sectors each covers. */
export function batchSteps(items: { symbol: string; sector: string }[], size = BATCH_SIZE): RefreshStep[] {
	const out: RefreshStep[] = [];
	for (let i = 0; i < items.length; i += size) {
		const part = items.slice(i, i + size);
		const sectors = [...new Set(part.map((p) => p.sector))];
		out.push({
			symbols: part.map((p) => p.symbol),
			where: sectors.join(', '),
			sectorOf: Object.fromEntries(part.map((p) => [p.symbol, p.sector]))
		});
	}
	return out;
}

/** How many things the steps refresh: every company, and the benchmark counts as one. */
export const countCompanies = (steps: RefreshStep[]) => steps.reduce((n, s) => n + (s.symbols?.length ?? 1), 0);

export interface RunProgress {
	/** Steps finished / all steps (a step is the benchmark or one batch). */
	stepsDone: number;
	stepsTotal: number;
	/** Batches only, for "Batch 4/10". */
	batchIndex: number;
	batchTotal: number;
	/** Companies finished, of all. */
	done: number;
	total: number;
	ok: number;
	unlisted: number;
	failed: number;
	/** The step being worked on now. */
	current: RefreshStep | null;
	/** Companies (or the benchmark) that failed, for the summary and "Retry failed". */
	failedItems: FailedItem[];
}

export interface RunOptions {
	/** Pause before the one automatic retry of what failed, in ms. */
	retryDelayMs?: number;
	isCancelled?: () => boolean;
	onProgress?: (p: RunProgress) => void;
	send?: (step: RefreshStep) => Promise<StepResult>;
}

/** The server call for one step. A whole-request failure (network, 5xx) fails every company in it. */
export async function sendStep(step: RefreshStep): Promise<StepResult> {
	if (step.symbols === null) {
		try {
			const res = await fetch('/api/valuation/refresh-benchmark', { method: 'POST' });
			return res.ok ? { ok: 1, unlisted: 0, failed: [] } : { ok: 0, unlisted: 0, failed: ['Nifty 50'] };
		} catch {
			return { ok: 0, unlisted: 0, failed: ['Nifty 50'] };
		}
	}
	try {
		const res = await fetch('/api/valuation/refresh-batch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ symbols: step.symbols })
		});
		if (!res.ok) return { ok: 0, unlisted: 0, failed: [...step.symbols] };
		return summariseBatch(((await res.json()) as { results: { symbol: string; outcome: string }[] }).results);
	} catch {
		return { ok: 0, unlisted: 0, failed: [...step.symbols] };
	}
}

/** Maps the server's per-company outcomes onto the three counts the panel shows. */
export function summariseBatch(results: { symbol: string; outcome: string }[]): StepResult {
	const out: StepResult = { ok: 0, unlisted: 0, failed: [] };
	for (const r of results) {
		if (r.outcome === 'unlisted') out.unlisted++;
		else if (r.outcome === 'failed') out.failed.push(r.symbol);
		else out.ok++;
	}
	return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs the steps one after another (the server paces Angel One itself). Whatever failed in a step
 *  gets one automatic retry, then is reported. Stops starting new steps once cancelled; the
 *  request in flight finishes. */
export async function runSteps(steps: RefreshStep[], opts: RunOptions = {}): Promise<RunProgress> {
	const { retryDelayMs = 3000, isCancelled = () => false, onProgress = () => {} } = opts;
	const send = opts.send ?? sendStep;
	const batchTotal = steps.filter((s) => s.symbols !== null).length;
	const progress: RunProgress = {
		stepsDone: 0,
		stepsTotal: steps.length,
		batchIndex: 0,
		batchTotal,
		done: 0,
		total: countCompanies(steps),
		ok: 0,
		unlisted: 0,
		failed: 0,
		current: null,
		failedItems: []
	};
	const emit = () => onProgress({ ...progress, failedItems: [...progress.failedItems] });
	emit();

	for (const step of steps) {
		if (isCancelled()) break;
		progress.current = step;
		if (step.symbols !== null) progress.batchIndex++;
		emit();
		const size = step.symbols?.length ?? 1;
		let result = await send(step);
		if (result.failed.length > 0 && !isCancelled()) {
			await sleep(retryDelayMs);
			// Retry only what failed: the rest of the step is done.
			const again = await send({
				...step,
				symbols: step.symbols === null ? null : result.failed
			});
			result = {
				ok: result.ok + again.ok,
				unlisted: result.unlisted + again.unlisted,
				failed: again.failed
			};
		}
		progress.done += size;
		progress.ok += result.ok;
		progress.unlisted += result.unlisted;
		progress.failed += result.failed.length;
		for (const f of result.failed) {
			progress.failedItems.push({
				symbol: step.symbols === null ? null : f,
				where: step.symbols === null ? step.where : (step.sectorOf?.[f] ?? step.where)
			});
		}
		progress.stepsDone++;
		progress.current = null;
		emit();
	}
	return progress;
}

/** Steps for "Retry failed": the failed companies (benchmark first) repacked into batches. */
export function stepsForFailed(items: FailedItem[], size = BATCH_SIZE): RefreshStep[] {
	const steps: RefreshStep[] = [];
	if (items.some((i) => i.symbol === null)) steps.push({ symbols: null, where: 'Nifty 50 benchmark' });
	steps.push(
		...batchSteps(
			items.filter((i) => i.symbol !== null).map((i) => ({ symbol: i.symbol as string, sector: i.where })),
			size
		)
	);
	return steps;
}

/** New prices change every chart and sector figure built from them: forget the browser's copies. */
export function forgetSectorCards() {
	forgetCards('/api/valuation/company/');
	forgetCards('/api/valuation/sector-rotation');
}
