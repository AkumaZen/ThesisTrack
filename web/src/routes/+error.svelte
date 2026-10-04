<script lang="ts">
	// A failed load() lands here. Unexpected (500) errors carry an id that matches the server log.
	import { page } from '$app/state';

	const home = $derived(page.url.pathname.startsWith('/valuation') ? '/valuation' : '/');
</script>

<svelte:head><title>Error {page.status} · ThesisTrack</title></svelte:head>

<section class="error-card card card-raised" role="alert">
	<div class="eyebrow">Error {page.status}</div>
	<h1>{page.error?.message ?? 'Something went wrong'}</h1>
	{#if page.error?.errorId}
		<p class="ref">Reference <code class="num">{page.error.errorId}</code>. Give this to the admin.</p>
	{/if}
	<a class="btn btn-dark" href={home}>{home === '/' ? 'Back to companies' : 'Back to watchlist'}</a>
</section>

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
