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
	// `max` keeps a crowded row short: the rest collapse into one "+N" tag that lists them on hover.
	let { ids, empty = '', max = Infinity }: { ids: PresetId[]; empty?: string; max?: number } = $props();
	const passed = $derived(PRESETS.filter((p) => ids.includes(p.id)));
	const shown = $derived(passed.length > max ? passed.slice(0, max) : passed);
	const hidden = $derived(passed.slice(shown.length));
</script>

{#if ids.length > 0}
	<ul class="tag-list preset-badges" class:compact={max !== Infinity} aria-label="Preset scans passed">
		{#each shown as p (p.id)}
			<li class="tag {TONE[p.id] ?? ''}" title={p.description}>{p.label}</li>
		{/each}
		{#if hidden.length}
			<li class="tag preset-more" title={hidden.map((p) => p.label).join(', ')}>+{hidden.length}</li>
		{/if}
	</ul>
{:else if empty}
	<span class="preset-none">{empty}</span>
{/if}

<style>
	/* Capped lists stay on one line so a crowded row does not grow tall. */
	.preset-badges.compact {
		flex-wrap: nowrap;
		gap: 4px;
		margin-top: 4px;
	}
	.preset-badges.compact .tag {
		white-space: nowrap;
		flex: none;
	}
</style>
