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

<div class="flex flex-wrap gap-3 mb-4">
	<div class="flex-1 min-w-[120px] rounded-lg border border-border bg-surface px-4 py-3">
		<div class="text-2xl font-mono font-semibold">{counts.total}</div>
		<div class="text-xs text-muted-fg">Total Tracked</div>
	</div>
	<div class="flex-1 min-w-[120px] rounded-lg border border-border bg-surface px-4 py-3">
		<div class="text-2xl font-mono font-semibold text-good">{counts.on_track}</div>
		<div class="text-xs text-muted-fg">On Track</div>
	</div>
	<div class="flex-1 min-w-[120px] rounded-lg border border-border bg-surface px-4 py-3">
		<div class="text-2xl font-mono font-semibold text-warn">{counts.watch_closely}</div>
		<div class="text-xs text-muted-fg">Watch Closely</div>
	</div>
	<div class="flex-1 min-w-[120px] rounded-lg border border-border bg-surface px-4 py-3">
		<div class="text-2xl font-mono font-semibold text-danger">{counts.broken}</div>
		<div class="text-xs text-muted-fg">Broken</div>
	</div>
	<div class="flex-1 min-w-[120px] rounded-lg border border-border bg-surface px-4 py-3">
		<div class="text-2xl font-mono font-semibold" class:text-warn={counts.reviewDue > 0}>{counts.reviewDue}</div>
		<div class="text-xs text-muted-fg">Review Due</div>
	</div>
	<div
		class="flex-1 min-w-[120px] rounded-lg border border-border bg-surface px-4 py-3"
		title="Companies where a sell/exit rule was triggered but you chose to keep holding anyway"
	>
		<div class="text-2xl font-mono font-semibold" class:text-danger={counts.activeOverrides > 0}>{counts.activeOverrides}</div>
		<div class="text-xs text-muted-fg">Warnings Overridden</div>
	</div>
</div>
