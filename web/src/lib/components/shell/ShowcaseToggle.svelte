<script lang="ts">
	// Admin only: whether guests may see this company (its thesis, valuation and notes). One switch
	// per listing symbol, so the same toggle on the thesis and valuation pages stays in step.
	// When every company is shown to guests, the switch is fixed on and offers to go back to a
	// chosen list instead.
	let { symbol }: { symbol: string | null } = $props();

	let on = $state<boolean | null>(null);
	let all = $state(false);
	let saving = $state(false);
	let failure = $state('');

	$effect(() => {
		if (!symbol) return;
		const want = symbol.toUpperCase();
		let cancelled = false;
		fetch('/api/admin/showcase')
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((body: { symbols: string[]; all: boolean }) => {
				if (cancelled) return;
				on = body.symbols.includes(want);
				all = body.all;
			})
			.catch(() => {
				if (!cancelled) failure = 'Could not read guest visibility.';
			});
		return () => {
			cancelled = true;
		};
	});

	async function save(body: object): Promise<boolean> {
		saving = true;
		failure = '';
		try {
			const r = await fetch('/api/admin/showcase', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return true;
		} catch {
			failure = 'Could not save. Try again.';
			return false;
		} finally {
			saving = false;
		}
	}

	async function toggle() {
		if (!symbol || on === null || all || saving) return;
		const next = !on;
		if (await save({ symbol, showcase: next })) on = next;
	}

	async function chooseCompanies() {
		if (saving) return;
		if (await save({ all: false })) all = false;
	}
</script>

<span class="showcase" data-testid="showcase-toggle">
	{#if !symbol}
		<span class="hint">Add an NSE or BSE ticker to show this company to guests.</span>
	{:else}
		<label>
			<input
				type="checkbox"
				checked={all || on === true}
				disabled={on === null || all || saving}
				onchange={toggle}
			/>
			Show to guests
		</label>
		{#if all}
			<span class="hint">All companies are shown.</span>
			<button type="button" class="calm-btn" disabled={saving} onclick={chooseCompanies}>
				Choose companies instead
			</button>
		{/if}
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
