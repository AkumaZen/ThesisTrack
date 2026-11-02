<script lang="ts">
	import { onMount } from 'svelte';
	import { loadDocumentHistory } from '$lib/companyDocumentRefresh';
	import { DOCUMENT_TYPES, type DocumentRefreshProgress, type CompanyDocument } from '$lib/companyDocuments';
	let { companyId, canWrite }: { companyId: string; canWrite: boolean } = $props();
	let documents = $state<CompanyDocument[]>([]);
	let warnings = $state<string[]>([]);
	let busy = $state(false);
	let loaded = $state(false);
	let progress = $state<DocumentRefreshProgress | null>(null);
	let category = $state('All');
	let visible = $derived(documents.filter((d) => d.analysis?.important && (category === 'All' || d.analysis.category === category)));
	let pending = $derived(documents.filter((d) => !d.analysis).length);
	async function load(refresh = false) {
		busy = true; warnings = [];
		try {
			await loadDocumentHistory(companyId, refresh, (body) => { documents = body.documents; warnings = body.warnings; progress = body.progress ?? null; loaded = true; });
		} catch (e) { warnings = [e instanceof Error ? e.message : 'Documents could not be loaded.']; }
		finally { busy = false; }
	}
	onMount(() => { void load(); });
</script>

<section id="cp-sec-documents" aria-label="Important documents" class="mt-5 rounded-xl border border-border bg-surface p-5 max-sm:p-4 scroll-mt-20">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Important documents</h3>
		{#if canWrite}<button class="calm-btn" disabled={busy} onclick={() => load(true)}>{busy ? 'Loading documents…' : 'Refresh documents'}</button>{/if}
	</div>
	<p class="text-xs text-muted-fg mt-2">Recent material NSE filings, summarised by GPT Luna. Open a takeaway for details and the original PDF.</p>
	<label class="block text-xs mt-4">Document type
		<select aria-label="Document type" class="ml-2 max-w-full" bind:value={category}><option>All</option>{#each DOCUMENT_TYPES as type}<option>{type}</option>{/each}</select>
	</label>
	{#if progress}<p role="status" class="text-sm mt-3">{progress.state === 'reviewing' ? 'Reviewing' : 'Processed'} {progress.processed} of {progress.total} candidate documents from {progress.discovered} exchange filings.{progress.failed ? ` ${progress.failed} need retry.` : ''}</p>{#if progress.state === 'reviewing'}<progress class="w-full mt-2" value={progress.processed} max={Math.max(1, progress.total)} aria-label="Document review progress"></progress>{/if}<p class="text-xs text-muted-fg mt-2">Available NSE history: {progress.oldest ? new Date(progress.oldest).toLocaleDateString('en-IN') : 'not available'} to {progress.newest ? new Date(progress.newest).toLocaleDateString('en-IN') : 'not available'}.</p>{/if}
	{#each warnings as warning}<p role="status" class="text-sm mt-3 text-danger">{warning}</p>{/each}
	{#if !loaded && busy}<p role="status" class="text-sm mt-3">Loading saved documents…</p>{/if}
	{#if loaded && !visible.length}<p class="text-sm mt-4">No summarised important documents{category !== 'All' ? ' in this category' : ''} yet.{canWrite ? ' Refresh documents to check recent filings.' : ''}</p>{/if}
	{#each visible as doc (doc.id)}
		<details class="border-t border-border mt-4 pt-3">
			<summary class="cursor-pointer text-sm"><span class="text-xs text-muted-fg">{new Date(doc.announcedAt).toLocaleDateString('en-IN')} · {doc.analysis!.category}</span><span class="block font-medium mt-1">{doc.analysis!.takeaway}</span></summary>
			<p class="text-xs text-muted-fg mt-3">{doc.subject}</p>
			<p class="text-sm whitespace-pre-line mt-2">{doc.analysis!.summary}</p>
			<a class="text-sm underline inline-block mt-3" href={doc.pdfUrl} target="_blank" rel="noopener noreferrer">Open original filing (PDF)</a>
		</details>
	{/each}
	{#if pending}<p class="text-xs text-muted-fg mt-4">{pending} filing(s) awaiting document review. One Refresh automatically reviews the full history; saved summaries are reused.</p>{/if}
	{#if documents.some((d) => d.reviewError)}<details class="mt-4"><summary class="text-sm font-medium">Documents requiring retry</summary><ul class="mt-2 space-y-3">{#each documents.filter((d) => d.reviewError) as doc (doc.id)}<li class="text-sm"><a class="underline" href={doc.pdfUrl} target="_blank" rel="noopener noreferrer">{doc.subject}</a><p class="text-xs text-muted-fg mt-1">{doc.reviewError}</p></li>{/each}</ul></details>{/if}
</section>
