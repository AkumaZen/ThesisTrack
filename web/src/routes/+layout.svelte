<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import { session } from '$lib/session.svelte';
	import { theme } from '$lib/theme.svelte';
	import { api, ApiError } from '$lib/api';
	import { onMount } from 'svelte';

	let { children } = $props();

	let loginEmail = $state('');
	let loginPassword = $state('');
	let loginApiKey = $state('');
	let loginError = $state('');
	let useApiKeyPanel = $state(false);

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
			<h1 class="font-semibold text-lg mb-1">Investment Thesis Platform</h1>
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
				<input
					type="password"
					bind:value={loginPassword}
					class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
				/>
			</label>
			<button
				onclick={submitLogin}
				class="w-full text-sm px-3 py-2 rounded-md bg-accent text-accent-ink hover:brightness-90">Sign in</button
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
			<h1 class="font-semibold text-base shrink-0">Investment Thesis Platform</h1>
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
	</header>
	<main class="max-w-7xl mx-auto px-4 py-5">
		{@render children()}
	</main>
{/if}
