<script lang="ts">
	// Stands in for an action a guest cannot take (saving, refreshing, AI), so the page still shows
	// that the feature exists. Rendered instead of the real control, never next to it.
	let { label }: { label: string } = $props();
</script>

<span class="locked-action" data-testid="locked-action" title="Available to subscribers. Coming soon.">
	<svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"
		><rect x="1" y="5" width="8" height="6" fill="currentColor" /><path
			d="M3 5V3.5a2 2 0 0 1 4 0V5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
		/></svg
	>
	<span class="label">{label}</span>
	<span class="note">Subscribers only - coming soon</span>
</span>

<style>
	.locked-action {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px var(--space-2);
		min-height: 40px;
		padding: 4px var(--space-3);
		font-size: 0.875rem;
		color: var(--muted);
		border: var(--border-w) dashed var(--muted);
		background: var(--surface);
	}
	.label {
		font-weight: 600;
		color: var(--ink);
	}
	.note {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
</style>
