// "Refresh all sectors": the client walks the whole sector tree one small request at a time (Vercel
// Hobby functions time out, so no single server call could do it). Order: the Nifty 50 every sector
// is measured against, then sector by sector, subsector by subsector, each company once.
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

export interface RefreshStep {
	/** null is the Nifty 50 benchmark. */
	symbol: string | null;
	/** Where the step sits, for the progress line: "Auto & Mobility > EV Components". */
	where: string;
}

export type StepOutcome = 'ok' | 'unlisted' | 'failed';

/** Benchmark first, then every company in sector then subsector order. A company in several
 *  baskets is refreshed once, at its first place. */
export function buildSteps(plan: RefreshPlan): RefreshStep[] {
	const steps: RefreshStep[] = [{ symbol: null, where: 'Nifty 50 benchmark' }];
	const seen = new Set<string>();
	for (const sector of plan.sectors) {
		for (const sub of sector.subsectors) {
			for (const raw of sub.symbols) {
				const symbol = raw.toUpperCase();
				if (seen.has(symbol)) continue;
				seen.add(symbol);
				steps.push({ symbol, where: `${sector.label} > ${sub.label}` });
			}
		}
	}
	return steps;
}

export interface RunProgress {
	done: number;
	total: number;
	ok: number;
	unlisted: number;
	failed: number;
	/** The steps being worked on now (up to `concurrency`). */
	current: RefreshStep[];
	/** Steps that failed, for the summary and "Retry failed". */
	failedSteps: RefreshStep[];
}

export interface RunOptions {
	concurrency?: number;
	/** Pause before the one automatic retry of a failed step, in ms. */
	retryDelayMs?: number;
	isCancelled?: () => boolean;
	onProgress?: (p: RunProgress) => void;
	send?: (step: RefreshStep) => Promise<StepOutcome>;
}

/** The server call for one step. 404 means Angel One has no listing (nothing to refresh). */
export async function sendStep(step: RefreshStep): Promise<StepOutcome> {
	const url =
		step.symbol === null
			? '/api/valuation/refresh-benchmark'
			: `/api/valuation/company/${encodeURIComponent(step.symbol)}/refresh-series`;
	try {
		const res = await fetch(url, { method: 'POST' });
		if (res.ok) return 'ok';
		return res.status === 404 ? 'unlisted' : 'failed';
	} catch {
		return 'failed';
	}
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs the steps with a small bounded concurrency (Angel One's historical-data limit is about 3
 *  a second; the server also paces itself). A failed step gets one automatic retry, then is
 *  reported. Stops starting new steps once cancelled; requests already sent finish. */
export async function runSteps(steps: RefreshStep[], opts: RunOptions = {}): Promise<RunProgress> {
	const { concurrency = 2, retryDelayMs = 3000, isCancelled = () => false, onProgress = () => {} } = opts;
	const send = opts.send ?? sendStep;
	const progress: RunProgress = {
		done: 0,
		total: steps.length,
		ok: 0,
		unlisted: 0,
		failed: 0,
		current: [],
		failedSteps: []
	};
	const emit = () => onProgress({ ...progress, current: [...progress.current], failedSteps: [...progress.failedSteps] });
	const queue = [...steps];
	emit();

	async function worker() {
		for (let step = queue.shift(); step && !isCancelled(); step = queue.shift()) {
			progress.current.push(step);
			emit();
			let outcome = await send(step);
			if (outcome === 'failed' && !isCancelled()) {
				await sleep(retryDelayMs);
				outcome = await send(step);
			}
			progress.current = progress.current.filter((s) => s !== step);
			progress.done++;
			if (outcome === 'ok') progress.ok++;
			else if (outcome === 'unlisted') progress.unlisted++;
			else {
				progress.failed++;
				progress.failedSteps.push(step);
			}
			emit();
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, steps.length)) }, worker));
	return progress;
}

/** New prices change every chart and sector figure built from them: forget the browser's copies. */
export function forgetSectorCards() {
	forgetCards('/api/valuation/company/');
	forgetCards('/api/valuation/sector-rotation');
}

/** A rough run time for the progress panel: the server allows about 135 company fetches a minute. */
export function estimateMinutes(steps: number): number {
	return Math.max(1, Math.ceil(steps / 100));
}
