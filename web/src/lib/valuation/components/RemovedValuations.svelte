<script lang="ts">
	import { timeAgo } from '$lib/valuation/activity';
	import { restoreValuation, type RemovedValuation } from '$lib/valuation/savedValuations';

	// Companies removed from the watchlist in the last 30 days, each one click from restored with
	// its full valuation. `refreshKey` changes whenever the watchlist itself changed.
	let { refreshKey, onRestored }: { refreshKey: number; onRestored: () => Promise<void> } =
		$props();

	let items = $state<RemovedValuation[]>([]);
	let busy = $state<string | null>(null);
	let message = $state<string | null>(null);

	async function load() {
		const res = await fetch('/api/valuation/valuations/removed');
		if (res.ok) items = (await res.json()) as RemovedValuation[];
	}

	$effect(() => {
		void refreshKey;
		void load();
	});

	async function restore(item: RemovedValuation) {
		busy = item.symbol;
		const res = await restoreValuation(item.symbol, item.versionId, 0);
		busy = null;
		if (res.ok) {
			message = `${item.name} is back on the watchlist.`;
			await onRestored();
			await load();
		} else if (res.conflict) {
			message = `${item.name} was already added back by someone else.`;
			await onRestored();
			await load();
		} else {
			message = `Could not restore ${item.name}: ${res.message}`;
		}
	}
</script>

{#if items.length > 0 || message}
	<details class="removed-list" data-testid="removed-list">
		<summary>Recently removed ({items.length})</summary>
		{#if message}<p class="team-info" role="status">{message}</p>{/if}
		<ul>
			{#each items as item (item.symbol)}
				<li>
					<span class="removed-name">{item.name}</span>
					<span class="muted">removed by {item.removedBy} · {timeAgo(item.removedAt)}</span>
					<button
						class="link-btn"
						type="button"
						disabled={busy !== null}
						aria-label="Restore {item.name}"
						onclick={() => restore(item)}>{busy === item.symbol ? 'Restoring…' : 'Restore'}</button
					>
				</li>
			{/each}
		</ul>
	</details>
{/if}
