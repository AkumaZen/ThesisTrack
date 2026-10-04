<script lang="ts">
	import type { Snippet } from 'svelte';

	// The title block at the top of a page: optional back link and eyebrow, the title, a short
	// subtitle, and the page's main actions on the right.
	let {
		title,
		subtitle,
		eyebrow,
		back,
		actions,
		children
	}: {
		title: string;
		subtitle?: string;
		eyebrow?: string;
		back?: { href: string; label: string };
		actions?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<div class="page-header">
	<div class="page-header-text">
		{#if back}<a class="page-back" href={back.href}>← {back.label}</a>{/if}
		{#if eyebrow}<div class="eyebrow">{eyebrow}</div>{/if}
		<h1>{title}</h1>
		{#if subtitle}<p class="page-sub">{subtitle}</p>{/if}
		{@render children?.()}
	</div>
	{#if actions}<div class="page-actions">{@render actions()}</div>{/if}
</div>

<style>
	.page-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-3) var(--space-4);
		flex-wrap: wrap;
		margin-bottom: var(--space-4);
	}
	.page-header-text {
		min-width: 0;
	}
	h1 {
		font-size: clamp(1.5rem, 2.4vw, 2rem);
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.page-sub {
		margin-top: var(--space-1);
		font-size: 0.9375rem;
		color: var(--muted);
		max-width: 70ch;
	}
	.page-back {
		display: inline-block;
		margin-bottom: var(--space-2);
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
	}
	.page-back:hover {
		text-decoration: underline;
	}
	.page-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
