<script lang="ts">
	// "Load missing history": fetches the price history of the market cap list's companies that have
	// none stored yet. Driven from here in small batches (lib/valuation/historyLoad.ts), the same way
	// as Refresh all sectors, so no single server call runs long. The scanner reads stored prices only,
	// so these companies appear in the table once their history is loaded.
	import { onDestroy } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { countCompanies, forgetSectorCards, runSteps, stepsForFailed, type RefreshStep, type RunProgress } from '$lib/valuation/refreshAll';
	import { HISTORY_BATCH_SIZE, historySteps, newlyLoaded } from '$lib/valuation/historyLoad';

	let {
		missing,
		onFinished
	}: {
		/** How many companies the page knows have no history (for the button label). */
		missing: number;
		/** Called when a run ends with the tickers that now have history. */
		onFinished: (loaded: string[]) => Promise<void> | void;
	} = $props();

	type Phase = 'idle' | 'planning' | 'running' | 'cancelling' | 'reloading' | 'done';
	let phase = $state<Phase>('idle');
	let progress = $state<RunProgress | null>(null);
	let cancelled = $state(false);
	let planError = $state<string | null>(null);
	let nothingToLoad = $state(false);
	let planned: string[] = [];
	let allOk = $state(0);
	let allUnlisted = $state(0);
	let total = $state(0);
	let startedAt = 0;
	let finishedInMs = $state(0);
	let destroyed = false;

	const busy = $derived(phase !== 'idle' && phase !== 'done');
	const pct = $derived(progress && progress.stepsTotal > 0 ? Math.round((progress.stepsDone / progress.stepsTotal) * 100) : 0);

	async function fetchMissing(): Promise<string[]> {
		const res = await fetch('/api/valuation/mcap-universe/missing-history');
		if (!res.ok) throw new Error(String(res.status));
		return ((await res.json()) as { symbols: string[] }).symbols;
	}

	async function start() {
		if (busy) return;
		phase = 'planning';
		planError = null;
		nothingToLoad = false;
		cancelled = false;
		progress = null;
		allOk = 0;
		allUnlisted = 0;
		let steps: RefreshStep[];
		try {
			planned = await fetchMissing();
			steps = historySteps(planned);
		} catch {
			planError = "Couldn't load the list of companies to fetch. Try again.";
			phase = 'idle';
			return;
		}
		if (steps.length === 0) {
			nothingToLoad = true;
			phase = 'idle';
			return;
		}
		total = countCompanies(steps);
		startedAt = Date.now();
		await run(steps);
	}

	async function run(steps: RefreshStep[]) {
		phase = 'running';
		cancelled = false;
		const result = await runSteps(steps, {
			isCancelled: () => cancelled || destroyed,
			onProgress: (p) => (progress = p)
		});
		allOk += result.ok;
		allUnlisted += result.unlisted;
		if (destroyed) return;
		phase = 'reloading';
		forgetSectorCards();
		try {
			await onFinished(newlyLoaded(planned, await fetchMissing()));
		} catch {
			/* the table keeps what it had; the summary still reports what was fetched */
		}
		finishedInMs = Date.now() - startedAt;
		phase = 'done';
	}

	function cancel() {
		cancelled = true;
		phase = 'cancelling';
	}

	function retryFailed() {
		if (busy || !progress || progress.failedItems.length === 0) return;
		const steps = stepsForFailed(progress.failedItems, HISTORY_BATCH_SIZE);
		total = countCompanies(steps);
		allOk = 0;
		allUnlisted = 0;
		void run(steps);
	}

	function dismiss() {
		phase = 'idle';
		progress = null;
	}

	// Leaving the page stops the run (requests already sent still finish). Ask first.
	beforeNavigate((nav) => {
		if (!busy || nav.willUnload) return;
		if (!confirm('Loading price history is still running. Leaving this page cancels the rest of it. Leave anyway?')) {
			nav.cancel();
		}
	});
	function warnOnUnload(e: BeforeUnloadEvent) {
		if (busy) e.preventDefault();
	}
	onDestroy(() => {
		destroyed = true;
		cancelled = true;
	});

	function fmtDuration(ms: number) {
		const s = Math.round(ms / 1000);
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
	}
</script>

<svelte:window onbeforeunload={warnOnUnload} />

