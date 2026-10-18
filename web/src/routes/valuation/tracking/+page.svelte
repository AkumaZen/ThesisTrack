<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import CompanyPicker from '$lib/components/CompanyPicker.svelte';
	import { enablePush, pushSupported } from '$lib/push';
	import { sectorApi } from '$lib/valuation/sectorClient';
	import type { SymbolHit } from '$lib/valuation/symbolSearch';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface Item {
		id: number;
		subject: string;
		details: string;
		summary: string | null;
		pdfUrl: string | null;
		announcedAt: string;
	}

	// Which company's announcements are open; the page's own pick until the person chooses one.
	let chosen = $state<string | null>(null);
	const selected = $derived(
		data.tracked.some((t) => t.nseSymbol === chosen) ? chosen : data.initial
	);
	let items = $state<Item[]>([]);
	let loadingItems = $state(false);
	let stale = $state(false);
	let status = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let busy = $state(false);
	let permission = $state<NotificationPermission | 'unsupported'>('unsupported');

	$effect(() => {
		permission = pushSupported() ? Notification.permission : 'unsupported';
	});

	let loadToken = 0;
	$effect(() => {
		const symbol = selected;
		if (!symbol) {
			items = [];
			return;
		}
		const token = ++loadToken;
		loadingItems = true;
		fetch(`/api/valuation/tracking/${encodeURIComponent(symbol)}`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((body: { announcements: Item[]; stale: boolean }) => {
				if (token !== loadToken) return;
				items = body.announcements;
				stale = body.stale;
			})
			.catch(() => {
				if (token === loadToken) {
					items = [];
					status = { kind: 'error', text: 'Could not load announcements. Try again.' };
				}
			})
			.finally(() => {
				if (token === loadToken) loadingItems = false;
			});
	});

	async function add(hit: SymbolHit) {
		busy = true;
		status = null;
		const res = await sectorApi<{ nseSymbol: string; companyName: string }>('POST', '/api/valuation/tracking', {
			symbol: hit.symbol
		});
		busy = false;
		if (!res.ok) {
			status = { kind: 'error', text: res.message };
			return;
		}
		status = { kind: 'ok', text: `Tracking ${res.data.companyName}. New announcements will be sent to your subscribed devices.` };
		chosen = res.data.nseSymbol;
		await invalidateAll();
	}

	async function remove(symbol: string, name: string) {
		if (!confirm(`Stop tracking ${name}?`)) return;
		const res = await sectorApi('DELETE', `/api/valuation/tracking/${encodeURIComponent(symbol)}`);
		if (!res.ok) {
			status = { kind: 'error', text: res.message };
			return;
		}
		if (chosen === symbol) chosen = null;
		await invalidateAll();
	}

	async function allow() {
		busy = true;
		const result = await enablePush();
		busy = false;
		permission = pushSupported() ? Notification.permission : 'unsupported';
		status = result.ok
			? { kind: 'ok', text: 'Notifications are on for this device.' }
			: { kind: 'error', text: result.message };
	}

	async function sendTest() {
		busy = true;
		status = null;
		const res = await sectorApi<{ sent: number }>('POST', '/api/valuation/push/test');
		busy = false;
		status = res.ok
			? { kind: 'ok', text: 'Test notification sent. It should appear on this device in a moment.' }
			: { kind: 'error', text: res.message };
	}

	const when = (iso: string) =>
		new Date(iso).toLocaleString('en-IN', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
</script>

<svelte:head>
	<title>Tracked companies - ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Tracked companies</h1>
		<div class="sub">
			Pick the NSE companies that matter to you. Every new exchange announcement is summarised in plain
			language and pushed to your phone. The list and the alerts are yours alone.
		</div>
	</div>
</div>

<div class="wrap tk">
	<section class="tk-box" aria-labelledby="tk-notif">
		<h2 id="tk-notif">Notifications on this device</h2>
		{#if !data.pushConfigured}
			<p class="sm-hint">Push notifications are not set up on the server yet.</p>
		{:else if permission === 'unsupported'}
			<p class="sm-hint">
				This browser cannot receive push notifications. Use Chrome on your Android phone (or desktop).
			</p>
		{:else if permission === 'granted'}
			<p class="sm-hint">Allowed. Announcements for your tracked companies will arrive here.</p>
			<button class="sm-btn" type="button" disabled={busy} onclick={sendTest}>Send test notification</button>
		{:else if permission === 'denied'}
			<p class="sm-hint" data-testid="push-denied">
				Notifications are blocked for this site. To re-enable: tap the lock icon next to the address,
				open Site settings, set Notifications to Allow, then reload this page.
			</p>
		{:else}
			<button class="sm-btn sm-btn-primary" type="button" disabled={busy} onclick={allow}>
				Allow notifications
			</button>
		{/if}
	</section>

	<section class="tk-box" aria-labelledby="tk-add">
		<h2 id="tk-add">Track a company</h2>
		<label for="tkSearch" class="tk-label">Search by name or NSE ticker</label>
		<CompanyPicker
			id="tkSearch"
			label="Search a company to track"
			placeholder="Type a name or ticker, e.g. HFCL"
			disabled={busy}
			onPick={add}
		/>
	</section>

	{#if status}
		<p class="sm-msg sm-msg-{status.kind}" role="status">{status.text}</p>
	{/if}

	{#if data.tracked.length === 0}
		<p class="sm-empty" data-testid="tracking-empty">
			You are not tracking any company yet. Search above to add one.
		</p>
	{:else}
		<ul class="tk-chips" aria-label="Tracked companies">
			{#each data.tracked as t (t.nseSymbol)}
				<li>
					<button
						type="button"
						class="tk-chip"
						class:tk-chip-on={selected === t.nseSymbol}
						aria-pressed={selected === t.nseSymbol}
						onclick={() => (chosen = t.nseSymbol)}
					>
						<strong>{t.nseSymbol}</strong>
						<span>{t.companyName}</span>
					</button>
				</li>
			{/each}
		</ul>

		{#each data.tracked.filter((t) => t.nseSymbol === selected) as t (t.nseSymbol)}
			<section class="tk-feed" aria-label="Announcements for {t.companyName}">
				<div class="tk-feed-head">
					<h2>{t.companyName}</h2>
					<button class="sm-btn" type="button" onclick={() => remove(t.nseSymbol, t.companyName)}>
						Stop tracking
					</button>
				</div>
				{#if stale}
					<p class="sm-hint">NSE did not respond, so this may not include the latest announcements.</p>
				{/if}
				{#if loadingItems && items.length === 0}
					<p class="sm-hint">Loading announcements...</p>
				{:else if items.length === 0}
					<p class="sm-empty">No announcements in the last 90 days.</p>
				{:else}
					<ul class="tk-list" data-testid="announcement-list">
						{#each items as a (a.id)}
							<li class="tk-item">
								<div class="tk-meta">{when(a.announcedAt)}</div>
								<div class="tk-subject">{a.subject}</div>
								{#if a.summary}
									<p class="tk-summary">{a.summary}</p>
								{:else if a.details && a.details !== a.subject}
									<p class="tk-details">{a.details}</p>
								{/if}
								{#if a.pdfUrl}
									<a class="tk-pdf" href={a.pdfUrl} target="_blank" rel="noopener noreferrer">Open PDF</a>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	{/if}
</div>

<style>
	.tk {
		display: grid;
		gap: 1rem;
	}
	.tk-box {
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
		padding: 0.9rem 1rem;
		display: grid;
		gap: 0.5rem;
		justify-items: stretch;
		min-width: 0;
	}
	.tk-box h2,
	.tk-feed h2 {
		margin: 0;
		font-size: 1rem;
		font-family: var(--font-display);
	}
	.tk-label {
		font-size: 0.8rem;
		font-weight: 600;
	}
	.tk-box p {
		margin: 0;
	}
	.tk-box button {
		justify-self: start;
	}
	.tk-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.tk-chip {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
		max-width: 100%;
		min-height: 2.75rem;
		padding: 0.4rem 0.7rem;
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}
	.tk-chip span {
		font-size: 0.75rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.tk-chip-on {
		background: var(--accent);
		color: var(--accent-ink);
		box-shadow: var(--shadow-sm);
	}
	.tk-chip-on span {
		color: var(--accent-ink);
	}
	.tk-feed {
		display: grid;
		gap: 0.6rem;
	}
	.tk-feed-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.tk-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	.tk-item {
		border: var(--border-w) solid var(--ink);
		padding: 0.7rem 0.9rem;
		display: grid;
		gap: 0.3rem;
		min-width: 0;
	}
	.tk-meta {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--muted);
	}
	.tk-subject {
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.tk-summary,
	.tk-details {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.tk-details {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.tk-pdf {
		justify-self: start;
		font-weight: 600;
		min-height: 2.5rem;
		display: inline-flex;
		align-items: center;
	}
</style>
