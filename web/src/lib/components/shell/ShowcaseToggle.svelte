<script lang="ts">
	// Admin only: whether guests may see this company (its thesis, valuation and notes). One switch
	// per listing symbol, so the same toggle on the thesis and valuation pages stays in step.
	// Pass `showcased` when the page already knows it; otherwise it is read from the admin API.
	let { symbol, showcased }: { symbol: string | null; showcased?: boolean } = $props();

	let on = $state<boolean | null>(null);
	let saving = $state(false);
	let failure = $state('');

	$effect(() => {
		if (!symbol) return;
		if (showcased !== undefined) {
			on = showcased;
			return;
		}
		const want = symbol.toUpperCase();
		let cancelled = false;
		fetch('/api/admin/showcase')
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((body: { symbols: string[] }) => {
				if (!cancelled) on = body.symbols.includes(want);
			})
			.catch(() => {
				if (!cancelled) failure = 'Could not read guest visibility.';
			});
		return () => {
			cancelled = true;
		};
	});

	async function toggle() {
		if (!symbol || on === null || saving) return;
		const next = !on;
		saving = true;
		failure = '';
		try {
			const r = await fetch('/api/admin/showcase', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ symbol, showcase: next })
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			on = next;
		} catch {
			failure = 'Could not save. Try again.';
		} finally {
			saving = false;
		}
	}
</script>

<span class="showcase" data-testid="showcase-toggle">
	{#if !symbol}
		<span class="hint">Add an NSE or BSE ticker to show this company to guests.</span>
	{:else}
		<label>
			<input type="checkbox" checked={on === true} disabled={on === null || saving} onchange={toggle} />
			Show to guests
		</label>
	{/if}
	{#if failure}<span class="hint err" role="alert">{failure}</span>{/if}
</span>

<style>
	.showcase {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px var(--space-2);
		font-size: 0.875rem;
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 40px;
		padding: 4px var(--space-3);
		border: var(--border-w) solid var(--rule);
		background: var(--surface);
		cursor: pointer;
		font-weight: 600;
	}
	input {
		width: 16px;
		height: 16px;
		accent-color: var(--ink);
	}
	.hint {
		color: var(--muted);
		font-size: 0.8125rem;
	}
	.err {
		color: var(--danger-ink);
	}
</style>
