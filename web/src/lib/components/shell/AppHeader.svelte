<script lang="ts">
	import { page, navigating } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { endSession } from '$lib/viewMemory';
	import { ROLE_LABELS, type SessionUser } from '$lib/auth';
	import { MODULES, moduleOf, type ModuleKey } from '$lib/modules';
	import GlobalSearch from './GlobalSearch.svelte';
	import AlertBell from './AlertBell.svelte';

	let { user }: { user: SessionUser } = $props();

	interface Tool {
		href: string;
		label: string;
		/** Paths that also count as this tool (detail pages). */
		match: (path: string) => boolean;
		adminOnly?: boolean;
		/** Shows a "New" badge until this date (YYYY-MM-DD, inclusive). */
		newUntil?: string;
	}

	// The analytics and market intel pages carry a "New" badge for a few weeks after launch.
	const NEW_UNTIL = '2026-12-15';
	const today = new Date().toISOString().slice(0, 10);
	const isNew = (t: Tool) => t.newUntil != null && today <= t.newUntil;

	const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(prefix + '/');

	// The thesis module is the app's home; the valuation tools live under /valuation.
	const THESIS: Tool[] = [
		{ href: '/', label: 'Companies', match: (p) => p === '/' || starts('/company')(p) },
		{ href: '/review', label: 'Review queue', match: starts('/review') },
		{ href: '/scorecard', label: 'Scorecard', match: starts('/scorecard') }
	];
	const VALUATION: Tool[] = [
		{
			href: '/valuation',
			label: 'Watchlist',
			match: (p) => p === '/valuation' || starts('/valuation/company')(p)
		},
		{ href: '/valuation/master-tracker', label: 'Master Tracker', match: starts('/valuation/master-tracker') },
		{ href: '/valuation/alerts', label: 'Alerts', match: starts('/valuation/alerts') },
		{ href: '/valuation/tracking', label: 'Tracked companies', match: starts('/valuation/tracking') },
		{ href: '/valuation/lists', label: 'Lists', match: starts('/valuation/lists'), newUntil: NEW_UNTIL },
		{ href: '/valuation/price-alerts', label: 'Price alerts', match: starts('/valuation/price-alerts'), newUntil: NEW_UNTIL },
		{ href: '/valuation/settings', label: 'Settings', match: starts('/valuation/settings') }
	];
	const SECTOR: Tool[] = [
		{
			href: '/valuation/sector-rotation',
			label: 'Sector rotation',
			match: starts('/valuation/sector-rotation')
		},
		{
			href: '/valuation/sectors',
			label: 'Sector baskets',
			match: starts('/valuation/sectors'),
			adminOnly: true
		}
	];
	const ANALYSIS: Tool[] = [
		{
			href: '/valuation/stage-scanner',
			label: 'Breakout scanner',
			match: starts('/valuation/stage-scanner')
		},
		{ href: '/valuation/compare', label: 'Compare', match: starts('/valuation/compare') },
		{ href: '/valuation/results', label: 'Results', match: starts('/valuation/results'), newUntil: NEW_UNTIL },
		{ href: '/valuation/scans', label: 'Saved scans', match: starts('/valuation/scans'), newUntil: NEW_UNTIL },
		{ href: '/valuation/returns', label: 'Returns', match: starts('/valuation/returns'), newUntil: NEW_UNTIL },
		{ href: '/valuation/breadth', label: 'Breadth', match: starts('/valuation/breadth'), newUntil: NEW_UNTIL },
		{
			href: '/valuation/announcements',
			label: 'Announcements',
			match: (p) => starts('/valuation/announcements')(p) || starts('/valuation/filings')(p),
			newUntil: NEW_UNTIL
		},
		{ href: '/valuation/insider-trades', label: 'Insider trades', match: starts('/valuation/insider-trades'), newUntil: NEW_UNTIL },
		{ href: '/valuation/corporate-actions', label: 'Ex-dates', match: starts('/valuation/corporate-actions'), newUntil: NEW_UNTIL },
		{ href: '/valuation/concalls', label: 'Concalls', match: starts('/valuation/concalls'), newUntil: NEW_UNTIL },
		{ href: '/valuation/red-flags', label: 'Red flags', match: starts('/valuation/red-flags'), newUntil: NEW_UNTIL }
	];
	const TOOLS: Record<ModuleKey, Tool[]> = { thesis: THESIS, valuation: VALUATION, sector: SECTOR, analysis: ANALYSIS };

	const path = $derived(page.url.pathname);
	const current = $derived(moduleOf(path));
	const visible = (tools: Tool[]) => tools.filter((t) => !t.adminOnly || user.role === 'admin');
	const tools = $derived(visible(TOOLS[current]));
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
						href={m.landing}
						class="module"
						aria-current={current === m.key && !onAccountPage ? 'true' : undefined}>{m.label}</a
					>
				{/each}
			</nav>

			<div class="shell-actions">
				<div class="shell-search"><GlobalSearch /></div>
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
						<a href="/account/password">Change password</a>
						{#if user.role === 'admin'}
							<a href="/admin/users">Team and access</a>
						{/if}
						<form method="POST" action="/logout" onsubmit={() => endSession()}>
							<button type="submit" data-testid="logout">Sign out</button>
						</form>
					</div>
				</details>
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
				<a href={t.href} class="tool" aria-current={t.match(path) ? 'page' : undefined}
					>{t.label}{#if isNew(t)}<span class="new-badge" data-testid="new-badge">New</span>{/if}</a
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
			{@const group = { name: m.label, list: visible(TOOLS[m.key]) }}
			<div class="drawer-group">
				<div class="eyebrow">{group.name}</div>
				{#each group.list as t (t.href)}
					<a href={t.href} class="drawer-link" aria-current={t.match(path) ? 'page' : undefined}
						>{t.label}{#if isNew(t)}<span class="new-badge" data-testid="new-badge">New</span>{/if}</a
					>
				{/each}
			</div>
		{/each}
		<div class="drawer-group">
			<div class="eyebrow">{user.username} · {ROLE_LABELS[user.role]}</div>
			<a href="/account/password" class="drawer-link">Change password</a>
			{#if user.role === 'admin'}<a href="/admin/users" class="drawer-link">Team and access</a>{/if}
			<form method="POST" action="/logout" onsubmit={() => endSession()}>
				<button type="submit" class="drawer-link">Sign out</button>
			</form>
		</div>
	</div>
{/if}
