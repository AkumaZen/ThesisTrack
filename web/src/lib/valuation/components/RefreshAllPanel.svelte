<script lang="ts">
	// "Refresh all sectors": a button plus a live progress panel. The work is driven from here, one
	// small request at a time (see lib/valuation/refreshAll.ts), so no single server call runs long.
	import { onDestroy } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import {
		buildSteps,
		estimateMinutes,
		forgetSectorCards,
		runSteps,
		type RefreshPlan,
		type RefreshStep,
		type RunProgress
	} from '$lib/valuation/refreshAll';

	let { onFinished }: { onFinished: () => Promise<void> | void } = $props();

	type Phase = 'idle' | 'planning' | 'running' | 'cancelling' | 'reloading' | 'done';
	let phase = $state<Phase>('idle');
	let progress = $state<RunProgress | null>(null);
	let cancelled = $state(false);
	let planError = $state<string | null>(null);
	let stepsTotal = $state(0);
	// Totals across the first run and any "Retry failed" runs, so the summary stays honest.
	let allOk = $state(0);
	let allUnlisted = $state(0);
	let startedAt = 0;
	let finishedInMs = $state(0);
	let destroyed = false;

	const busy = $derived(phase !== 'idle' && phase !== 'done');
	const pct = $derived(progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0);
	const now = $derived(progress?.current[0]);

	async function start() {
		if (busy) return;
		phase = 'planning';
		planError = null;
		cancelled = false;
		progress = null;
		allOk = 0;
		allUnlisted = 0;
		let steps: RefreshStep[];
		try {
			const res = await fetch('/api/valuation/sector-refresh-plan');
			if (!res.ok) throw new Error(String(res.status));
			steps = buildSteps((await res.json()) as RefreshPlan);
		} catch {
			planError = "Couldn't load the list of sectors to refresh. Try again.";
			phase = 'idle';
			return;
		}
		stepsTotal = steps.length;
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
		// Show the new prices: forget the browser's copies and let the page reload its cards.
		phase = 'reloading';
		forgetSectorCards();
		try {
			await onFinished();
		} catch {
			/* the cards keep their old figures; the summary still reports what was refreshed */
		}
		finishedInMs = Date.now() - startedAt;
		phase = 'done';
	}

	function cancel() {
		cancelled = true;
		phase = 'cancelling';
	}

	function retryFailed() {
		if (busy || !progress || progress.failedSteps.length === 0) return;
		stepsTotal = progress.failedSteps.length;
		allOk = 0;
		allUnlisted = 0;
		void run(progress.failedSteps);
	}

	function dismiss() {
		phase = 'idle';
		progress = null;
	}

	// Leaving the page stops the run (requests already sent still finish). Ask first, because the
	// rest of the sectors would be left with yesterday's prices.
	beforeNavigate((nav) => {
		if (!busy || nav.willUnload) return;
		if (!confirm('A refresh is still running. Leaving this page cancels the rest of it. Leave anyway?')) {
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

<div class="ra">
	<div class="ra-bar">
		<button type="button" class="ra-btn" disabled={busy} onclick={start}>
			{phase === 'planning' ? 'Preparing…' : busy ? 'Refreshing…' : 'Refresh all sectors'}
		</button>
		{#if phase === 'idle'}
			<span class="ra-hint"
				>Fetches new prices for every sector, subsector and company, one at a time. Takes several
				minutes; you can keep using the page.</span
			>
		{/if}
	</div>
	{#if planError}<p class="ra-error" role="alert">{planError}</p>{/if}

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
						Refreshing {Math.min(progress.done + 1, progress.total)} / {progress.total}
						{#if now}
							<span class="ra-where">· {now.where}{now.symbol ? ` · ${now.symbol}` : ''}</span>
						{/if}
					{/if}
				</p>
				<div
					class="ra-track"
					role="progressbar"
					aria-label="Refreshing sectors"
					aria-valuemin="0"
					aria-valuemax={progress.total}
					aria-valuenow={progress.done}
				>
					<div class="ra-fill" class:ra-active={phase === 'running'} style="width: {pct}%"></div>
				</div>
				<p class="ra-counts">
					{progress.done} done · <span class:ra-bad={progress.failed > 0}>{progress.failed} failed</span>
					{#if progress.unlisted > 0}· {progress.unlisted} without a price source{/if}
					{#if phase === 'running' && stepsTotal > 20}· about {estimateMinutes(stepsTotal)} min in all{/if}
				</p>
				{#if phase === 'running'}
					<button type="button" class="ra-btn ra-secondary" onclick={cancel}>Cancel</button>
				{/if}
			{:else}
				<p class="ra-line">
					{cancelled ? 'Cancelled.' : 'Finished.'}
					Refreshed {allOk} of {stepsTotal} in {fmtDuration(finishedInMs)}{allUnlisted > 0
						? `, ${allUnlisted} have no price source`
						: ''}{progress.failed > 0 ? `, ${progress.failed} failed` : ''}.
				</p>
				{#if cancelled && progress.total - progress.done > 0}
					<p class="ra-counts">{progress.total - progress.done} were not reached. Run it again to carry on.</p>
				{/if}
				{#if progress.failedSteps.length > 0}
					<ul class="ra-fails">
						{#each progress.failedSteps as s, i (i)}
							<li><strong>{s.symbol ?? 'Nifty 50'}</strong> <span class="ra-where">{s.where}</span></li>
						{/each}
					</ul>
				{/if}
				<div class="ra-actions">
					{#if progress.failedSteps.length > 0}
						<button type="button" class="ra-btn" onclick={retryFailed}>Retry failed</button>
					{/if}
					<button type="button" class="ra-btn ra-secondary" onclick={dismiss}>Dismiss</button>
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
