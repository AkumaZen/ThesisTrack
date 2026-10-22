<script lang="ts">
	// Long batched jobs keep running while the person uses other pages (lib/valuation/backgroundRun).
	// This corner card shows each one wherever its own panel is not on screen: progress, Cancel, and
	// a short result with a link back once it ends. Closing or reloading the tab would end a run, so
	// the browser asks first while one is going.
	import { backgroundRuns, fmtDuration } from '$lib/valuation/backgroundRun.svelte';

	const shown = $derived(backgroundRuns.list.filter((r) => r.views === 0 && r.phase !== 'idle' && r.phase !== 'planning'));
	const anyBusy = $derived(backgroundRuns.list.some((r) => r.busy));

	function warnOnUnload(e: BeforeUnloadEvent) {
		if (anyBusy) e.preventDefault();
	}
</script>

<svelte:window onbeforeunload={warnOnUnload} />

{#if shown.length > 0}
	<aside class="bgr" aria-label="Background jobs">
		{#each shown as run, i (i)}
			{@const p = run.progress}
			<div class="bgr-card" role="status" aria-live="polite" data-testid="background-run">
				{#if run.phase === 'done'}
					<p class="bgr-title">{run.config.title}: {run.cancelled ? 'cancelled' : 'finished'}</p>
					<p class="bgr-counts">
						{run.allOk} of {run.total} done in {fmtDuration(run.finishedInMs)}{p && p.failed > 0 ? ` · ${p.failed} failed` : ''}{run.allUnlisted >
						0
							? ` · ${run.allUnlisted} without a price source`
							: ''}
					</p>
					<div class="bgr-actions">
						<a class="bgr-btn" href={run.config.href}>Details</a>
						<button type="button" class="bgr-btn bgr-quiet" onclick={() => run.dismiss()}>Dismiss</button>
					</div>
				{:else}
					<p class="bgr-title">
						{#if run.phase === 'running'}<span class="bgr-spin" aria-hidden="true"></span>{/if}
						{run.phase === 'cancelling' ? 'Cancelling…' : run.phase === 'reloading' ? 'Finishing…' : run.config.title}
					</p>
					{#if p}
						<div
							class="bgr-track"
							role="progressbar"
							aria-label={run.config.title}
							aria-valuemin="0"
							aria-valuemax={p.total}
							aria-valuenow={p.done}
						>
							<div class="bgr-fill" style="width: {p.total > 0 ? Math.round((p.done / p.total) * 100) : 0}%"></div>
						</div>
						<p class="bgr-counts">
							{p.done} of {p.total} · <span class:bgr-bad={p.failed > 0}>{p.failed} failed</span>
						</p>
					{/if}
					<div class="bgr-actions">
						<a class="bgr-btn bgr-quiet" href={run.config.href}>Open</a>
						{#if run.phase === 'running'}
							<button type="button" class="bgr-btn bgr-quiet" onclick={() => run.cancel()}>Cancel</button>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</aside>
{/if}

<style>
	.bgr {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 40;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: min(320px, calc(100vw - 32px));
		font-family: var(--font-sans);
	}
	.bgr-card {
		padding: var(--space-3);
		border: var(--border-w) solid var(--ink);
		background: var(--surface);
		box-shadow: var(--shadow-hard-sm);
		min-width: 0;
	}
	.bgr-title {
		margin: 0 0 var(--space-2);
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.bgr-track {
		height: 8px;
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
	}
	.bgr-fill {
		height: 100%;
		background: var(--ink);
		transition: width 200ms ease-out;
	}
	.bgr-counts {
		margin: var(--space-2) 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--muted);
	}
	.bgr-bad {
		color: var(--red);
		font-weight: 600;
	}
	.bgr-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.bgr-btn {
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 10px;
		border: var(--border-w) solid var(--ink);
		border-radius: 0;
		background: var(--ink);
		color: var(--surface);
		cursor: pointer;
		text-decoration: none;
	}
	.bgr-quiet {
		background: var(--paper);
		color: var(--ink);
	}
	.bgr-spin {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 6px;
		border: 2px solid var(--ink);
		border-right-color: transparent;
		border-radius: 50%;
		vertical-align: -1px;
		animation: bgr-turn 0.7s linear infinite;
	}
	@keyframes bgr-turn {
		to {
			transform: rotate(360deg);
		}
	}
	/* Phones: a slim strip along the bottom so it covers as little of the page as possible. */
	@media (max-width: 600px) {
		.bgr {
			left: 8px;
			right: 8px;
			bottom: 8px;
			width: auto;
			gap: 4px;
		}
		.bgr-card {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			column-gap: var(--space-2);
			padding: 6px 8px;
		}
		.bgr-title {
			grid-column: 1;
			margin: 0;
			font-size: 12px;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.bgr-counts {
			grid-column: 1;
			margin: 2px 0 0;
			font-size: 11px;
		}
		.bgr-actions {
			grid-column: 2;
			grid-row: 1 / span 2;
			flex-wrap: nowrap;
		}
		.bgr-track {
			grid-column: 1 / -1;
			grid-row: 3;
			height: 4px;
			margin-top: 4px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bgr-spin {
			animation: none;
		}
		.bgr-fill {
			transition: none;
		}
	}
</style>
