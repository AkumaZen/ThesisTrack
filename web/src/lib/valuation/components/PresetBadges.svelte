<script lang="ts">
	import { PRESETS, type PresetId } from '$lib/valuation/presetScans';

	// The preset scans a stock passes now ("Scan Match"). Compact chips; each carries its rule as a tooltip.
	let { ids, empty = '' }: { ids: PresetId[]; empty?: string } = $props();
</script>

{#if ids.length > 0}
	<ul class="preset-badges" aria-label="Preset scans passed">
		{#each PRESETS.filter((p) => ids.includes(p.id)) as p (p.id)}
			<li class="preset-badge" title={p.description}>{p.label}</li>
		{/each}
	</ul>
{:else if empty}
	<span class="preset-none">{empty}</span>
{/if}
