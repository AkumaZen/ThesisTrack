<script lang="ts">
	// The guest's refusal notice (see lib/guestNotice.svelte.ts): a friendly line with a way to
	// sign in, in place of a red error. It clears on the next navigation.
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { guestSignInHref } from '$lib/guest';
	import { guestNotice } from '$lib/guestNotice.svelte';

	afterNavigate(() => guestNotice.dismiss());
</script>

{#if guestNotice.message}
	<div class="guest-notice" role="status" data-testid="guest-notice">
		<p>{guestNotice.message}</p>
		<div class="actions">
			<a class="btn btn-dark btn-sm" href={guestSignInHref(page.url.pathname + page.url.search)}>Sign in</a>
			<button type="button" class="btn btn-ghost btn-sm" onclick={() => guestNotice.dismiss()}>Not now</button>
		</div>
	</div>
{/if}

<style>
	.guest-notice {
		position: fixed;
		z-index: 60;
		left: 50%;
		bottom: var(--space-4);
		transform: translateX(-50%);
		width: min(440px, calc(100vw - 2 * var(--space-4)));
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--warn-soft);
		border: var(--border-w) solid var(--ink);
		box-shadow: var(--shadow-hard);
		color: var(--ink);
	}
	p {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.45;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
