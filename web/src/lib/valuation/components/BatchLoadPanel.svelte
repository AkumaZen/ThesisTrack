<script lang="ts">
	// A resumable "load what is missing" button for slow background data (Screener statements,
	// 5-year highs). It asks the server which symbols are still missing, posts them in small batches
	// and reports progress; stopping part way loses nothing, because the next run asks again and only
	// fetches what is still missing. The run is shared and lives outside this panel
	// (lib/valuation/valuationRuns.ts), so leaving the page does not stop it. Writers only: the caller
	// hides it from read-only accounts.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { batchLoadRun } from '$lib/valuation/valuationRuns';
	import { revealActiveRun } from '$lib/valuation/backgroundRun.svelte';

	let {
		label,
		noun,
		missingUrl,
		batchUrl,
		batchSize,
		missing,
		testId,
		onFinished
	}: {
		/** Button text, e.g. "Load missing financials". */
		label: string;
		/** What is being loaded, for sentences: "financial statements". */
		noun: string;
		/** GET -> { symbols: string[] } of what is missing. */
		missingUrl: string;
		/** POST { symbols } -> { ok: number, failed: { symbol, error }[] }. */
		batchUrl: string;
		batchSize: number;
		/** Companies the page knows are missing, for the hint. */
		missing: number;
		testId: string;
		/** Called after a run so the page can reload its data. */
		onFinished: () => Promise<void> | void;
	} = $props();

	// svelte-ignore state_referenced_locally
	const run = batchLoadRun({ title: `Loading ${noun}`, href: page.url.pathname, missingUrl, batchUrl, batchSize });
	let root: HTMLElement;
	onMount(() => {
		revealActiveRun(root, run);
		return run.attach(() => onFinished());
	});

	const phase = $derived(run.phase);
	const progress = $derived(run.progress);
	const busy = $derived(run.busy);
	const failed = $derived(progress?.failedItems ?? []);
	const pct = $derived(progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0);
</script>

<div class="bl" bind:this={root} data-testid={testId}>
	<div class="bl-bar">
		<button type="button" class="bl-btn" disabled={busy || (missing === 0 && phase === 'idle')} onclick={() => run.start()}>
			{phase === 'planning' ? 'Preparing…' : busy ? 'Loading…' : label}
		</button>
		{#if phase === 'idle'}
			<span class="bl-hint">
				{#if run.nothingToDo}
					Nothing to load: every company already has stored {noun}.
				{:else if missing > 0}
					{missing} companies have no stored {noun}. Fetched {batchSize} at a time; it keeps running while you
					use other pages.
				{:else}
					Every company already has stored {noun}.
				{/if}
			</span>
		{/if}
	</div>
	{#if run.planError}<p class="bl-error" role="alert">{run.planError}</p>{/if}
	{#if progress && phase !== 'idle' && phase !== 'planning'}
		<div class="bl-panel" role="status" aria-live="polite">
			{#if phase === 'done'}
				<p class="bl-line">
					{run.cancelled ? 'Stopped.' : 'Finished.'}
					Stored {run.allOk} of {run.total}{failed.length > 0 ? `, ${failed.length} failed` : ''}.
				</p>
				{#if failed.length > 0}
					<ul class="bl-fails">
						{#each failed.slice(0, 30) as f, i (i)}
							<li><strong>{f.symbol}</strong> {f.error ?? ''}</li>
						{/each}
					</ul>
					<p class="bl-counts">Run it again to retry the failed ones.</p>
				{/if}
				<button type="button" class="bl-btn bl-secondary" onclick={() => run.dismiss()}>Dismiss</button>
			{:else}
				<p class="bl-line">
					{phase === 'cancelling'
						? 'Stopping after the request in flight…'
						: phase === 'reloading'
							? 'Updating the page…'
							: `Loading ${noun}…`}
				</p>
				<div class="bl-track" role="progressbar" aria-label="Loading {noun}" aria-valuemin="0" aria-valuemax={progress.total} aria-valuenow={progress.done}>
					<div class="bl-fill" style="width: {pct}%"></div>
				</div>
				<p class="bl-counts">{progress.done}/{progress.total} companies · {failed.length} failed</p>
				{#if phase === 'running'}<button type="button" class="bl-btn bl-secondary" onclick={() => run.cancel()}>Stop</button>{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.bl {
		margin: 0 0 var(--space-3);
		font-family: var(--font-sans);
		min-width: 0;
	}
	.bl-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.bl-hint {
		font-size: 12px;
		color: var(--muted);
		min-width: 0;
		flex: 1 1 220px;
	}
	.bl-btn {
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
	.bl-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.bl-secondary {
		background: var(--paper);
		color: var(--ink);
	}
	.bl-panel {
		margin-top: var(--space-3);
		padding: var(--space-3);
		border: var(--border-w) solid var(--ink);
		background: var(--surface);
		min-width: 0;
	}
	.bl-line {
		margin: 0 0 var(--space-2);
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.bl-track {
		height: 10px;
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
	}
	.bl-fill {
		height: 100%;
		background: var(--ink);
		transition: width 200ms ease-out;
	}
	.bl-counts {
		margin: var(--space-2) 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--muted);
	}
	.bl-fails {
		margin: var(--space-2) 0;
		padding-left: 18px;
		max-height: 180px;
		overflow-y: auto;
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	.bl-error {
		margin: var(--space-2) 0 0;
		font-size: 12px;
		color: var(--red);
	}
	@media (prefers-reduced-motion: reduce) {
		.bl-fill {
			transition: none;
		}
	}
</style>
