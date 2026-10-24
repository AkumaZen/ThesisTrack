<script lang="ts">
	import { page, navigating } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { endSession } from '$lib/viewMemory';
	import { ROLE_LABELS, type SessionUser } from '$lib/auth';
	import { MODULES, moduleOf, type ModuleKey } from '$lib/modules';
	import GlobalSearch from './GlobalSearch.svelte';
	import AlertBell from './AlertBell.svelte';
	import { guestPageRedirect, isGuest, lockedFeatureForPath } from '$lib/guest';

	let { user }: { user: SessionUser } = $props();

	interface Tool {
		href: string;
		label: string;
		/** Paths that also count as this tool (detail pages). */
		match: (path: string) => boolean;
	}

	const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(prefix + '/');
	const tool = (href: string, label: string, match = starts(href)): Tool => ({ href, label, match });

	// The thesis module is the app's home; the other modules group the tools under /valuation.
	const TOOLS: Record<ModuleKey, Tool[]> = {
		thesis: [
			tool('/', 'Companies', (p) => p === '/' || starts('/company')(p)),
			tool('/review', 'Review queue'),
			tool('/scorecard', 'Scorecard')
		],
		valuation: [
			tool(
				'/valuation',
				'Watchlist',
				(p) => p === '/valuation' || starts('/valuation/company')(p) || starts('/valuation/lists')(p)
			),
			tool('/valuation/master-tracker', 'Master Tracker'),
			tool('/valuation/concalls', 'Concalls'),
			tool('/valuation/red-flags', 'Red flags'),
			tool('/valuation/compare', 'Compare')
		],
		markets: [
			tool('/valuation/sector-rotation', 'Sector rotation'),
			tool('/valuation/breadth', 'Breadth'),
			tool('/valuation/returns', 'Returns'),
			tool(
				'/valuation/stage-scanner',
				'Breakout scanner',
				(p) => starts('/valuation/stage-scanner')(p) || starts('/valuation/scans')(p)
			),
			tool('/valuation/results', 'Results')
		],
		filings: [
			tool(
				'/valuation/announcements',
				'Announcements',
				(p) => starts('/valuation/announcements')(p) || starts('/valuation/filings')(p)
			),
			tool('/valuation/insider-trades', 'Insider trades'),
			tool('/valuation/corporate-actions', 'Ex-dates')
		],
		alerts: [
			tool('/valuation/alerts', 'Inbox'),
			tool('/valuation/tracking', 'Tracked companies'),
			tool('/valuation/price-alerts', 'Price alerts')
		]
	};

	// A guest sees the same nav; locked tools carry a lock and open their preview instead.
	const guest = $derived(isGuest(user));
	const navHref = (href: string) => (guest ? (guestPageRedirect(href) ?? href) : href);
	const isLocked = (href: string) => guest && lockedFeatureForPath(href) !== undefined;
	const signInHref = $derived(
		`/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`
	);

	const path = $derived(page.url.pathname);
	const current = $derived(moduleOf(path));
	const tools = $derived(TOOLS[current]);
	const onAccountPage = $derived(starts('/account')(path) || starts('/admin')(path));

	let drawerOpen = $state(false);
	let menu = $state<HTMLDetailsElement>();

	afterNavigate(() => {
		drawerOpen = false;
		if (menu) menu.open = false;
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (drawerOpen) drawerOpen = false;
		if (menu?.open) {
			menu.open = false;
			menu.querySelector('summary')?.focus();
		}
	}

	const initials = $derived(
		user.username
			.split(/[.\s_-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase() ?? '')
			.join('')
	);
</script>

{#snippet lock()}
	<svg class="nav-lock" width="10" height="12" viewBox="0 0 10 12" aria-label="Locked" role="img"
		><rect x="1" y="5" width="8" height="6" fill="currentColor" /><path
			d="M3 5V3.5a2 2 0 0 1 4 0V5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
		/></svg
	>
{/snippet}

<svelte:window onkeydown={onKeydown} />

<svelte:document
	onclick={(e) => {
		if (menu?.open && !menu.contains(e.target as Node)) menu.open = false;
	}}
/>

<a class="skip-link" href="#main">Skip to content</a>

<header class="shell" data-testid="app-nav">
	<div class="shell-bar">
		<div class="shell-inner">
			<a class="brand" href="/" aria-label="ThesisTrack home">
				<span class="brand-mark" aria-hidden="true">T</span>
				<span class="brand-name">ThesisTrack</span>
			</a>

			<nav class="modules" aria-label="Module">
				{#each MODULES as m (m.key)}
					<a
						href={navHref(m.landing)}
						class="module"
						aria-current={current === m.key && !onAccountPage ? 'true' : undefined}
						>{m.label}{#if isLocked(m.landing)}{@render lock()}{/if}</a
					>
				{/each}
			</nav>

			<div class="shell-actions">
				<div class="shell-search"><GlobalSearch /></div>
				{#if guest}
					<a class="btn btn-primary guest-signin" href={signInHref} data-testid="guest-sign-in">Sign in</a>
				{:else}
				<AlertBell />
				<details class="account" bind:this={menu} data-testid="user-menu">
					<summary class="account-trigger" aria-label="Account menu for {user.username}">
						<span class="avatar" aria-hidden="true">{initials}</span>
						<span class="account-name">{user.username}</span>
						<svg class="chev" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"
							><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" /></svg
						>
					</summary>
					<div class="account-panel">
						<div class="account-who">
							<strong>{user.username}</strong>
							<span class="account-email">{user.email}</span>
							<span class="tag">{ROLE_LABELS[user.role]}</span>
						</div>
						<a href="/valuation/settings">Settings</a>
						{#if user.role === 'admin'}
							<a href="/valuation/sectors">Sector baskets</a>
						{/if}
						<a href="/account/password">Change password</a>
						{#if user.role === 'admin'}
							<a href="/admin/users">Team and access</a>
						{/if}
						<form method="POST" action="/logout" onsubmit={() => endSession()}>
							<button type="submit" data-testid="logout">Sign out</button>
						</form>
					</div>
				</details>
				{/if}
				<button
					class="icon-btn menu-btn"
					type="button"
					aria-label="Open menu"
					aria-expanded={drawerOpen}
					aria-controls="mobile-drawer"
					onclick={() => (drawerOpen = !drawerOpen)}
				>
					<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
						{#if drawerOpen}
							<path d="M3 3l12 12M15 3L3 15" stroke="currentColor" stroke-width="2" />
						{:else}
							<path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" stroke-width="2" />
						{/if}
					</svg>
				</button>
			</div>
		</div>
	</div>

	<nav class="tools" aria-label="{MODULES.find((m) => m.key === current)?.label} tools">
		<div class="shell-inner tools-inner">
			{#each tools as t (t.href)}
				<a href={navHref(t.href)} class="tool" aria-current={t.match(path) ? 'page' : undefined}
					>{t.label}{#if isLocked(t.href)}{@render lock()}{/if}</a
				>
			{/each}
		</div>
	</nav>

	{#if navigating.to}
		<div class="nav-progress" role="progressbar" aria-label="Loading page">
			<div class="nav-progress-bar animate-nav-progress"></div>
		</div>
	{/if}
</header>

{#if drawerOpen}
	<div class="drawer-scrim" role="presentation" onclick={() => (drawerOpen = false)}></div>
	<div class="drawer" id="mobile-drawer" role="dialog" aria-modal="true" aria-label="Menu">
		<div class="drawer-head">
			<span class="brand-name">ThesisTrack</span>
			<button class="icon-btn drawer-close" type="button" aria-label="Close menu" onclick={() => (drawerOpen = false)}>
				<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"
					><path d="M3 3l12 12M15 3L3 15" stroke="currentColor" stroke-width="2" /></svg
				>
			</button>
		</div>
		<div class="drawer-search"><GlobalSearch compact /></div>
		{#each MODULES as m (m.key)}
			{@const group = { name: m.label, list: TOOLS[m.key] }}
			<div class="drawer-group">
				<div class="eyebrow">{group.name}</div>
				{#each group.list as t (t.href)}
					<a href={navHref(t.href)} class="drawer-link" aria-current={t.match(path) ? 'page' : undefined}
						>{t.label}{#if isLocked(t.href)}{@render lock()}{/if}</a
					>
				{/each}
			</div>
		{/each}
		{#if guest}
		<div class="drawer-group">
			<div class="eyebrow">{ROLE_LABELS[user.role]}</div>
			<a href={signInHref} class="drawer-link">Sign in</a>
		</div>
		{:else}
		<div class="drawer-group">
			<div class="eyebrow">{user.username} · {ROLE_LABELS[user.role]}</div>
			<a href="/valuation/settings" class="drawer-link">Settings</a>
			{#if user.role === 'admin'}<a href="/valuation/sectors" class="drawer-link">Sector baskets</a>{/if}
			<a href="/account/password" class="drawer-link">Change password</a>
			{#if user.role === 'admin'}<a href="/admin/users" class="drawer-link">Team and access</a>{/if}
			<form method="POST" action="/logout" onsubmit={() => endSession()}>
				<button type="submit" class="drawer-link">Sign out</button>
			</form>
		</div>
		{/if}
	</div>
{/if}
