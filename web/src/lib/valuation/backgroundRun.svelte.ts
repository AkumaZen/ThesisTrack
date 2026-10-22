// Long batched jobs (Refresh all sectors, Load missing history, Load missing financials, Load 5-year
// highs) run here, at module level, instead of inside the panel that starts them. A panel is only a
// view of its run: leaving the page unmounts the panel but the run carries on, and the shell's
// BackgroundRuns indicator shows it (with Cancel) on every other page. Coming back shows the live run.
// A full reload or closing the tab still ends it; the indicator warns before that.
import { runSteps, stepsForFailed, countCompanies, type RefreshStep, type RunProgress, type StepResult } from './refreshAll';

export type RunPhase = 'idle' | 'planning' | 'running' | 'cancelling' | 'reloading' | 'done';

export interface RunConfig<T> {
	/** Short name for the global indicator: "Refreshing all sectors". */
	title: string;
	/** The page that starts the run, for the indicator's link. */
	href: string;
	/** Batch size for "Retry failed". */
	retrySize: number;
	/** The steps for a new run; an empty list means there is nothing to do. */
	plan: () => Promise<RefreshStep[]>;
	/** One step's server call (runSteps' default when omitted). */
	send?: (step: RefreshStep) => Promise<StepResult>;
	/** Work after every run, whether or not a page is open; its value goes to the listeners. */
	afterRun?: () => Promise<T>;
	/** Pause before runSteps' automatic retry, in ms (tests set 0). */
	retryDelayMs?: number;
}

export class BackgroundRun<T = void> {
	phase = $state<RunPhase>('idle');
	progress = $state<RunProgress | null>(null);
	cancelled = $state(false);
	planError = $state<string | null>(null);
	nothingToDo = $state(false);
	/** Companies in the current run (the first one or a "Retry failed"). */
	total = $state(0);
	/** Totals across the run and its retries, so the summary stays honest. */
	allOk = $state(0);
	allUnlisted = $state(0);
	finishedInMs = $state(0);
	/** Panels showing this run right now; the global indicator stays out of their way. */
	views = $state(0);
	readonly busy = $derived(this.phase !== 'idle' && this.phase !== 'done');

	private startedAt = 0;
	private readonly listeners = new Set<(value: T) => Promise<void> | void>();

	constructor(readonly config: RunConfig<T>) {}

	/** A mounted panel shows this run; `onFinished` reloads its page's data when a run ends.
	 *  Returns the detach for the panel's teardown. */
	attach(onFinished: (value: T) => Promise<void> | void): () => void {
		this.listeners.add(onFinished);
		this.views++;
		return () => {
			this.listeners.delete(onFinished);
			this.views--;
		};
	}

	async start() {
		if (this.busy) return;
		this.phase = 'planning';
		this.planError = null;
		this.nothingToDo = false;
		this.cancelled = false;
		this.progress = null;
		this.allOk = 0;
		this.allUnlisted = 0;
		let steps: RefreshStep[];
		try {
			steps = await this.config.plan();
		} catch {
			this.planError = "Couldn't load the list of companies to fetch. Try again.";
			this.phase = 'idle';
			return;
		}
		if (steps.length === 0) {
			this.nothingToDo = true;
			this.phase = 'idle';
			return;
		}
		this.startedAt = Date.now();
		await this.run(steps);
	}

	retryFailed() {
		if (this.busy || !this.progress || this.progress.failedItems.length === 0) return;
		const steps = stepsForFailed(this.progress.failedItems, this.config.retrySize);
		this.allOk = 0;
		this.allUnlisted = 0;
		this.startedAt = Date.now();
		void this.run(steps);
	}

	cancel() {
		if (this.phase !== 'running') return;
		this.cancelled = true;
		this.phase = 'cancelling';
	}

	dismiss() {
		if (this.busy) return;
		this.phase = 'idle';
		this.progress = null;
	}

	private async run(steps: RefreshStep[]) {
		this.phase = 'running';
		this.cancelled = false;
		this.total = countCompanies(steps);
		const result = await runSteps(steps, {
			send: this.config.send,
			retryDelayMs: this.config.retryDelayMs,
			isCancelled: () => this.cancelled,
			onProgress: (p) => (this.progress = p)
		});
		this.allOk += result.ok;
		this.allUnlisted += result.unlisted;
		this.phase = 'reloading';
		try {
			const value = (await this.config.afterRun?.()) as T;
			await Promise.all([...this.listeners].map((fn) => fn(value)));
		} catch {
			/* the pages keep their old figures; the summary still reports what was done */
		}
		this.finishedInMs = Date.now() - this.startedAt;
		this.phase = 'done';
	}
}

/** Every run the shell's indicator lists. Runs are created on first use and live for the tab. */
export const backgroundRuns = $state<{ list: BackgroundRun<unknown>[] }>({ list: [] });

/** The run for `key`, created from `make` the first time. */
export function getRun<T>(key: string, make: () => RunConfig<T>): BackgroundRun<T> {
	const found = registry.get(key);
	if (found) return found as BackgroundRun<T>;
	const run = new BackgroundRun<T>(make());
	registry.set(key, run as BackgroundRun<unknown>);
	backgroundRuns.list.push(run as BackgroundRun<unknown>);
	return run;
}
const registry = new Map<string, BackgroundRun<unknown>>();

export function fmtDuration(ms: number) {
	const s = Math.round(ms / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Opens the collapsed sections around a run's panel when the run is going or has a result, so
 *  coming back to the page shows the progress instead of a closed "Data" section. */
export function revealActiveRun(panel: HTMLElement, run: { phase: RunPhase }) {
	if (run.phase === 'idle') return;
	for (let el = panel.parentElement?.closest('details'); el; el = el.parentElement?.closest('details')) el.open = true;
}
