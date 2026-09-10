<script lang="ts">
	import './layout.css';
	import { page, navigating } from '$app/state';
	import { onNavigate } from '$app/navigation';
	import favicon from '$lib/assets/favicon.svg';
	import { session } from '$lib/session.svelte';
	import { theme } from '$lib/theme.svelte';
	import { api, ApiError } from '$lib/api';
	import { onMount } from 'svelte';

	let { children } = $props();

	// A page's data now comes from a load() function (see each route's
	// +page.ts) rather than an onMount fetch, so SvelteKit itself holds the
	// outgoing page on screen until the destination's data is ready - no more
	// blank/"Loading..." flash. `navigating` gives a thin progress bar for
	// that (brief) wait, and onNavigate cross-fades the swap via the native
	// View Transitions API where the browser supports it (a no-op fallback
	// - an instant swap - everywhere else, so nothing breaks without it).
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	let loginEmail = $state('');
	let loginPassword = $state('');
	let loginApiKey = $state('');
	let loginError = $state('');
	let useApiKeyPanel = $state(false);
	let showPassword = $state(false);

	onMount(() => theme.init());

	async function submitLogin() {
		loginError = '';
		try {
			const resp = (await api.login(loginEmail, loginPassword)) as { access_token: string; email: string; role: string };
			session.setSession(resp.access_token, resp.email, resp.role);
			location.reload();
		} catch (e) {
			loginError = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		}
	}

	function submitApiKey() {
		if (!loginApiKey) return;
		session.setApiKey(loginApiKey);
		location.reload();
	}

	function signOut() {
		session.clear();
		location.reload();
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if !session.isAuthenticated}
	<div class="fixed inset-0 bg-bg z-50 flex items-center justify-center p-4">
		<div class="bg-bg-ink rounded-xl shadow-md border border-border w-full max-w-sm p-6">
			<h1 class="font-semibold text-lg mb-1">Thesis Tracker</h1>
			<p class="text-sm text-muted-fg mb-4">Sign in to continue.</p>
			{#if loginError}
				<div class="mb-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{loginError}</div>
			{/if}
			<label class="block text-sm mb-2"
				>Email
				<input type="email" bind:value={loginEmail} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
			</label>
			<label class="block text-sm mb-4"
				>Password
				<div class="mt-1 relative">
					<input
						type={showPassword ? 'text' : 'password'}
						bind:value={loginPassword}
						class="w-full rounded-md border border-border pl-2 pr-8 py-1.5 text-sm"
					/>
					<button
						type="button"
						onclick={() => (showPassword = !showPassword)}
						aria-label={showPassword ? 'Hide password' : 'Show password'}
						aria-pressed={showPassword}
						class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-fg p-1"
					>
						{#if showPassword}
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
								><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path
									d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
								/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line
									x1="2"
									y1="2"
									x2="22"
									y2="22"
								/></svg
							>
						{:else}
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
								><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg
							>
						{/if}
					</button>
				</div>
			</label>
			<button
				onclick={submitLogin}
				class="w-full text-sm px-3 py-2 rounded-md bg-fg text-bg hover:brightness-90">Sign in</button
			>
			<details class="mt-4 text-xs text-muted-fg" bind:open={useApiKeyPanel}>
				<summary class="cursor-pointer">Use an API key instead</summary>
				<div class="mt-2 flex gap-2">
					<input
						bind:value={loginApiKey}
						placeholder="X-API-Key"
						class="flex-1 rounded-md border border-border px-2 py-1 text-sm"
					/>
					<button onclick={submitApiKey} class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3"
						>Use key</button
					>
				</div>
			</details>
		</div>
	</div>
{:else}
	<header class="bg-bg-ink border-b border-border sticky top-0 z-30">
		<div class="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
			<h1 class="font-semibold text-base shrink-0">Thesis Tracker</h1>
			<nav class="flex items-center gap-1">
				<a href="/" class="nav-tab" class:active={page.url.pathname === '/'}>Companies</a>
				<a href="/sectors" class="nav-tab" class:active={page.url.pathname.startsWith('/sectors')}>Sectors</a>
				<a href="/review" class="nav-tab" class:active={page.url.pathname.startsWith('/review')}>Review Queue</a>
				<a href="/guidance" class="nav-tab" class:active={page.url.pathname.startsWith('/guidance')}>Guidance</a>
				<a href="/ingest" class="nav-tab" class:active={page.url.pathname.startsWith('/ingest')}>Ingest</a>
				<a href="/export" class="nav-tab" class:active={page.url.pathname.startsWith('/export')}>Export</a>
			</nav>
			<div class="flex-1"></div>
			<div class="flex items-center gap-3 pl-3 ml-1 border-l border-border shrink-0">
				<button onclick={() => theme.toggle()} class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3">
					{theme.current === 'dark' ? 'Light mode' : 'Dark mode'}
				</button>
				<span class="text-xs text-muted-fg hidden md:inline">{session.token ? session.email : 'API key session'}</span>
				<button onclick={signOut} class="text-xs px-2 py-1 rounded-md hover:bg-surface-3 text-muted-fg hover:text-fg">Sign out</button>
			</div>
		</div>
		{#if navigating.to}
			<div class="h-0.5 bg-fg/20 overflow-hidden">
				<div class="h-full w-1/3 bg-fg animate-nav-progress"></div>
			</div>
		{/if}
	</header>
	<main class="max-w-7xl mx-auto px-4 py-5">
		{@render children()}
	</main>
{/if}
