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
		<h1>Price and shareholding alerts</h1>
		<div class="sub">
			Get a push or Telegram message when a stock reaches a price you set, and when a tracked company's
			promoter, FII or DII holding moves by more than you choose.
		</div>
	</div>
</div>

<div class="wrap mi">
	<section class="mi-box" aria-labelledby="mi-del" data-testid="delivery">
		<h2 id="mi-del">Where alerts are sent</h2>
		{#if data.delivery.push || data.delivery.telegram}
			<p class="sm-hint">
				{data.delivery.push ? 'Push notifications are on for your devices.' : ''}
				{data.delivery.telegram ? 'Telegram is connected.' : ''}
			</p>
		{:else}
			<p class="sm-hint">
				No device or Telegram chat is connected, so alerts would not reach you.
				{data.delivery.pushAvailable ? '' : 'Push is not set up on the server yet.'}
			</p>
		{/if}
		<a class="mi-link" href="/valuation/tracking">Set up notifications on the tracked companies page</a>
	</section>

	<form class="mi-box" onsubmit={create} aria-labelledby="mi-new">
		<h2 id="mi-new">New price alert</h2>
		<div class="mi-field">
			<label for="paSearch">Company</label>
			<CompanyPicker id="paSearch" label="Search a company for the alert" placeholder="Type a name or ticker" bind:value={pickerText} clearOnPick={false} disabled={busy} onPick={(hit) => { picked = hit; pickerText = hit.name; }} />
			{#if picked}<span class="sm-hint">Selected: {picked.name} ({picked.nseSymbol ?? picked.symbol})</span>{/if}
		</div>
		<div class="mi-form">
			<label class="mi-field">
				When
				<select bind:value={kind}>
					{#each PRICE_ALERT_KINDS as k (k)}
						<option value={k}>{PRICE_ALERT_LABELS[k]}</option>
					{/each}
				</select>
			</label>
			<label class="mi-field">
				{percent ? 'Percent' : 'Price (Rs)'}
				<input class="sm-input" bind:value={threshold} type="number" min="0" step="any" inputmode="decimal" required />
			</label>
		</div>
		{#if percent}
			<p class="sm-hint">A percentage move is measured from the latest stored price at the moment you add the alert.</p>
		{/if}
		<div class="mi-row"><button class="sm-btn sm-btn-primary" type="submit" disabled={busy}>Add alert</button></div>
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
							<span class="mi-tag" class:mi-tag-hi={r.active} class:mi-tag-dash={!r.active}>{r.active ? 'Watching' : 'Fired'}</span>
							{#if r.triggeredAt}<span>{when(r.triggeredAt)} at {inr(r.triggeredPrice)}</span>{/if}
						</div>
						<div class="mi-title">
							<a href="/valuation/company/{encodeURIComponent(r.nseSymbol)}">{r.nseSymbol}</a>
							<span class="mi-muted"> {r.companyName}</span>
						</div>
						<p class="mi-text">{describePriceRule({ kind: r.kind as PriceAlertKind, threshold: r.threshold, basePrice: r.basePrice })}</p>
						<p class="mi-text mi-muted">Latest stored price: {inr(r.price)}</p>
						<div class="mi-row">
							{#if !r.active}<button class="sm-btn" type="button" onclick={() => rearm(r.id)}>Turn on again</button>{/if}
							<button class="sm-btn" type="button" onclick={() => remove(r.id)} aria-label="Remove alert for {r.nseSymbol}">Remove</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<form class="mi-box" onsubmit={saveHolding} aria-labelledby="mi-hold" data-testid="holding-form">
		<h2 id="mi-hold">Shareholding change alerts</h2>
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
</div>
