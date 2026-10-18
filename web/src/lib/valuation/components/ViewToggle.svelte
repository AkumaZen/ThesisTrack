<script lang="ts">
	// List / Grid switch for result lists. Two toggle buttons, state announced through aria-pressed.
	let { value = $bindable('list') }: { value: 'list' | 'grid' } = $props();
</script>

<div class="view-toggle no-print" role="group" aria-label="Layout">
	<button type="button" aria-pressed={value === 'list'} data-testid="layout-list" onclick={() => (value = 'list')}
		>List</button
	>
	<button type="button" aria-pressed={value === 'grid'} data-testid="layout-grid" onclick={() => (value = 'grid')}
		>Grid</button
	>
</div>