<div class="lh" data-testid="load-history">
	<div class="lh-bar">
		<button type="button" class="lh-btn" disabled={busy || (missing === 0 && phase === 'idle')} onclick={start} data-testid="load-history-btn">
			{phase === 'planning' ? 'Preparing…' : busy ? 'Loading…' : 'Load missing history'}
		</button>
		{#if phase === 'idle'}
			<span class="lh-hint">
				{#if missing > 0}
					{missing} companies have no stored prices yet. Fetches them {HISTORY_BATCH_SIZE} at a time; about
					{Math.max(1, Math.round(missing / 100))} minutes in all. You can keep using the page.
				{:else if nothingToLoad}
					Nothing to load: every company already has stored prices.
				{:else}
					Every company already has stored prices.
				{/if}
			</span>
		{/if}
	</div>
	{#if planError}<p class="lh-error" role="alert">{planError}</p>{/if}

	{#if progress && phase !== 'idle'}
		<div class="lh-panel" role="status" aria-live="polite">
			{#if phase !== 'done'}
				<p class="lh-line">
					{#if phase === 'reloading'}
						Updating the table…
					{:else if phase === 'cancelling'}
						Cancelling… finishing the request in flight.
					{:else}
						<span class="lh-spin" aria-hidden="true"></span>
						Batch {progress.batchIndex}/{progress.batchTotal}
					{/if}
				</p>
				<div
					class="lh-track"
					role="progressbar"
					aria-label="Loading price history"
					aria-valuemin="0"
					aria-valuemax={progress.stepsTotal}
					aria-valuenow={progress.stepsDone}
				>
					<div class="lh-fill" style="width: {pct}%"></div>
				</div>
				<p class="lh-counts" data-testid="load-history-progress">
					{progress.done}/{progress.total} companies · <span class:lh-bad={progress.failed > 0}>{progress.failed} failed</span>
					{#if progress.unlisted > 0}· {progress.unlisted} without a price source{/if}
				</p>
				{#if phase === 'running'}
					<button type="button" class="lh-btn lh-secondary" onclick={cancel}>Cancel</button>
				{/if}
			{:else}
				<p class="lh-line">
					{cancelled ? 'Cancelled.' : 'Finished.'}
					Loaded {allOk} of {total} in {fmtDuration(finishedInMs)}{allUnlisted > 0
						? `, ${allUnlisted} have no price source on Angel One`
						: ''}{progress.failed > 0 ? `, ${progress.failed} failed` : ''}.
				</p>
				{#if cancelled && progress.total - progress.done > 0}
					<p class="lh-counts">{progress.total - progress.done} were not reached. Run it again to carry on.</p>
				{/if}
				{#if progress.failedItems.length > 0}
					<ul class="lh-fails">
						{#each progress.failedItems as s, i (i)}
							<li><strong>{s.symbol}</strong></li>
						{/each}
					</ul>
				{/if}
				<div class="lh-actions">
					{#if progress.failedItems.length > 0}
						<button type="button" class="lh-btn" onclick={retryFailed}>Retry failed</button>
					{/if}
					<button type="button" class="lh-btn lh-secondary" onclick={dismiss}>Dismiss</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.lh {
		margin: 0 0 var(--space-3);
		font-family: var(--font-sans);
		min-width: 0;
	}
	.lh-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.lh-hint {
		font-size: 12px;
		color: var(--muted);
		min-width: 0;
		flex: 1 1 220px;
	}
	.lh-btn {
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		padding: 6px 12px;
		border: var(--border-w) solid var(--ink);
		border-radius: 0;
		background: var(--ink);
		color: var(--surface);
		cursor: pointer;
	}
	.lh-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.lh-secondary {
		background: var(--paper);
		color: var(--ink);
	}
	.lh-panel {
		margin-top: var(--space-3);
		padding: var(--space-3);
		border: var(--border-w) solid var(--ink);
		background: var(--surface);
		min-width: 0;
	}
	.lh-line {
		margin: 0 0 var(--space-2);
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.lh-track {
		height: 10px;
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
	}
	.lh-fill {
		height: 100%;
		background: var(--ink);
		transition: width 200ms ease-out;
	}
	.lh-counts {
		margin: var(--space-2) 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--muted);
	}
	.lh-bad {
		color: var(--red);
		font-weight: 600;
	}
	.lh-spin {
		display: inline-block;
		width: 12px;
		height: 12px;
		margin-right: 6px;
		border: 2px solid var(--ink);
		border-right-color: transparent;
		border-radius: 50%;
		vertical-align: -1px;
		animation: lh-turn 0.7s linear infinite;
	}
	.lh-fails {
		margin: var(--space-2) 0;
		padding-left: 18px;
		max-height: 180px;
		overflow-y: auto;
		font-size: 12px;
	}
	.lh-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.lh-error {
		margin: var(--space-2) 0 0;
		font-size: 12px;
		color: var(--red);
	}
	@keyframes lh-turn {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.lh-spin {
			animation: none;
		}
		.lh-fill {
			transition: none;
		}
	}
</style>
