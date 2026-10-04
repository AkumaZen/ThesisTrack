<script lang="ts">
	import type { StrengthEvaluation } from '$lib/valuation/strength';

	// The explanation under a result: which signals matched and the numbers behind them, and which
	// switched-on signals could not be computed (and why). On cards it is a compact disclosure;
	// with `all` (the single-company view) it lists every switched-on signal, matched or not.
	let {
		evaluation,
		open = false,
		all = false
	}: { evaluation: StrengthEvaluation | undefined; open?: boolean; all?: boolean } = $props();

	const LABELS = {
		sudden: 'Suddenly strengthening',
		gradual: 'Gradually strengthening',
		spreading: 'Strength spreading',
		volume: 'Volume'
	} as const;
	const rows = $derived(
		evaluation
			? (Object.keys(LABELS) as (keyof typeof LABELS)[])
					.filter((k) => evaluation.signals[k].status !== 'off')
					.map((k) => ({ key: k, label: LABELS[k], signal: evaluation.signals[k] }))
			: []
	);
</script>

{#if evaluation?.active}
	{#if all}
		<ul class="sv-signal-list" aria-label="Strength and volume readings">
			{#each rows as r (r.key)}
				<li>
					<span
						class="sv-state {r.signal.status === 'unavailable'
							? 'sv-state-na'
							: r.signal.matched
								? 'sv-state-ok'
								: 'sv-state-no'}"
						>{r.signal.status === 'unavailable' ? 'Unavailable' : r.signal.matched ? 'Matches' : 'Not now'}</span
					>
					<strong>{r.label}</strong>
					<span class="sv-signal-detail">{r.signal.detail}</span>
				</li>
			{/each}
		</ul>
	{:else if evaluation.matched || evaluation.unavailable.length}
		<details class="sv-why" {open}>
			<summary>
				{#if evaluation.matched}<span class="sv-why-ok">Why it matches</span>{/if}
				{#if evaluation.unavailable.length}
					<span class="sv-why-na">{evaluation.unavailable.length} unavailable</span>
				{/if}
			</summary>
			{#if evaluation.reasons.length}
				<ul class="sv-why-list">
					{#each evaluation.reasons as r (r)}<li>{r}</li>{/each}
				</ul>
			{/if}
			{#if evaluation.unavailable.length}
				<ul class="sv-why-list sv-why-list-na">
					{#each evaluation.unavailable as r (r)}<li>{r}</li>{/each}
				</ul>
			{/if}
		</details>
	{/if}
{/if}
