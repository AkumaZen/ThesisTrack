<script lang="ts">
	import type { Source } from '../masterTracker';
	let { sources }: { sources: Source[] } = $props();
</script>
<details class="sources">
	<summary>Sources ({sources.length})</summary>
	{#each sources as source}
		<div><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>{source.page ? ` · Page ${source.page}` : ' · Structured financial data'}<blockquote>{source.excerpt}</blockquote></div>
	{/each}
</details>
<style>.sources{font-size:12px;margin-top:8px}summary{cursor:pointer;color:var(--accent)}blockquote{margin:8px 0;padding-left:10px;border-left:2px solid var(--rule);color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere}</style>
