<script lang="ts">
	import './layout.css';
	import '$lib/styles/shell.css';
	import { onNavigate } from '$app/navigation';
	import { session } from '$lib/session.svelte';
	import AppHeader from '$lib/components/shell/AppHeader.svelte';
	import KeyboardShortcuts from '$lib/components/shell/KeyboardShortcuts.svelte';
	import PushPrompt from '$lib/components/shell/PushPrompt.svelte';
	import BackgroundRuns from '$lib/components/shell/BackgroundRuns.svelte';
	import { page } from '$app/state';
	import { isGuest } from '$lib/guest';

	let { children, data } = $props();
	const guest = $derived(isGuest(data.user));

	// The thesis pages read the signed-in person from this shared store.
	$effect.pre(() => session.set(data.user));

	// Cross-fade route swaps via the View Transitions API where the browser has it (an instant
	// swap everywhere else). Each page's data comes from its load(), so SvelteKit keeps the old
	// page on screen until the new one is ready - the header's progress bar covers that wait.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	// Marks the page as interactive, so browser tests can wait for this instead of a fixed sleep.
	$effect(() => {
		document.documentElement.dataset.hydrated = 'true';
	});
</script>

<svelte:head>
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="icon" href="/favicon.ico" sizes="any" />
</svelte:head>

{#if data.user && !data.user.mustChangePassword}
	<AppHeader user={data.user} />
	{#if guest}
		<div class="guest-banner" role="status" data-testid="guest-banner">
			<span>You're exploring as a guest.</span>
			<a href="/login?next={encodeURIComponent(page.url.pathname + page.url.search)}">Sign in</a>
		</div>
	{:else}
		<PushPrompt userId={data.user.id} />
		<BackgroundRuns />
	{/if}
	<KeyboardShortcuts />
	<main id="main" class="app-main">
		{@render children()}
	</main>
{:else}
	<main id="main">
		{@render children()}
	</main>
{/if}

<style>
	.guest-banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--warn-soft);
		border-bottom: var(--border-w) solid var(--ink);
		font-size: 0.875rem;
		text-align: center;
	}
	.guest-banner a {
		font-weight: 600;
		color: var(--ink);
	}
</style>
