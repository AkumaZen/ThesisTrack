<script lang="ts">
	// A failed load() lands here. Unexpected (500) errors carry an id that matches the server log.
	// A guest gets a friendly card instead (no status codes or references): a company outside the
	// showcase answers 404 just like one that does not exist, so both read the same way.
	import { page } from '$app/state';
	import { isGuest } from '$lib/guest';
	import GuestPromptCard from '$lib/components/shell/GuestPromptCard.svelte';

	const home = $derived(page.url.pathname.startsWith('/valuation') ? '/valuation' : '/');
	const guest = $derived(isGuest(page.data.user));
	const next = $derived(page.url.pathname + page.url.search);
	const companyPage = $derived(/^\/(company|valuation\/company)\//.test(page.url.pathname));
</script>

<svelte:head>
	<title>{guest ? 'Guest preview' : `Error ${page.status}`} · ThesisTrack</title>
</svelte:head>

{#if guest}
	{#if page.status === 404 && companyPage}
		<GuestPromptCard
			title="This company isn't part of the guest preview."
			body="Sign in to see every company we cover, or browse the companies in the showcase."
			{next}
		>
			<a class="btn" href="/">Browse showcase companies</a>
		</GuestPromptCard>
	{:else if page.status === 404}
		<GuestPromptCard
			title="We couldn't find that page."
			body="It may have moved, or it isn't part of the guest preview. Sign in for the full app, or keep exploring."
			{next}
		>
			<a class="btn" href="/">Keep exploring</a>
		</GuestPromptCard>
	{:else}
		<GuestPromptCard
			title="Sorry, this part didn't load."
			body="Some of the app needs live market data or an account, which are for signed-in members. Sign in for the full app, or keep exploring the guest preview."
			{next}
		>
			<a class="btn" href="/">Keep exploring</a>
		</GuestPromptCard>
	{/if}
{:else}
	<section class="error-card card card-raised" role="alert">
		<div class="eyebrow">Error {page.status}</div>
		<h1>{page.error?.message ?? 'Something went wrong'}</h1>
		{#if page.error?.errorId}
			<p class="ref">Reference <code class="num">{page.error.errorId}</code>. Give this to the admin.</p>
		{/if}
		<a class="btn btn-dark" href={home}>{home === '/' ? 'Back to companies' : 'Back to watchlist'}</a>
	</section>
{/if}

<style>
	.error-card {
		max-width: 480px;
		margin: var(--space-6) auto;
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: var(--space-2);
	}
	.ref {
		font-size: 0.875rem;
		color: var(--muted);
		margin-bottom: var(--space-2);
	}
</style>
