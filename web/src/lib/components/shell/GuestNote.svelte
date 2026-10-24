<script lang="ts">
	// What a guest sees in a panel whose data is not part of the guest preview (nothing stored
	// yet, or it needs live data): the reason in a calm tone and a way to sign in, never a red error.
	import { page } from '$app/state';
	import { guestSignInHref } from '$lib/guest';

	let { message }: { message: string } = $props();
</script>

<div class="guest-note" role="status" data-testid="guest-note">
	<span>{message}</span>
	<a href={guestSignInHref(page.url.pathname + page.url.search)}>Sign in</a>
</div>

<style>
	.guest-note {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px var(--space-3);
		padding: var(--space-2) var(--space-3);
		font-size: 0.875rem;
		line-height: 1.45;
		color: var(--ink);
		background: var(--warn-soft);
		border: var(--border-w) dashed var(--ink);
	}
	a {
		font-weight: 600;
		color: var(--ink);
	}
</style>
