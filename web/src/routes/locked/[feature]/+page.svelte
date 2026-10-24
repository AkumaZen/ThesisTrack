<script lang="ts">
	import PageHeader from '$lib/components/shell/PageHeader.svelte';

	let { data } = $props();
	const feature = $derived(data.feature);
	const signInHref = $derived(`/login?next=${encodeURIComponent(feature.pages[0])}`);
</script>

<svelte:head>
	<title>{feature.title} · ThesisTrack</title>
</svelte:head>

<PageHeader eyebrow="Subscriber feature" title={feature.title} subtitle={feature.summary} />

<section class="card card-raised locked" data-testid="locked-feature">
	<h2 class="eyebrow">What you get</h2>
	<ul>
		{#each feature.points as point (point)}
			<li>{point}</li>
		{/each}
	</ul>
	<p class="notice notice-warn" data-testid="subscribe-note">Available to subscribers. Coming soon.</p>
	<div class="actions">
		<a class="btn btn-primary" href={signInHref}>Sign in</a>
		<a class="btn" href="/">Keep exploring</a>
	</div>
</section>

<style>
	.locked {
		max-width: 640px;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h2 {
		margin: 0;
	}
	ul {
		margin: 0;
		padding-left: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.notice {
		margin: 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	@media (max-width: 640px) {
		.locked {
			padding: var(--space-3);
		}
	}
</style>
