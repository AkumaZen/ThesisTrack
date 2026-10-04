<script lang="ts">
	import type { Snippet } from 'svelte';

	// The signed-out / forced-password-change frame: brand, a single card, nothing else to click.
	let {
		title,
		subtitle,
		children
	}: { title: string; subtitle?: string; children: Snippet } = $props();
</script>

<div class="auth">
	<div class="auth-brand">
		<span class="brand-mark" aria-hidden="true">T</span>
		<span class="brand-name">ThesisTrack</span>
	</div>
	<section class="auth-card card card-raised">
		<h1 id="auth-title">{title}</h1>
		{#if subtitle}<p class="auth-sub">{subtitle}</p>{/if}
		{@render children()}
	</section>
</div>

<style>
	.auth {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		padding: var(--space-6) var(--space-3);
		background: var(--surface);
	}
	.auth-brand {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.auth-card {
		width: 100%;
		max-width: 400px;
		padding: var(--space-5);
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 700;
	}
	.auth-sub {
		margin: var(--space-1) 0 var(--space-4);
		font-size: 0.875rem;
		color: var(--muted);
	}
	@media (max-width: 480px) {
		.auth-card {
			padding: var(--space-4);
		}
	}
</style>
