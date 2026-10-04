<script lang="ts">
	import { invalidate } from '$app/navigation';
	import {
		SECTOR_CARD_METRICS,
		DEFAULT_SECTOR_CARD_METRICS,
		type SectorCardMetric
	} from '$lib/prefs';

	// Which figures each sector card shows. Saved for this person only; at least one stays on.
	let {
		metrics,
		onChange
	}: { metrics: SectorCardMetric[]; onChange: (m: SectorCardMetric[]) => void } = $props();

	async function save(next: SectorCardMetric[]) {
		// Keep the canonical order so cards read the same left to right everywhere.
		const ordered = SECTOR_CARD_METRICS.map((m) => m.id).filter((id) => next.includes(id));
		onChange(ordered);
		await fetch('/api/me/prefs', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sectorCard: { metrics: ordered } })
		});
		await invalidate('app:prefs');
	}

	function toggle(id: SectorCardMetric, on: boolean) {
		const next = on ? [...metrics, id] : metrics.filter((m) => m !== id);
		if (next.length) void save(next);
	}
</script>

<details class="col-chooser" data-testid="card-metrics">
	<summary class="wl-strip-btn">Card figures</summary>
	<div class="col-chooser-panel">
		<p class="hint">Which figures every sector card shows. Saved for you only.</p>
		<ul>
			{#each SECTOR_CARD_METRICS as m (m.id)}
				<li>
					<label title={m.help}>
						<input
							type="checkbox"
							checked={metrics.includes(m.id)}
							disabled={metrics.length === 1 && metrics.includes(m.id)}
							onchange={(e) => toggle(m.id, (e.currentTarget as HTMLInputElement).checked)}
						/>
						{m.label} <span class="muted">· {m.help}</span>
					</label>
				</li>
			{/each}
		</ul>
		<button class="link-btn" type="button" onclick={() => save([...DEFAULT_SECTOR_CARD_METRICS])}
			>Reset to default</button
		>
	</div>
</details>
