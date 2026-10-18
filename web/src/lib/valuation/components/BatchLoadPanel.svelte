<script lang="ts">
	// A resumable "load what is missing" button for slow background data (Screener statements,
	// 5-year highs). It asks the server which symbols are still missing, posts them in small batches
	// and reports progress; stopping part way loses nothing, because the next run asks again and only
	// fetches what is still missing. Writers only: the caller hides it from read-only accounts.
	import { onDestroy } from 'svelte';
	import { beforeNavigate } from '$app/navigation';

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

	type Phase = 'idle' | 'planning' | 'running' | 'cancelling' | 'done';
	let phase = $state<Phase>('idle');
	let total = $state(0);
	let done = $state(0);
	let ok = $state(0);
	let failed = $state<{ symbol: string; error: string }[]>([]);
	let error = $state<string | null>(null);
	let cancelled = $state(false);
	let destroyed = false;
	const busy = $derived(phase === 'planning' || phase === 'running' || phase === 'cancelling');
	const pct = $derived(total > 0 ? Math.round((done / total) * 100) : 0);

	async function start() {
		if (busy) return;
		phase = 'planning';
		error = null;
		cancelled = false;
		ok = 0;
		done = 0;
		failed = [];
		let symbols: string[];
		try {
			const res = await fetch(missingUrl);
			if (!res.ok) throw new Error(String(res.status));
			symbols = ((await res.json()) as { symbols: string[] }).symbols;
		} catch {
			error = "Couldn't load the list of companies to fetch. Try again.";
			phase = 'idle';
			return;
		}
		total = symbols.length;
		if (total === 0) {
			phase = 'done';
			return;
		}
		phase = 'running';
		for (let i = 0; i < symbols.length; i += batchSize) {
			if (cancelled || destroyed) break;
			const part = symbols.slice(i, i + batchSize);
			try {
				const res = await fetch(batchUrl, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ symbols: part })
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const body = (await res.json()) as { ok: number; failed: { symbol: string; error: string }[] };
				ok += body.ok;
				failed = [...failed, ...body.failed];
			} catch (e) {
				const message = e instanceof Error ? e.message : 'request failed';
				failed = [...failed, ...part.map((symbol) => ({ symbol, error: message }))];
			}
			done += part.length;
		}
		if (destroyed) return;
		phase = 'done';
		try {
			await onFinished();
		} catch {
			/* the page keeps what it had */
		}
	}

	function cancel() {
		cancelled = true;
		phase = 'cancelling';
	}

	beforeNavigate((nav) => {
		if (!busy || nav.willUnload) return;
		if (!confirm(`Loading ${noun} is still running. Leaving this page stops the rest of it. Leave anyway?`)) nav.cancel();
	});
	onDestroy(() => {
		destroyed = true;
		cancelled = true;
	});
</script>

<svelte:window onbeforeunload={(e) => busy && e.preventDefault()} />

<div class="bl" data-testid={testId}>
	<div class="bl-bar">
		<button type="button" class="bl-btn" disabled={busy || (missing === 0 && phase === 'idle')} onclick={start}>
			{phase === 'planning' ? 'Preparing…' : busy ? 'Loading…' : label}
		</button>
		{#if phase === 'idle'}
			<span class="bl-hint">
				{#if missing > 0}
					{missing} companies have no stored {noun}. Fetched {batchSize} at a time; you can keep using the page.
				{:else}
					Every company already has stored {noun}.
				{/if}
			</span>
		{/if}
	</div>
	{#if error}<p class="bl-error" role="alert">{error}</p>{/if}
	{#if phase !== 'idle' && phase !== 'planning'}
		<div class="bl-panel" role="status" aria-live="polite">
			{#if phase === 'done'}
				<p class="bl-line">
					{total === 0 ? `Nothing to load.` : cancelled ? 'Stopped.' : 'Finished.'}
					{#if total > 0}Stored {ok} of {total}{failed.length > 0 ? `, ${failed.length} failed` : ''}.{/if}
				</p>
				{#if failed.length > 0}
					<ul class="bl-fails">
						{#each failed.slice(0, 30) as f, i (i)}
							<li><strong>{f.symbol}</strong> {f.error}</li>
						{/each}
					</ul>
					<p class="bl-counts">Run it again to retry the failed ones.</p>
				{/if}
				<button type="button" class="bl-btn bl-secondary" onclick={() => (phase = 'idle')}>Dismiss</button>
			{:else}
				<p class="bl-line">
					{phase === 'cancelling' ? 'Stopping after the request in flight…' : `Loading ${noun}…`}
				</p>
				<div class="bl-track" role="progressbar" aria-label="Loading {noun}" aria-valuemin="0" aria-valuemax={total} aria-valuenow={done}>
					<div class="bl-fill" style="width: {pct}%"></div>
				</div>
				<p class="bl-counts">{done}/{total} companies · {failed.length} failed</p>
				{#if phase === 'running'}<button type="button" class="bl-btn bl-secondary" onclick={cancel}>Stop</button>{/if}
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
