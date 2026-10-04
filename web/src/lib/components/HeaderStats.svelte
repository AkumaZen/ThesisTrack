<script lang="ts">
	// Ports frontend/components/cards.js's renderHeaderStats().
	let { companies }: { companies: Array<{ status: string | null; last_reviewed: string | null; has_active_override: boolean }> } = $props();

	let counts = $derived.by(() => {
		const c = { on_track: 0, watch_closely: 0, broken: 0 };
		let reviewDue = 0;
		let activeOverrides = 0;
		for (const co of companies) {
			if (co.status) c[co.status as keyof typeof c] = (c[co.status as keyof typeof c] ?? 0) + 1;
			const days = co.last_reviewed ? Math.floor((Date.now() - new Date(co.last_reviewed).getTime()) / 86400000) : 0;
			if (days > 91) reviewDue += 1;
			if (co.has_active_override) activeOverrides += 1;
		}
		return { total: companies.length, ...c, reviewDue, activeOverrides };
	});
</script>

<dl class="stats" aria-label="Portfolio summary">
	{#each [
		{ label: 'Total tracked', value: counts.total, tone: '' },
		{ label: 'On track', value: counts.on_track, tone: 'good' },
		{ label: 'Watch closely', value: counts.watch_closely, tone: 'warn' },
		{ label: 'Broken', value: counts.broken, tone: 'danger' },
		{ label: 'Review due', value: counts.reviewDue, tone: 'warn' },
		{
			label: 'Warnings overridden',
			value: counts.activeOverrides,
			tone: 'danger',
			title: 'Companies where a sell/exit rule was triggered but you chose to keep holding anyway'
		}
	] as stat (stat.label)}
		<div class="stat" title={stat.title}>
			<dt>{stat.label}</dt>
			<!-- A status colour only when there is something to look at. -->
			<dd class="num" data-tone={stat.value > 0 ? stat.tone : ''}>{stat.value}</dd>
		</div>
	{/each}
</dl>

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
	}
	.stat {
		display: flex;
		flex-direction: column-reverse;
		gap: 2px;
		padding: var(--space-3);
		min-width: 0;
	}
	.stat + .stat {
		border-left: 1px solid var(--rule);
	}
	dt {
		font-size: 0.75rem;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	dd {
		font-size: 1.75rem;
		font-weight: 600;
		line-height: 1.1;
	}
	dd[data-tone='good'] {
		color: var(--good);
	}
	dd[data-tone='warn'] {
		color: var(--warn);
	}
	dd[data-tone='danger'] {
		color: var(--danger);
	}
	@media (max-width: 900px) {
		.stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.stat:nth-child(4) {
			border-left: 0;
		}
		.stat:nth-child(n + 4) {
			border-top: 1px solid var(--rule);
		}
	}
	@media (max-width: 480px) {
		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.stat:nth-child(odd) {
			border-left: 0;
		}
		.stat:nth-child(4) {
			border-left: 1px solid var(--rule);
		}
		.stat:nth-child(n + 3) {
			border-top: 1px solid var(--rule);
		}
	}
</style>
