<script lang="ts">
	// "Load missing history": fetches the price history of the market cap list's companies that have
	// none stored yet, in small batches through a shared background run (lib/valuation/valuationRuns.ts),
	// so leaving the page does not stop it. The scanner reads stored prices only, so these companies
	// appear in the table once their history is loaded.
	import { onMount } from 'svelte';
	import { fmtDuration, revealActiveRun } from '$lib/valuation/backgroundRun.svelte';
	import { HISTORY_BATCH_SIZE } from '$lib/valuation/historyLoad';
	import { historyRun } from '$lib/valuation/valuationRuns';

	let {
		missing,
		onFinished
	}: {
		/** How many companies the page knows have no history (for the button label). */
		missing: number;
		/** Called when a run ends with the tickers that now have history. */
		onFinished: (loaded: string[]) => Promise<void> | void;
	} = $props();

	const run = historyRun();
	let root: HTMLElement;
	onMount(() => {
		revealActiveRun(root, run);
		return run.attach((loaded) => onFinished(loaded));
	});

	const phase = $derived(run.phase);
	const progress = $derived(run.progress);
	const busy = $derived(run.busy);
	const pct = $derived(progress && progress.stepsTotal > 0 ? Math.round((progress.stepsDone / progress.stepsTotal) * 100) : 0);
</script>

<div class="lh" bind:this={root} data-testid="load-history">
	<div class="lh-bar">
		<button type="button" class="lh-btn" disabled={busy || (missing === 0 && phase === 'idle')} onclick={() => run.start()} data-testid="load-history-btn">
			{phase === 'planning' ? 'Preparing…' : busy ? 'Loading…' : 'Load missing history'}
		</button>
		{#if phase === 'idle'}
			<span class="lh-hint">
				{#if missing > 0}
					{missing} companies have no stored prices yet. Fetches them {HISTORY_BATCH_SIZE} at a time; about
					{Math.max(1, Math.round(missing / 100))} minutes in all. It keeps running while you use other pages.
				{:else if run.nothingToDo}
					Nothing to load: every company already has stored prices.
				{:else}
					Every company already has stored prices.
				{/if}
			</span>
		{/if}
	</div>
	{#if run.planError}<p class="lh-error" role="alert">{run.planError}</p>{/if}

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
					<button type="button" class="lh-btn lh-secondary" onclick={() => run.cancel()}>Cancel</button>
				{/if}
			{:else}
				<p class="lh-line">
					{run.cancelled ? 'Cancelled.' : 'Finished.'}
					Loaded {run.allOk} of {run.total} in {fmtDuration(run.finishedInMs)}{run.allUnlisted > 0
						? `, ${run.allUnlisted} have no price source on Angel One`
						: ''}{progress.failed > 0 ? `, ${progress.failed} failed` : ''}.
				</p>
				{#if run.cancelled && progress.total - progress.done > 0}
					<p class="lh-counts">{progress.total - progress.done} were not reached. Run it again to carry on.</p>
				{/if}
				{#if progress.unlistedItems.length > 0}
					<p class="lh-counts">
						No price source on Angel One: {progress.unlistedItems.join(', ')}
					</p>
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
						<button type="button" class="lh-btn" onclick={() => run.retryFailed()}>Retry failed</button>
					{/if}
					<button type="button" class="lh-btn lh-secondary" onclick={() => run.dismiss()}>Dismiss</button>
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
