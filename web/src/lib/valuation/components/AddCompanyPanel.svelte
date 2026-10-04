<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import CompanyPicker from '$lib/components/CompanyPicker.svelte';
	import { sectorApi } from '$lib/valuation/sectorClient';
	import type { SymbolHit } from '$lib/valuation/symbolSearch';

	// The watchlist's company box: find any listed company by name and open it, or add one with its
	// history filled in (financial statements from Screener.in, ~700 days of prices from Angel One)
	// and put it on the watchlist with its starting valuation; an admin can also put it straight
	// into a sector basket. The valuation is then refined on the company page.
	let {
		canWrite,
		isAdmin,
		onAdded
	}: {
		canWrite: boolean;
		isAdmin: boolean;
		/** Called once a company has been put on the watchlist, so the list can show it. */
		onAdded?: () => void;
	} = $props();

	let adding = $state(false);
	let chosen = $state<SymbolHit | null>(null);
	let basketKey = $state('');
	let groups = $state<{ label: string; baskets: { key: string; label: string }[] }[]>([]);
	let busy = $state(false);
	let steps = $state<{ text: string; tone: 'ok' | 'warn' | 'bad' | 'run' }[]>([]);
	let done = $state<{ symbol: string; name: string } | null>(null);
	let suggestions = $state<{ symbol: string; name: string }[]>([]);

	async function openAdd() {
		adding = true;
		done = null;
		steps = [];
		if (isAdmin && groups.length === 0) {
			try {
				const res = await fetch('/api/valuation/sectors');
				const t = (await res.json()) as {
					majors: { label: string; subsectorKeys: string[] }[];
					baskets: { key: string; label: string }[];
				};
				const byKey = new Map(t.baskets.map((b) => [b.key, b]));
				groups = t.majors.map((m) => ({
					label: m.label,
					baskets: m.subsectorKeys.map((k) => byKey.get(k)).filter((b): b is { key: string; label: string } => !!b)
				}));
			} catch {
				groups = [];
			}
		}
	}

	function reset() {
		chosen = null;
		basketKey = '';
		steps = [];
		done = null;
		suggestions = [];
	}

	async function add(symbol = chosen?.symbol) {
		if (!symbol) return;
		busy = true;
		done = null;
		suggestions = [];
		steps = [{ text: 'Checking the company and reading its financial statements and prices…', tone: 'run' }];
		try {
			const res = await fetch('/api/valuation/company-add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ symbol })
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? `Could not add it (HTTP ${res.status}).`);
			if (!body.ok) {
				steps = [{ text: body.reason, tone: 'bad' }];
				suggestions = body.suggestions ?? [];
				return;
			}
			const out: typeof steps = [];
			out.push(
				body.fundamentals
					? { text: 'Financial statements and ratios filled in from Screener.in.', tone: 'ok' }
					: { text: `Financial statements could not be read: ${body.fundamentalsError}`, tone: 'bad' }
			);
			out.push(
				!body.listedOnAngelOne
					? { text: 'Angel One does not list it, so there is no price chart.', tone: 'warn' }
					: body.priceSessions
						? { text: `Price history filled in: ${body.priceSessions} trading days.`, tone: 'ok' }
						: { text: `Prices could not be fetched: ${body.pricesError}`, tone: 'bad' }
			);
			out.push(
				body.watchlist === 'added'
					? { text: 'Added to the watchlist.', tone: 'ok' }
					: body.watchlist === 'already'
						? { text: 'Already on the watchlist; its valuation is unchanged.', tone: 'ok' }
						: {
								text: `Not added to the watchlist: ${body.watchlistError ?? 'its financial statements are needed first.'}`,
								tone: 'bad'
							}
			);
			if (basketKey) {
				const added = await sectorApi('POST', `/api/valuation/sectors/baskets/${basketKey}/symbols`, {
					symbol: body.symbol
				});
				const basketLabel = groups.flatMap((g) => g.baskets).find((b) => b.key === basketKey)?.label ?? basketKey;
				out.push(
					added.ok
						? { text: `Added to the ${basketLabel} basket.`, tone: 'ok' }
						: { text: `Not added to ${basketLabel}: ${added.message}`, tone: 'bad' }
				);
			}
			steps = out;
			done = { symbol: body.symbol, name: body.name };
			if (body.watchlist === 'added') onAdded?.();
		} catch (e) {
			steps = [{ text: e instanceof Error ? e.message : 'Could not add it.', tone: 'bad' }];
		} finally {
			busy = false;
		}
	}
</script>

