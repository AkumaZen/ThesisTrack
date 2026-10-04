<script lang="ts">
	import { resolve } from '$app/paths';
	import { timeAgo, type ActivityEntry } from '$lib/activity';

	let { limit = 12 }: { limit?: number } = $props();

	let entries = $state<ActivityEntry[] | null>(null);
	let error = $state<string | null>(null);
	let includeMine = $state(false);
	let loadingMore = $state(false);
	let exhausted = $state(false);
	let now = $state(Date.now());

	async function fetchPage(before?: number): Promise<ActivityEntry[]> {
		const query = [
			`limit=${limit}`,
			includeMine ? '' : 'others=1',
			before === undefined ? '' : `before=${before}`
		]
			.filter(Boolean)
			.join('&');
		const res = await fetch(`/api/activity?${query}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return (await res.json()) as ActivityEntry[];
	}

	async function load() {
		error = null;
		try {
			const page = await fetchPage();
			entries = page;
			exhausted = page.length < limit;
			now = Date.now();
		} catch (e) {
			error = `Could not load team activity (${(e as Error).message}).`;
		}
	}

	async function more() {
		if (!entries?.length) return;
		loadingMore = true;
		try {
			const page = await fetchPage(entries[entries.length - 1].at);
			entries = [...entries, ...page];
			exhausted = page.length < limit;
		} catch {
			error = 'Could not load older activity.';
		} finally {
			loadingMore = false;
		}
	}

	// Reload when the toggle changes, and every minute while the tab is visible, so the feed
	// keeps up with teammates without anyone refreshing the page.
	$effect(() => {
		void includeMine;
		void load();
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') void load();
		}, 60_000);
		return () => clearInterval(timer);
	});
</script>

<section class="activity-feed" aria-labelledby="activity-title" data-testid="activity-feed">
	<div class="activity-head">
		<h2 id="activity-title">Team activity</h2>
		<label class="activity-toggle">
			<input type="checkbox" bind:checked={includeMine} />
			Include mine
		</label>
	</div>
	{#if error}
		<p class="team-error" role="alert">
			{error} <button class="link-btn" type="button" onclick={load}>Try again</button>
		</p>
	{:else if entries === null}
		<p class="muted">Loading…</p>
	{:else if entries.length === 0}
		<p class="muted">
			{includeMine
				? 'Nothing has happened yet.'
				: 'No changes by teammates yet. Their edits, notes and reviews will show up here.'}
		</p>
	{:else}
		<ol class="activity-list">
			{#each entries as e (e.id)}
				<li class="activity-item" data-testid="activity-item">
					<span class="activity-who">{e.actor}</span>
					{#if e.symbol}
						<a href={resolve('/company/[symbol]', { symbol: e.symbol })}>{e.summary}</a>
					{:else}
						<span>{e.summary}</span>
					{/if}
					<time class="activity-when" datetime={new Date(e.at).toISOString()}
						>{timeAgo(e.at, now)}</time
					>
				</li>
			{/each}
		</ol>
		{#if !exhausted}
			<button class="link-btn" type="button" disabled={loadingMore} onclick={more}
				>{loadingMore ? 'Loading…' : 'Show older'}</button
			>
		{/if}
	{/if}
</section>
