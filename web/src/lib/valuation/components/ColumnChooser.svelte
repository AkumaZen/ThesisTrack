<script lang="ts">
	import { DEFAULT_COLUMNS, WATCHLIST_COLUMNS, moveColumn, type ColumnId } from '$lib/valuation/prefs';

	// Which watchlist columns to show and in what order. Shown columns are listed first in their
	// order (with move buttons), then the hidden ones. Every change is reported via onChange.
	let { columns, onChange }: { columns: ColumnId[]; onChange: (c: ColumnId[]) => void } = $props();

	const label = (id: ColumnId) => WATCHLIST_COLUMNS.find((c) => c.id === id)!.label;
	const help = (id: ColumnId) => WATCHLIST_COLUMNS.find((c) => c.id === id)!.help;
	const hidden = $derived(WATCHLIST_COLUMNS.map((c) => c.id).filter((id) => !columns.includes(id)));

	function toggle(id: ColumnId) {
		if (columns.includes(id)) {
			if (columns.length > 1) onChange(columns.filter((c) => c !== id));
		} else {
			onChange([...columns, id]);
		}
	}
</script>

<details class="col-chooser" data-testid="column-chooser">
	<summary class="wl-strip-btn">Columns</summary>
	<div class="col-chooser-panel">
		<p class="hint">Saved for you only. The company column always comes first.</p>
		<ul>
			{#each columns as id, i (id)}
				<li>
					<label title={help(id)}>
						<input
							type="checkbox"
							checked
							disabled={columns.length === 1}
							onchange={() => toggle(id)}
						/>
						{label(id)}
					</label>
					<span class="col-move">
						<button
							type="button"
							aria-label="Move {label(id)} left"
							disabled={i === 0}
							onclick={() => onChange(moveColumn(columns, id, -1))}>↑</button
						>
						<button
							type="button"
							aria-label="Move {label(id)} right"
							disabled={i === columns.length - 1}
							onclick={() => onChange(moveColumn(columns, id, 1))}>↓</button
						>
					</span>
				</li>
			{/each}
			{#each hidden as id (id)}
				<li class="col-hidden">
					<label title={help(id)}>
						<input type="checkbox" onchange={() => toggle(id)} />
						{label(id)}
					</label>
				</li>
			{/each}
		</ul>
		<button class="link-btn" type="button" onclick={() => onChange([...DEFAULT_COLUMNS])}
			>Reset to default</button
		>
	</div>
</details>
