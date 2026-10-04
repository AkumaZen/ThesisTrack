<script lang="ts">
	import '$lib/valuation/styles/dashboard.css';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { readVisit, rememberOrigin, rememberVisit, type Place } from '$lib/viewMemory';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const COMPANY = /^\/valuation\/company\/([^/]+)$/;
	const LANDING = ['/valuation', '/valuation/sector-rotation'];

	/** The page's own title: the heading's text, without badges and other markup inside it. */
	function pageTitle(): string {
		const h1 = document.querySelector('.vd .band h1');
		if (!h1) return '';
		return [...h1.childNodes]
			.filter((n) => n.nodeType === Node.TEXT_NODE)
			.map((n) => n.textContent ?? '')
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	// Opening a company from a list: remember the list (with its sort), so the company's back
	// link returns to that exact list rather than to the top of the tool.
	beforeNavigate(({ from, to }) => {
		const match = to ? COMPANY.exec(to.url.pathname) : null;
		if (!match || !from) return;
		const label = pageTitle();
		if (!label) return;
		rememberOrigin(data.user?.id, decodeURIComponent(match[1]), {
			// The browser's own address: it carries the sort and range mirrored into the URL.
			path: window.location.pathname + window.location.search,
			label
		});
	});

	// The place to offer "continue where you left off" from, read before this visit is recorded.
	let lastPlace = $state<Place | null>(null);
	let here = $state('');
	afterNavigate(({ to }) => {
		const path = to?.url.pathname ?? '';
		here = path;
		lastPlace = readVisit(data.user?.id);
		const label = pageTitle();
		if (label && !LANDING.includes(path)) rememberVisit(data.user?.id, { path, label });
	});

	const offer = $derived(lastPlace && LANDING.includes(here) && lastPlace.path !== here ? lastPlace : null);
</script>

<!-- The valuation tools' stylesheet is scoped to .vd so it can never restyle thesis pages. -->
<div class="vd">
	{#if offer}
		<p class="vm-continue" data-testid="continue-where-left-off">
			<span>Continue where you left off:</span>
			<a href={resolve(offer.path as '/valuation')}>{offer.label} &rarr;</a>
		</p>
	{/if}
	{@render children()}
</div>
