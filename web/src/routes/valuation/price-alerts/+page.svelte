<script lang="ts">
	import '$lib/valuation/styles/marketIntel.css';
	import { invalidateAll } from '$app/navigation';
	import CompanyPicker from '$lib/components/CompanyPicker.svelte';
	import { sectorApi } from '$lib/valuation/sectorClient';
	import { describePriceRule, PRICE_ALERT_KINDS, PRICE_ALERT_LABELS, type PriceAlertKind } from '$lib/valuation/alertRules';
	import type { SymbolHit } from '$lib/valuation/symbolSearch';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let picked = $state<SymbolHit | null>(null);
	let pickerText = $state('');
	let kind = $state<PriceAlertKind>('above');
	let threshold = $state('');
	let busy = $state(false);
	let status = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	const percent = $derived(kind === 'pct_up' || kind === 'pct_down');
	const inr = (n: number | null) => (n == null ? 'n/a' : `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
	const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (!picked) {
			status = { kind: 'error', text: 'Search and pick a company first.' };
			return;
		}
		busy = true;
		status = null;
		const res = await sectorApi('POST', '/api/valuation/price-alerts', { symbol: picked.nseSymbol ?? picked.symbol, name: picked.name, kind, threshold: Number(threshold) });
		busy = false;
		if (!res.ok) {
			status = { kind: 'error', text: res.message };
			return;
		}
		status = { kind: 'ok', text: `Alert added for ${picked.name}.` };
		picked = null;
		pickerText = '';
		threshold = '';
		await invalidateAll();
	}

	async function remove(id: number) {
		const res = await sectorApi('DELETE', `/api/valuation/price-alerts/${id}`);
		status = res.ok ? { kind: 'ok', text: 'Alert removed.' } : { kind: 'error', text: res.message };
		await invalidateAll();
	}

	async function rearm(id: number) {
		const res = await sectorApi('PATCH', `/api/valuation/price-alerts/${id}`);
		status = res.ok ? { kind: 'ok', text: 'Alert is on again.' } : { kind: 'error', text: res.message };
		await invalidateAll();
	}

	let promoter = $state<string | null>(null);
	let fii = $state<string | null>(null);
	let dii = $state<string | null>(null);
	const val = (edited: string | null, saved: number | null) => edited ?? (saved == null ? '' : String(saved));

	async function saveHolding(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		const res = await sectorApi('PUT', '/api/valuation/holding-alerts', {
			promoterPp: val(promoter, data.holding.promoterPp),
			fiiPp: val(fii, data.holding.fiiPp),
			diiPp: val(dii, data.holding.diiPp)
		});
		busy = false;
		status = res.ok ? { kind: 'ok', text: 'Shareholding alert settings saved.' } : { kind: 'error', text: res.message };
		if (res.ok) {
			promoter = fii = dii = null;
			await invalidateAll();
		}
	}
</script>

<svelte:head>
	<title>Alerts - ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Price alerts</h1>
		<div class="sub">Get notified when a price level is hit or holdings shift.</div>
	</div>
</div>

<div class="wrap mi pa">
	<form class="mi-box" onsubmit={create} aria-labelledby="mi-new">
		<h2 id="mi-new">New price alert</h2>
		<div class="pa-form">
			<div class="mi-field pa-company">
				<label for="paSearch" class="pa-sr">Company</label>
				<CompanyPicker id="paSearch" label="Search a company for the alert" placeholder="Company name or ticker" bind:value={pickerText} clearOnPick={false} disabled={busy} onPick={(hit) => { picked = hit; pickerText = hit.name; }} />
			</div>
			<label class="mi-field">
				<span class="pa-sr">When</span>
				<select bind:value={kind} aria-label="When">
					{#each PRICE_ALERT_KINDS as k (k)}
						<option value={k}>{PRICE_ALERT_LABELS[k]}</option>
					{/each}
				</select>
			</label>
			<label class="mi-field">
				<span class="pa-sr">{percent ? 'Percent' : 'Price (Rs)'}</span>
				<input class="sm-input" bind:value={threshold} type="number" min="0" step="any" inputmode="decimal" required placeholder={percent ? 'Percent' : 'Price (Rs)'} aria-label={percent ? 'Percent' : 'Price (Rs)'} />
			</label>
			<button class="sm-btn sm-btn-primary pa-add" type="submit" disabled={busy}>Add alert</button>
		</div>
		{#if picked}<span class="sm-hint">Selected: {picked.name} ({picked.nseSymbol ?? picked.symbol})</span>{/if}
		{#if percent}
			<p class="sm-hint">A percentage move is measured from the latest stored price when you add the alert.</p>
		{/if}
	</form>

	{#if status}<p class="sm-msg sm-msg-{status.kind}" role="status">{status.text}</p>{/if}

	<section class="mi-box" aria-labelledby="mi-list">
		<h2 id="mi-list">Your price alerts</h2>
		{#if data.rules.length === 0}
			<p class="sm-empty" data-testid="rules-empty">No price alerts yet.</p>
		{:else}
			<ul class="mi-list" data-testid="rules">
				{#each data.rules as r (r.id)}
					<li class="mi-item">
						<div class="mi-meta">
							<span class="tag {r.active ? 'tag-info' : 'tag-muted'}">{r.active ? 'Watching' : 'Fired'}</span>
							{#if r.triggeredAt}<span>{when(r.triggeredAt)} at {inr(r.triggeredPrice)}</span>{/if}
						</div>
						<div class="mi-title">
							<a href="/valuation/company/{encodeURIComponent(r.nseSymbol)}">{r.nseSymbol}</a>
							<span class="mi-muted"> {r.companyName}</span>
						</div>
						<p class="mi-text">{describePriceRule({ kind: r.kind as PriceAlertKind, threshold: r.threshold, basePrice: r.basePrice })}</p>
						<p class="mi-text mi-muted">Latest stored price: {inr(r.price)}</p>
						<div class="mi-row pa-actions">
							{#if !r.active}<button class="calm-btn" type="button" onclick={() => rearm(r.id)}>Turn on again</button>{/if}
							<button class="calm-btn is-danger" type="button" onclick={() => remove(r.id)} aria-label="Remove alert for {r.nseSymbol}">Remove</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<details class="calm-disclosure pa-hold">
		<summary>Shareholding change alerts</summary>
		<form class="mi-box" onsubmit={saveHolding} aria-labelledby="mi-hold" data-testid="holding-form">
			<h2 id="mi-hold" class="pa-sr">Shareholding change alerts</h2>
			<p class="sm-hint">
				When a tracked company reports a new quarter, you are told if a group's share moved by at least this many
				percentage points. Leave a field empty to turn it off.
			</p>
			<div class="mi-form">
				<label class="mi-field">Promoter (points)<input class="sm-input" type="number" min="0" max="50" step="any" inputmode="decimal" value={val(promoter, data.holding.promoterPp)} oninput={(e) => (promoter = e.currentTarget.value)} /></label>
				<label class="mi-field">FII (points)<input class="sm-input" type="number" min="0" max="50" step="any" inputmode="decimal" value={val(fii, data.holding.fiiPp)} oninput={(e) => (fii = e.currentTarget.value)} /></label>
				<label class="mi-field">DII (points)<input class="sm-input" type="number" min="0" max="50" step="any" inputmode="decimal" value={val(dii, data.holding.diiPp)} oninput={(e) => (dii = e.currentTarget.value)} /></label>
			</div>
			<div class="mi-row"><button class="sm-btn sm-btn-primary" type="submit" disabled={busy}>Save</button></div>
		</form>
	</details>

	<p class="sm-hint pa-delivery" data-testid="delivery">
		{#if data.delivery.push || data.delivery.telegram}
			Sent to {[data.delivery.push ? 'your devices' : '', data.delivery.telegram ? 'Telegram' : ''].filter(Boolean).join(' and ')}.
		{:else}
			No device or Telegram chat is connected, so alerts would not reach you.
			{data.delivery.pushAvailable ? '' : 'Push is not set up on the server yet.'}
		{/if}
	</p>
</div>

<style>
	.pa {
		gap: 1.5rem;
		margin-top: 1rem;
	}
	.pa-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	:global(.vd) .pa .mi-box {
		border: 0;
		padding: 0;
		background: none;
	}
	:global(.vd) .pa .mi-item {
		border: 0;
		border-bottom: 1px solid var(--rule);
		padding: 0.8rem 0;
		background: none;
	}
	:global(.vd) .pa .mi-list {
		gap: 0;
	}
	.pa-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.6rem;
		align-items: end;
	}
	.pa-add {
		justify-self: start;
		min-height: 2.75rem;
	}
	@media (min-width: 760px) {
		.pa-form {
			grid-template-columns: minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1fr) auto;
		}
	}
	.pa-actions {
		margin-left: -0.5rem;
	}
	.pa-hold form {
		margin-top: 0.5rem;
		max-width: 44rem;
	}
	.pa-delivery {
		margin: 0;
	}
</style>
