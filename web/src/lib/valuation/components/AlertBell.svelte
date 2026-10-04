<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ALERTS_CHANGED_EVENT } from '$lib/alerts';

	// The alerts page announces changes (mark read etc.) via ALERTS_CHANGED_EVENT so the badge
	// updates immediately instead of waiting for the next poll.
	let unread = $state(0);

	async function refresh() {
		try {
			const res = await fetch('/api/alerts/unread-count');
			if (res.ok) unread = (await res.json()).unread ?? 0;
		} catch {
			/* the badge is best-effort - keep the last known count */
		}
	}

	$effect(() => {
		refresh();
		const timer = setInterval(refresh, 60_000);
		const onFocus = () => refresh();
		const onChanged = (e: Event) => {
			const detail = (e as CustomEvent<{ unread?: number }>).detail;
			if (typeof detail?.unread === 'number') unread = detail.unread;
			else refresh();
		};
		window.addEventListener('focus', onFocus);
		window.addEventListener(ALERTS_CHANGED_EVENT, onChanged);
		return () => {
			clearInterval(timer);
			window.removeEventListener('focus', onFocus);
			window.removeEventListener(ALERTS_CHANGED_EVENT, onChanged);
		};
	});

	const onAlertsPage = $derived(page.url.pathname === '/alerts');
</script>

<a
	class="alert-bell"
	class:alert-bell-active={onAlertsPage}
	href={resolve('/alerts')}
	aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}
	data-testid="alert-bell"
>
	<svg
		width="18"
		height="18"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.4"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path
			d="M8 2a4 4 0 0 0-4 4v2.2L2.8 10.5a.6.6 0 0 0 .5.9h9.4a.6.6 0 0 0 .5-.9L12 8.2V6a4 4 0 0 0-4-4Z"
		/>
		<path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
	</svg>
	{#if unread > 0}
		<span class="alert-bell-count" data-testid="alert-bell-count"
			>{unread > 99 ? '99+' : unread}</span
		>
	{/if}
</a>
