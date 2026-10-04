<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Site-wide keys. "?" shows this list; "g" then a letter jumps to a page ("/" for search lives
	// in GlobalSearch). Ignored while typing in a field, and with Ctrl/Cmd/Alt held.
	const PAGES = [
		{ key: 'w', label: 'Watchlist', href: resolve('/') },
		{ key: 'c', label: 'Compare', href: resolve('/compare') },
		{ key: 's', label: 'Sector rotation', href: resolve('/sector-rotation') },
		{ key: 'b', label: 'Breakout scanner', href: resolve('/stage-scanner') },
		{ key: 'a', label: 'Alerts', href: resolve('/alerts') },
		{ key: 't', label: 'Settings', href: resolve('/settings') }
	];

	let dialog = $state<HTMLDialogElement>();
	let pendingG = false;
	let gTimer: ReturnType<typeof setTimeout> | undefined;

	function typing(t: EventTarget | null): boolean {
		const el = t as HTMLElement | null;
		return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
		if (e.key === '?') {
			e.preventDefault();
			if (dialog?.open) dialog.close();
			else dialog?.showModal();
			return;
		}
		if (pendingG) {
			pendingG = false;
			clearTimeout(gTimer);
			const page = PAGES.find((p) => p.key === e.key.toLowerCase());
			if (page) {
				e.preventDefault();
				dialog?.close();
				void goto(page.href);
			}
			return;
		}
		if (e.key === 'g') {
			pendingG = true;
			gTimer = setTimeout(() => (pendingG = false), 1500);
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<dialog
	bind:this={dialog}
	class="kbd-dialog"
	aria-labelledby="kbd-title"
	data-testid="shortcuts"
	onclick={(e) => {
		if (e.target === e.currentTarget) dialog?.close();
	}}
>
	<h2 id="kbd-title">Keyboard shortcuts</h2>
	<dl>
		<dt><kbd>/</kbd></dt>
		<dd>Search companies, sectors and notes</dd>
		{#each PAGES as p (p.key)}
			<dt><kbd>g</kbd> then <kbd>{p.key}</kbd></dt>
			<dd>Go to {p.label}</dd>
		{/each}
		<dt><kbd>?</kbd></dt>
		<dd>Show or hide this list</dd>
		<dt><kbd>Esc</kbd></dt>
		<dd>Close a menu or this list</dd>
	</dl>
	<form method="dialog"><button class="wl-strip-btn">Close</button></form>
</dialog>
