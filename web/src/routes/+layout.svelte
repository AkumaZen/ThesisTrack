<script lang="ts">
	import './layout.css';
	import '$lib/styles/shell.css';
	import { onNavigate } from '$app/navigation';
	import favicon from '$lib/assets/favicon.svg';
	import { session } from '$lib/session.svelte';
	import AppHeader from '$lib/components/shell/AppHeader.svelte';
	import KeyboardShortcuts from '$lib/components/shell/KeyboardShortcuts.svelte';

	let { children, data } = $props();

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

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if data.user && !data.user.mustChangePassword}
	<AppHeader user={data.user} />
	<KeyboardShortcuts />
	<main id="main" class="app-main">
		{@render children()}
	</main>
{:else}
	<main id="main">
		{@render children()}
	</main>
{/if}
