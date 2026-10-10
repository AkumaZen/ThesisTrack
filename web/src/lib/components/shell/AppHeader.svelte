<script lang="ts">
	import { page, navigating } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { endSession } from '$lib/viewMemory';
	import { ROLE_LABELS, type SessionUser } from '$lib/auth';
	import GlobalSearch from './GlobalSearch.svelte';
	import AlertBell from './AlertBell.svelte';

	let { user }: { user: SessionUser } = $props();

	interface Tool {
		href: string;
		label: string;
		/** Paths that also count as this tool (detail pages). */
		match: (path: string) => boolean;
		adminOnly?: boolean;
	}

	const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(prefix + '/');

	// The thesis module is the app's home; the valuation tools live under /valuation.
	const THESIS: Tool[] = [
		{ href: '/', label: 'Companies', match: (p) => p === '/' || starts('/company')(p) },
		{ href: '/sectors', label: 'Sectors', match: starts('/sectors') },
		{ href: '/review', label: 'Review queue', match: starts('/review') },
		{ href: '/guidance', label: 'Guidance', match: starts('/guidance') },
		{ href: '/ingest', label: 'Ingest', match: starts('/ingest') },
		{ href: '/export', label: 'Export', match: starts('/export') }
	];
	const VALUATION: Tool[] = [
		{
			href: '/valuation',
			label: 'Watchlist',
			match: (p) => p === '/valuation' || starts('/valuation/company')(p)
		},
		{ href: '/valuation/compare', label: 'Compare', match: starts('/valuation/compare') },
		{ href: '/valuation/master-tracker', label: 'Master Tracker', match: starts('/valuation/master-tracker') },
		{
			href: '/valuation/sector-rotation',
			label: 'Sector rotation',
			match: starts('/valuation/sector-rotation')
		},
		{
			href: '/valuation/stage-scanner',
			label: 'Breakout scanner',
			match: starts('/valuation/stage-scanner')
		},
		{ href: '/valuation/alerts', label: 'Alerts', match: starts('/valuation/alerts') },
		{
			href: '/valuation/sectors',
			label: 'Sector baskets',
			match: starts('/valuation/sectors'),
			adminOnly: true
		},
		{ href: '/valuation/settings', label: 'Settings', match: starts('/valuation/settings') }
	];

	const path = $derived(page.url.pathname);
	const inValuation = $derived(starts('/valuation')(path));
	const visible = (tools: Tool[]) => tools.filter((t) => !t.adminOnly || user.role === 'admin');
	const tools = $derived(visible(inValuation ? VALUATION : THESIS));
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
				<a href="/" class="module" aria-current={!inValuation && !onAccountPage ? 'true' : undefined}
					>Thesis</a
				>
				<a href="/valuation" class="module" aria-current={inValuation ? 'true' : undefined}
					>Valuation</a
				>
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

	<nav class="tools" aria-label={inValuation ? 'Valuation tools' : 'Thesis tools'}>
		<div class="shell-inner tools-inner">
			{#each tools as t (t.href)}
				<a href={t.href} class="tool" aria-current={t.match(path) ? 'page' : undefined}>{t.label}</a>
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
		{#each [{ name: 'Thesis', list: visible(THESIS) }, { name: 'Valuation', list: visible(VALUATION) }] as group (group.name)}
			<div class="drawer-group">
				<div class="eyebrow">{group.name}</div>
				{#each group.list as t (t.href)}
					<a href={t.href} class="drawer-link" aria-current={t.match(path) ? 'page' : undefined}
						>{t.label}</a
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
