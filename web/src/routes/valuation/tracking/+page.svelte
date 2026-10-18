<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import CompanyPicker from '$lib/components/CompanyPicker.svelte';
	import { enablePush, pushSupported } from '$lib/push';
	import { sectorApi } from '$lib/valuation/sectorClient';
	import { ANNOUNCEMENT_TAGS, TAG_LABELS, isAnnouncementTag, type AnnouncementTag } from '$lib/valuation/announcementTags';
	import { formatMeetingDay } from '$lib/valuation/boardMeetings';
	import { formatQty } from '$lib/valuation/dealFormat';
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
		tag: string | null;
	}

	interface Deal {
		id: number;
		kind: string;
		dealDate: string;
		clientName: string;
		side: string;
		quantity: number;
		price: number | null;
	}
	interface Holding {
		period: string;
		prevPeriod: string | null;
		pledgedPct: number | null;
		rows: { label: string; value: number | null; change: number | null }[];
	}
	let deals = $state<Deal[]>([]);
	let holding = $state<Holding | null>(null);
	// Open by default on a wide screen, collapsed on a phone (the person can open it).
	let wide = $state(false);
	$effect(() => {
		wide = window.matchMedia('(min-width: 640px)').matches;
	});
	const signed = (n: number | null) => (n == null ? 'n/a' : n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));

	// Which company's announcements are open; the page's own pick until the person chooses one.
	let chosen = $state<string | null>(null);
	const selected = $derived(
		data.tracked.some((t) => t.nseSymbol === chosen) ? chosen : data.initial
	);
	let items = $state<Item[]>([]);
	let loadingItems = $state(false);
	let stale = $state(false);
	let shown = $state(15);
	let tagFilter = $state<AnnouncementTag | null>(null);
	// null until the person flips the box; then their choice, else what the server says.
	let onlyImportantPick = $state<boolean | null>(null);
	const onlyImportant = $derived(onlyImportantPick ?? data.onlyImportant);
	const tagOf = (i: Item): AnnouncementTag => (isAnnouncementTag(i.tag) ? i.tag : 'other');
	const visible = $derived(tagFilter ? items.filter((i) => tagOf(i) === tagFilter) : items);
	// Only tags that exist in the open list get a filter chip, in the fixed order of ANNOUNCEMENT_TAGS.
	const presentTags = $derived(ANNOUNCEMENT_TAGS.filter((t) => items.some((i) => tagOf(i) === t)));
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
		shown = 15;
		tagFilter = null;
		deals = [];
		holding = null;
		loadingItems = true;
		fetch(`/api/valuation/tracking/${encodeURIComponent(symbol)}`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((body: { announcements: Item[]; stale: boolean; deals: Deal[]; shareholding: Holding | null }) => {
				if (token !== loadToken) return;
				items = body.announcements;
				deals = body.deals;
				holding = body.shareholding;
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

	let tgUrl = $state<string | null>(null);

	async function connectTelegram() {
		busy = true;
		const res = await sectorApi<{ url: string }>('POST', '/api/valuation/push/telegram');
		busy = false;
		if (res.ok) tgUrl = res.data.url;
		else status = { kind: 'error', text: res.message };
	}

	async function disconnectTelegram() {
		busy = true;
		const res = await sectorApi('DELETE', '/api/valuation/push/telegram');
		busy = false;
		tgUrl = null;
		if (!res.ok) status = { kind: 'error', text: res.message };
		await invalidateAll();
	}

	async function saveOnlyImportant(next: boolean) {
		onlyImportantPick = next;
		const res = await sectorApi('PUT', '/api/valuation/push/settings', { onlyImportant: next });
		if (!res.ok) {
			onlyImportantPick = !next;
			status = { kind: 'error', text: res.message };
		}
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
		{#if data.telegram.available}
			<div class="tk-tg" data-testid="telegram-box">
				<strong>Telegram backup</strong>
				{#if data.telegram.linked}
					<p class="sm-hint">Connected. Alerts also arrive in your Telegram chat with the bot.</p>
					<button class="sm-btn" type="button" disabled={busy} onclick={disconnectTelegram}>Disconnect Telegram</button>
				{:else if tgUrl}
					<p class="sm-hint">Open Telegram, press Start in the chat, then come back and check.</p>
					<a class="sm-btn sm-btn-primary tk-link" href={tgUrl} target="_blank" rel="noopener noreferrer">Open Telegram</a>
					<button class="sm-btn" type="button" onclick={() => invalidateAll()}>I pressed Start, check now</button>
				{:else}
					<p class="sm-hint">Get the same alerts in Telegram as a backup to push notifications.</p>
					<button class="sm-btn" type="button" disabled={busy} onclick={connectTelegram}>Connect Telegram</button>
				{/if}
			</div>
		{/if}
		<label class="tk-check">
			<input type="checkbox" checked={onlyImportant} onchange={(e) => saveOnlyImportant(e.currentTarget.checked)} />
			<span>Only notify important filings (routine paperwork such as trading window notices is still listed, but not sent)</span>
		</label>
	</section>

	{#if data.calendar.thisWeek.length || data.calendar.later.length}
		<section class="tk-box" aria-labelledby="tk-cal" data-testid="results-calendar">
			<h2 id="tk-cal">Upcoming results / board meetings</h2>
			<p class="sm-hint">Your tracked companies and the watchlist. Dates are IST.</p>
			{#each [{ title: 'This week', rows: data.calendar.thisWeek }, { title: 'Later', rows: data.calendar.later }] as group (group.title)}
				{#if group.rows.length}
					<h3 class="tk-sub">{group.title}</h3>
					<ul class="tk-cal">
						{#each group.rows as m (m.nseSymbol + m.meetingDate + m.isResults)}
							<li class="tk-cal-row">
								<span class="tk-cal-date">{formatMeetingDay(m.meetingDate)}</span>
								<span class="tk-cal-co"><strong>{m.nseSymbol}</strong> {m.companyName}</span>
								<span class="tk-tag" class:tk-tag-key={m.isResults}>{m.isResults ? 'Results' : m.purpose}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/each}
		</section>
	{/if}

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
				<details class="tk-hold" open={wide} data-testid="holdings">
					<summary>Shareholding and deals (last 30 days)</summary>
					{#if holding}
						<table class="tk-table">
							<caption>Shareholding pattern, {holding.period}{holding.prevPeriod ? `, change vs ${holding.prevPeriod}` : ''}</caption>
							<thead>
								<tr><th scope="col">Holder</th><th scope="col">%</th><th scope="col">QoQ (pts)</th></tr>
							</thead>
							<tbody>
								{#each holding.rows as r (r.label)}
									<tr>
										<th scope="row">{r.label}</th>
										<td>{r.value == null ? 'n/a' : r.value.toFixed(2)}</td>
										<td>{signed(r.change)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
						<p class="sm-hint">
							{holding.pledgedPct == null
								? 'No promoter pledge reported.'
								: `Promoters have pledged ${holding.pledgedPct}% of their holding.`}
						</p>
					{:else}
						<p class="sm-hint">Shareholding is fetched daily; nothing yet for this company.</p>
					{/if}
					{#if deals.length}
						<ul class="tk-deals" aria-label="Bulk and block deals">
							{#each deals as d (d.id)}
								<li>
									<span class="tk-meta">{d.dealDate} {d.kind === 'block' ? 'Block' : 'Bulk'}</span>
									<span><strong>{d.side}</strong> {formatQty(d.quantity)} shares{d.price ? ` at Rs ${d.price}` : ''} by {d.clientName}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="sm-hint">No bulk or block deals in the last 30 days.</p>
					{/if}
				</details>
				{#if loadingItems && items.length === 0}
					<p class="sm-hint">Loading announcements...</p>
				{:else if items.length === 0}
					<p class="sm-empty">No announcements in the last 90 days.</p>
				{:else}
					<div class="tk-filters" role="group" aria-label="Filter by type">
						<button type="button" class="tk-tag tk-tagbtn" class:tk-tagbtn-on={tagFilter === null} aria-pressed={tagFilter === null} onclick={() => (tagFilter = null)}>All</button>
						{#each presentTags as tag (tag)}
							<button type="button" class="tk-tag tk-tagbtn" class:tk-tagbtn-on={tagFilter === tag} aria-pressed={tagFilter === tag} onclick={() => { tagFilter = tag; shown = 15; }}>{TAG_LABELS[tag]}</button>
						{/each}
					</div>
					{#if visible.length === 0}
						<p class="sm-empty">Nothing of this type in the last 90 days.</p>
					{/if}
					<ul class="tk-list" data-testid="announcement-list">
						{#each visible.slice(0, shown) as a (a.id)}
							<li class="tk-item">
								<div class="tk-meta">
									<span>{when(a.announcedAt)}</span>
									<span class="tk-tag tk-tag-{tagOf(a)}">{TAG_LABELS[tagOf(a)]}</span>
								</div>
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
					{#if visible.length > shown}
						<button class="sm-btn tk-more" type="button" onclick={() => (shown += 15)}>
							Show more ({visible.length - shown} older)
						</button>
					{/if}
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
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--muted);
	}
	.tk-hold {
		border: var(--border-w) solid var(--ink);
		padding: 0.6rem 0.9rem;
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}
	.tk-hold summary {
		cursor: pointer;
		font-weight: 700;
		min-height: 2.5rem;
		display: flex;
		align-items: center;
	}
	.tk-table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.875rem;
	}
	.tk-table caption {
		text-align: left;
		font-size: 0.75rem;
		color: var(--muted);
		padding-bottom: 0.3rem;
	}
	.tk-table th,
	.tk-table td {
		text-align: left;
		padding: 0.25rem 0.4rem;
		border-top: 1px solid var(--ink);
		font-weight: 500;
	}
	.tk-table thead th {
		font-weight: 700;
	}
	.tk-table td {
		font-family: var(--font-mono);
	}
	.tk-deals {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
		font-size: 0.875rem;
	}
	.tk-deals li {
		display: grid;
		gap: 0.1rem;
		overflow-wrap: anywhere;
		border-top: 1px solid var(--ink);
		padding-top: 0.4rem;
	}
	.tk-tg {
		display: grid;
		gap: 0.4rem;
		justify-items: start;
		border-top: 1px solid var(--ink);
		padding-top: 0.6rem;
	}
	.tk-link {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		text-decoration: none;
	}
	.tk-sub {
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
		font-family: var(--font-display);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.tk-check {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		font-size: 0.875rem;
		min-height: 2.75rem;
		cursor: pointer;
	}
	.tk-check input {
		width: 1.25rem;
		height: 1.25rem;
		flex: none;
		margin-top: 0.1rem;
	}
	.tk-tag {
		display: inline-block;
		padding: 0.1rem 0.45rem;
		border: 1.5px solid var(--ink);
		background: var(--bg);
		color: var(--ink);
		font: 600 0.72rem/1.3 var(--font-body, inherit);
		white-space: normal;
	}
	.tk-tag-key,
	.tk-tag-results,
	.tk-tag-order_win,
	.tk-tag-fundraise,
	.tk-tag-pledge,
	.tk-tag-management,
	.tk-tag-mna,
	.tk-tag-regulatory {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.tk-tag-routine {
		border-style: dashed;
		color: var(--muted);
	}
	.tk-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.tk-tagbtn {
		min-height: 2.5rem;
		padding: 0.2rem 0.7rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.tk-tagbtn-on {
		background: var(--ink);
		color: var(--bg);
		box-shadow: var(--shadow-sm);
	}
	.tk-cal {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.tk-cal-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.1rem 0.6rem;
		align-items: center;
		border-top: 1px solid var(--ink);
		padding-top: 0.4rem;
	}
	.tk-cal-date {
		grid-column: 1 / -1;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--muted);
	}
	.tk-cal-co {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	@media (min-width: 640px) {
		.tk-cal-row {
			grid-template-columns: 9.5rem minmax(0, 1fr) auto;
		}
		.tk-cal-date {
			grid-column: auto;
		}
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
	.tk-more {
		justify-self: start;
	}
	.tk-pdf {
		justify-self: start;
		font-weight: 600;
		min-height: 2.5rem;
		display: inline-flex;
		align-items: center;
	}
</style>
