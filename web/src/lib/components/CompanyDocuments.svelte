<script lang="ts">
	import { onMount } from 'svelte';
	import { DOCUMENT_TYPES, type CompanyDocument } from '$lib/companyDocuments';
	let { companyId, canWrite }: { companyId: string; canWrite: boolean } = $props();
	let documents = $state<CompanyDocument[]>([]);
	let warnings = $state<string[]>([]);
	let busy = $state(false);
	let loaded = $state(false);
	let category = $state('All');
	let visible = $derived(documents.filter((d) => d.analysis?.important && (category === 'All' || d.analysis.category === category)));
	let pending = $derived(documents.filter((d) => !d.analysis).length);
	async function load(refresh = false) {
		busy = true; warnings = [];
		try {
			const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/documents`, { method: refresh ? 'POST' : 'GET' });
			if (!response.ok) { const body = await response.json(); throw new Error(body.detail ?? body.message ?? 'Documents could not be loaded.'); }
			const body = await response.json(); documents = body.documents; warnings = body.warnings; loaded = true;
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
	{#if pending}<p class="text-xs text-muted-fg mt-4">{pending} filing(s) awaiting document review. Refresh processes up to five at a time; routine filings are excluded after review.</p>{/if}
</section>
