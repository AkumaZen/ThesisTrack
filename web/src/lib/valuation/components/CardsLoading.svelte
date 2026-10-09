<script lang="ts">
	// Shown in place of a card grid until every card has its figures, so the grid appears once,
	// already in order, instead of reshuffling while cards arrive one by one.
	let { done, total, noun }: { done: number; total: number; noun: string } = $props();
	const pct = $derived(total > 0 ? Math.round((done / total) * 100) : 0);
</script>

<div class="cards-loading" role="status" aria-live="polite">
	<p class="cards-loading-text">Loading {noun}… <span class="cards-loading-count">{done} of {total}</span></p>
	<div
		class="cards-loading-bar"
		role="progressbar"
		aria-label="Loading {noun}"
		aria-valuemin="0"
		aria-valuemax={total}
		aria-valuenow={done}
	>
		<div class="cards-loading-fill" style="width: {pct}%"></div>
	</div>
	<p class="cards-loading-hint">The cards appear together once all are ready, already sorted.</p>
</div>

<style>
	.cards-loading {
		margin-top: var(--space-4);
		padding: var(--space-6) var(--space-4);
		border: var(--border-w) solid var(--ink);
		background: var(--surface);
		text-align: center;
		font-family: var(--font-sans);
	}
	.cards-loading-text {
		margin: 0 0 var(--space-3);
		font-size: 15px;
		font-weight: 600;
		color: var(--ink);
	}
	.cards-loading-count {
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 500;
		color: var(--muted);
	}
	.cards-loading-bar {
		max-width: 360px;
		height: 10px;
		margin: 0 auto;
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
	}
	.cards-loading-fill {
		height: 100%;
		background: var(--ink);
		transition: width 200ms ease-out;
	}
	.cards-loading-hint {
		margin: var(--space-3) 0 0;
		font-size: 12px;
		color: var(--muted);
	}
	@media (prefers-reduced-motion: reduce) {
		.cards-loading-fill {
			transition: none;
		}
	}
</style>
