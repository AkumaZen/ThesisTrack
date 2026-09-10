<script lang="ts">
	let { items }: { items: string[] } = $props();
</script>

{#if items.length}
	<ul class="list-disc pl-5 space-y-3 text-sm">
		{#each items as item, index (index)}
			<li class="whitespace-pre-wrap break-words">{item}</li>
		{/each}
	</ul>
{:else}
	<p class="text-sm text-muted-fg">No trackables added yet.</p>
{/if}
