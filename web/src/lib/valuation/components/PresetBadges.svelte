<script lang="ts">
	import { PRESETS, type PresetId } from '$lib/valuation/presetScans';

	// The preset scans a stock passes now ("Scan Match"). Compact tags; each carries its rule as a tooltip.
	// Tone carries meaning: Stage 2 passes read good, new highs read info, indicator and fundamental signals stay plain.
	const TONE: Partial<Record<PresetId, string>> = {
		stage2: 'tag-good',
		'growth-stage2': 'tag-good',
		'fresh-breakout': 'tag-good',
		'near-high': 'tag-info',
		'five-year-high': 'tag-info'
	};
	let { ids, empty = '' }: { ids: PresetId[]; empty?: string } = $props();
</script>

{#if ids.length > 0}
	<ul class="tag-list preset-badges" aria-label="Preset scans passed">
		{#each PRESETS.filter((p) => ids.includes(p.id)) as p (p.id)}
			<li class="tag {TONE[p.id] ?? ''}" title={p.description}>{p.label}</li>
		{/each}
	</ul>
{:else if empty}
	<span class="preset-none">{empty}</span>
{/if}
