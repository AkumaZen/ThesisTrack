<script lang="ts">
	// "Refresh all sectors": a button plus a live progress panel. The run itself lives in a shared
	// background run (lib/valuation/valuationRuns.ts), one small request at a time, so leaving this
	// page does not stop it; the shell's indicator shows it everywhere else.
	import { onMount } from 'svelte';
	import { fmtDuration, revealActiveRun } from '$lib/valuation/backgroundRun.svelte';
	import { refreshAllRun } from '$lib/valuation/valuationRuns';

	let { onFinished }: { onFinished: () => Promise<void> | void } = $props();

	const run = refreshAllRun();
	let root: HTMLElement;
	onMount(() => {
		revealActiveRun(root, run);
		return run.attach(() => onFinished());
	});

	const phase = $derived(run.phase);
	const progress = $derived(run.progress);
	const busy = $derived(run.busy);
	const pct = $derived(progress && progress.stepsTotal > 0 ? Math.round((progress.stepsDone / progress.stepsTotal) * 100) : 0);
	const now = $derived(progress?.current);
</script>

<div class="ra" bind:this={root}>
	<div class="ra-bar">
		<button type="button" class="ra-btn" disabled={busy} onclick={() => run.start()}>
			{phase === 'planning' ? 'Preparing…' : busy ? 'Refreshing…' : 'Refresh all sectors'}
		</button>
		{#if phase === 'idle'}
			<span class="ra-hint"
				>Brings every sector, subsector and company up to date in batches of 50. Usually under a
				minute; longer for companies with no stored prices yet. It keeps running while you use other
				pages.</span
			>
		{/if}
	</div>
	{#if run.planError}<p class="ra-error" role="alert">{run.planError}</p>{/if}

	{#if progress && phase !== 'idle'}
		<div class="ra-panel" role="status" aria-live="polite">
			{#if phase !== 'done'}
				<p class="ra-line">
					{#if phase === 'reloading'}
						Loading the new figures…
					{:else if phase === 'cancelling'}
						Cancelling… finishing the requests in flight.
					{:else}
						<span class="ra-spin" aria-hidden="true"></span>
						{#if progress.batchIndex > 0}
							Batch {progress.batchIndex}/{progress.batchTotal}
						{:else}
							Refreshing
						{/if}
						{#if now}
							<span class="ra-where">· {now.where}</span>
						{/if}
					{/if}
				</p>
				<div
					class="ra-track"
					role="progressbar"
					aria-label="Refreshing sectors"
					aria-valuemin="0"
					aria-valuemax={progress.stepsTotal}
					aria-valuenow={progress.stepsDone}
				>
					<div class="ra-fill" class:ra-active={phase === 'running'} style="width: {pct}%"></div>
				</div>
				<p class="ra-counts">
					{progress.done} of {progress.total} done · <span class:ra-bad={progress.failed > 0}>{progress.failed} failed</span>
					{#if progress.unlisted > 0}· {progress.unlisted} without a price source{/if}
				</p>
				{#if phase === 'running'}
					<button type="button" class="ra-btn ra-secondary" onclick={() => run.cancel()}>Cancel</button>
				{/if}
			{:else}
				<p class="ra-line">
					{run.cancelled ? 'Cancelled.' : 'Finished.'}
					Refreshed {run.allOk} of {run.total} in {fmtDuration(run.finishedInMs)}{run.allUnlisted > 0
						? `, ${run.allUnlisted} have no price source`
						: ''}{progress.failed > 0 ? `, ${progress.failed} failed` : ''}.
				</p>
				{#if run.cancelled && progress.total - progress.done > 0}
					<p class="ra-counts">{progress.total - progress.done} were not reached. Run it again to carry on.</p>
				{/if}
				{#if progress.unlistedItems.length > 0}
					<p class="ra-counts">
						No price source on Angel One: {progress.unlistedItems.join(', ')}
					</p>
				{/if}
				{#if progress.failedItems.length > 0}
					<ul class="ra-fails">
						{#each progress.failedItems as s, i (i)}
							<li><strong>{s.symbol ?? 'Nifty 50'}</strong> <span class="ra-where">{s.where}</span></li>
						{/each}
					</ul>
				{/if}
				<div class="ra-actions">
					{#if progress.failedItems.length > 0}
						<button type="button" class="ra-btn" onclick={() => run.retryFailed()}>Retry failed</button>
					{/if}
					<button type="button" class="ra-btn ra-secondary" onclick={() => run.dismiss()}>Dismiss</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.ra {
		margin-top: var(--space-3);
		font-family: var(--font-sans);
		min-width: 0;
	}
	.ra-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.ra-hint {
		font-size: 12px;
		color: var(--muted);
		min-width: 0;
		flex: 1 1 220px;
	}
	.ra-btn {
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
	.ra-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ra-secondary {
		background: var(--paper);
		color: var(--ink);
	}
	.ra-panel {
		margin-top: var(--space-3);
		padding: var(--space-3);
		border: var(--border-w) solid var(--ink);
		background: var(--surface);
		min-width: 0;
	}
	.ra-line {
		margin: 0 0 var(--space-2);
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.ra-where {
		font-weight: 400;
		color: var(--muted);
	}
	.ra-track {
		height: 10px;
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
	}
	.ra-fill {
		height: 100%;
		background: var(--ink);
		transition: width 200ms ease-out;
	}
	.ra-active {
		background-image: repeating-linear-gradient(
			135deg,
			transparent 0 6px,
			rgba(255, 255, 255, 0.28) 6px 12px
		);
		background-size: 17px 17px;
		animation: ra-slide 0.8s linear infinite;
	}
	.ra-counts {
		margin: var(--space-2) 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--muted);
	}
	.ra-bad {
		color: var(--red);
		font-weight: 600;
	}
	.ra-spin {
		display: inline-block;
		width: 12px;
		height: 12px;
		margin-right: 6px;
		border: 2px solid var(--ink);
		border-right-color: transparent;
		border-radius: 50%;
		vertical-align: -1px;
		animation: ra-turn 0.7s linear infinite;
	}
	.ra-fails {
		margin: var(--space-2) 0;
		padding-left: 18px;
		max-height: 180px;
		overflow-y: auto;
		font-size: 12px;
	}
	.ra-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.ra-error {
		margin: var(--space-2) 0 0;
		font-size: 12px;
		color: var(--red);
	}
	@keyframes ra-slide {
		to {
			background-position: 17px 0;
		}
	}
	@keyframes ra-turn {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ra-active,
		.ra-spin {
			animation: none;
		}
		.ra-fill {
			transition: none;
		}
	}
</style>