<div class="company-search">
	<label for="companySearch" class="field-label" style="display:block;margin-bottom:6px">Find a company</label>
	<CompanyPicker
		id="companySearch"
		label="Find a company by name or ticker"
		placeholder="Type a name or ticker, e.g. Reliance, Tata Consultancy, TCS"
		onPick={(hit) => goto(resolve('/valuation/company/[symbol]', { symbol: hit.symbol }))}
	/>

	{#if canWrite}
		{#if !adding}
			<button type="button" class="wl-strip-btn ac-open" data-testid="add-company" onclick={openAdd}
				>+ Add company</button
			>
		{:else}
			<section class="ac-panel" aria-labelledby="ac-title" data-testid="add-company-panel">
				<div class="ac-head">
					<h2 id="ac-title" class="ac-title">Add a company</h2>
					<button type="button" class="link-btn" onclick={() => ((adding = false), reset())}>Close</button>
				</div>
				<p class="ac-hint">
					Pick the company by name. Its financial statements and price history are filled in for you,
					and it goes on the watchlist. Refine its valuation on its page.
				</p>

				<label for="addCompanyPick" class="ac-label">Company</label>
				{#if chosen}
					<div class="ac-chosen">
						<span><strong>{chosen.name}</strong> <span class="ac-ticker">{chosen.symbol}</span></span>
						{#if chosen.tracked}<span class="cp-tag-static">Already tracked</span>{/if}
						{#if chosen.priceable === false}<span class="cp-tag-static warn">No price chart</span>{/if}
						<button type="button" class="link-btn" disabled={busy} onclick={reset}>Change</button>
					</div>
				{:else}
					<CompanyPicker
						id="addCompanyPick"
						label="Company to add"
						placeholder="Type a name or ticker"
						onPick={(hit) => (chosen = hit)}
					/>
				{/if}

				{#if isAdmin}
					<label for="addCompanyBasket" class="ac-label">Sector basket (optional)</label>
					<select id="addCompanyBasket" class="sm-input ac-select" bind:value={basketKey} disabled={busy}>
						<option value="">Not in a basket</option>
						{#each groups as g (g.label)}
							<optgroup label={g.label}>
								{#each g.baskets as b (b.key)}<option value={b.key}>{b.label}</option>{/each}
							</optgroup>
						{/each}
					</select>
				{/if}

				<div class="ac-actions">
					<button type="button" class="wl-strip-btn btn-primary" disabled={!chosen || busy || done != null} onclick={() => add()}
						>{busy ? 'Adding…' : 'Add company'}</button
					>
					{#if done}
						<a class="wl-strip-btn" href={resolve('/valuation/company/[symbol]', { symbol: done.symbol })}
							>Open {done.name} &rarr;</a
						>
					{/if}
				</div>

				{#if steps.length}
					<ul class="ac-steps" role="status">
						{#each steps as s (s.text)}<li class="ac-step ac-{s.tone}">{s.text}</li>{/each}
					</ul>
				{/if}
				{#if suggestions.length}
					<div class="ac-suggest">
						<span>Did you mean:</span>
						{#each suggestions as s (s.symbol)}
							<button type="button" class="link-btn" onclick={() => add(s.symbol)}>{s.name} ({s.symbol})</button>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	{/if}
</div>

<style>
	.ac-open {
		margin-top: var(--space-3);
	}
	.ac-panel {
		margin-top: var(--space-3);
		padding: var(--space-3);
		border: var(--border-w) solid var(--ink);
		box-shadow: var(--shadow-hard);
		background: var(--bg);
		text-align: left;
	}
	.ac-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.ac-title {
		margin: 0;
		font-size: 1.125rem;
	}
	.ac-hint {
		margin: var(--space-2) 0 var(--space-3);
		font-size: 13px;
		color: var(--muted);
	}
	.ac-label {
		display: block;
		margin: var(--space-3) 0 6px;
		font-size: 13px;
		font-weight: 600;
	}
	.ac-select {
		width: 100%;
	}
	.ac-chosen {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border: var(--border-w) solid var(--ink);
		background: var(--accent-soft);
	}
	.ac-ticker {
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		color: var(--muted);
	}
	.cp-tag-static {
		font-size: 11px;
		padding: 1px 6px;
		border: 1px solid var(--ink);
	}
	.cp-tag-static.warn {
		border-color: var(--warn);
		color: var(--warn);
	}
	.ac-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.ac-steps {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		font-size: 13px;
	}
	.ac-step {
		padding: 4px 0 4px 18px;
		position: relative;
	}
	.ac-step::before {
		position: absolute;
		left: 0;
		font-weight: 700;
	}
	.ac-ok::before {
		content: '✓';
		color: var(--good);
	}
	.ac-warn::before {
		content: '!';
		color: var(--warn);
	}
	.ac-bad::before {
		content: '✕';
		color: var(--danger);
	}
	.ac-run::before {
		content: '…';
		color: var(--muted);
	}
	.ac-suggest {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: var(--space-2);
		font-size: 13px;
	}
</style>
