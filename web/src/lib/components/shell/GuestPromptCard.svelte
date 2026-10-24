<script lang="ts">
	// A friendly full-page card for a guest who reached something outside the guest preview (a
	// members-only page, a company not in the showcase, a page that failed to load): what happened in
	// plain words, a Sign in that comes back here, and one way to keep exploring (`children`).
	import type { Snippet } from 'svelte';
	import { guestSignInHref } from '$lib/guest';

	let {
		title,
		body,
		next,
		children
	}: { title: string; body: string; next: string; children: Snippet } = $props();
</script>

<section class="guest-prompt card card-raised" data-testid="guest-prompt">
	<div class="eyebrow">Guest preview</div>
	<h1>{title}</h1>
	<p>{body}</p>
	<div class="actions">
		<a class="btn btn-primary" href={guestSignInHref(next)}>Sign in</a>
		{@render children()}
	</div>
</section>

<style>
	.guest-prompt {
		max-width: 520px;
		margin: var(--space-6) auto;
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1.25;
	}
	p {
		margin: 0 0 var(--space-2);
		color: var(--muted);
		line-height: 1.5;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	@media (max-width: 640px) {
		.guest-prompt {
			margin: var(--space-4) 0;
			padding: var(--space-4);
		}
	}
</style>
