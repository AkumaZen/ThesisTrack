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
	let search = $state('');
	let sort = $state('newest');
	let checkedAt = $state<Date | null>(null);
	let important = $derived(documents.filter((d) => d.analysis?.important));
	let counts = $derived(Object.fromEntries(DOCUMENT_TYPES.map((type) => [type, important.filter((d) => d.analysis!.category === type).length])));
	let filtered = $derived(category !== 'All' || !!search.trim());
	let visible = $derived(important.filter((d) => (category === 'All' || d.analysis!.category === category) && `${d.subject} ${d.analysis!.takeaway} ${d.analysis!.summary}`.toLowerCase().includes(search.trim().toLowerCase())).toSorted((a, b) => (sort === 'newest' ? -1 : 1) * (Date.parse(a.announcedAt) - Date.parse(b.announcedAt))));
	let pending = $derived(documents.filter((d) => !d.analysis).length);
	const dateLabel = (value: string) => new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
	const paragraphs = (value: string) => value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
	function clearFilters() { category = 'All'; search = ''; }
	async function load(refresh = false) {
		if (busy) return;
		busy = true; warnings = [];
		try {
			await loadDocumentHistory(companyId, refresh, (body) => { documents = body.documents; warnings = body.warnings; progress = body.progress ?? null; loaded = true; });
			if (refresh) checkedAt = new Date();
		} catch (e) { warnings = [e instanceof Error ? e.message : 'Documents could not be loaded.']; }
		finally { busy = false; }
	}
	onMount(() => { void load(); });
</script>

<section id="cp-sec-documents" class="documents" aria-label="Important documents" aria-busy={busy}>
	<header class="documents-header">
		<div class="header-copy"><h3>Important documents</h3><p>Material announcements, with the details that matter.</p></div>
		{#if canWrite}<button class="refresh-button" disabled={busy} onclick={() => load(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17"/></svg>{busy ? 'Checking documents…' : 'Refresh documents'}</button>{/if}
	</header>
	<div class="document-tools">
		<label class="type-field">Document type<select bind:value={category} aria-label="Document type"><option value="All">All types{loaded ? ` (${important.length})` : ''}</option>{#each DOCUMENT_TYPES as type}<option value={type}>{type}{loaded ? ` (${counts[type]})` : ''}</option>{/each}</select></label>
		<label class="search-field">Search documents<span class="search-control"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input type="search" bind:value={search} placeholder="Search filings" /></span></label>
		<label class="sort-field">Sort by<select bind:value={sort} aria-label="Sort documents"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
	</div>
	<div class="list-caption">
		<p role="status">{#if busy}{loaded ? 'Checking filings and reviewing new documents…' : 'Loading saved documents…'}{:else if loaded}<strong>{visible.length}</strong>{filtered ? ` of ${important.length}` : ''} {visible.length === 1 && !filtered ? 'important document' : 'important documents'}{#if filtered}<button class="text-button" onclick={clearFilters}>Clear filters</button>{/if}{:else}Saved documents{/if}</p>
		<span class="source-caption">NSE · GPT Luna</span>
	</div>
	{#if warnings.length}<div class="document-warning" role="status"><div><h4>{loaded ? 'Some documents could not be updated' : 'Documents could not be loaded'}</h4>{#each warnings as warning}<p>{warning}</p>{/each}</div><button class="text-button" disabled={busy} onclick={() => load(canWrite)}>Try again</button></div>{/if}
	{#if !loaded && busy}
		<div class="loading-rows" aria-hidden="true">{#each [1, 2, 3] as row (row)}<div class="loading-row"><span></span><span></span></div>{/each}</div>
	{:else if loaded && !visible.length}
		<div class="document-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5"/></svg><h4>{filtered ? 'No matching documents' : pending ? 'Documents are awaiting review' : 'No important documents yet'}</h4><p>{filtered ? 'Try another document type or search term.' : canWrite ? 'Refresh documents to check recent filings and prepare summaries of material announcements.' : 'Saved summaries will appear here after an analyst reviews the latest filings.'}</p></div>
	{:else}
		<div class="document-list">{#each visible as doc (doc.id)}
			<details class="document-row">
				<summary><span class="row-copy"><span class="row-metadata"><span class="category-label">{doc.analysis!.category}</span><time datetime={doc.announcedAt}>{dateLabel(doc.announcedAt)}</time></span><span class="document-title">{doc.analysis!.takeaway}</span></span><span class="row-action"><span class="read-label">Read summary</span><span class="close-label">Close summary</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg></span></summary>
				<div class="document-content"><h4>Announcement summary</h4><div class="summary-prose">{#each paragraphs(doc.analysis!.summary) as paragraph, i (i)}<p>{paragraph}</p>{/each}</div><footer class="filing-source"><div><span class="source-label">Exchange filing</span><p>{doc.subject}</p></div><a href={doc.pdfUrl} target="_blank" rel="noopener noreferrer">View original PDF<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg><span class="new-tab-note"> (opens in a new tab)</span></a></footer></div>
			</details>
		{/each}</div>
	{/if}
	{#if progress}<div class="list-caption"><p role="status">{progress.state === 'reviewing' ? 'Reviewing' : 'Processed'} {progress.processed} of {progress.total} candidate documents from {progress.discovered} NSE filings.{progress.failed ? ` ${progress.failed} need retry.` : ''}</p>{#if progress.oldest && progress.newest}<p>Available NSE history: {dateLabel(progress.oldest)} to {dateLabel(progress.newest)}.</p>{/if}</div>{/if}
	{#if documents.some((d) => d.reviewError)}<details class="document-row"><summary>Documents requiring retry</summary><ul class="document-content">{#each documents.filter((d) => d.reviewError) as doc (doc.id)}<li><a href={doc.pdfUrl} target="_blank" rel="noopener noreferrer">{doc.subject}</a><p>{doc.reviewError}</p></li>{/each}</ul></details>{/if}
	<footer class="documents-footer"><p>{#if pending}<strong>{pending}</strong> {pending === 1 ? 'filing awaiting review' : 'filings awaiting review'}. {canWrite ? 'Refresh automatically reviews the full backlog.' : 'An analyst can refresh to review them.'}{:else}Only material announcements. Routine notices are excluded.{/if}</p>{#if checkedAt}<span>Last checked {checkedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>{/if}</footer>
</section>

<style>
	.documents { container: documents / inline-size; margin-top: 24px; border: 2px solid var(--ink); background: var(--bg); scroll-margin-top: calc(var(--shell-h) + 80px); }
	.documents-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; padding: 24px; }
	.header-copy { flex: 1; min-width: min(100%, 240px); }
	h3 { font-size: 20px; font-weight: 600; line-height: 1.3; }
	.header-copy p { margin-top: 6px; font-size: 13px; line-height: 1.6; color: var(--muted); }
	.refresh-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 10px 14px; background: var(--ink); color: var(--bg); font-size: 12px; font-weight: 600; transition: opacity var(--dur), background var(--dur); }
	.refresh-button:hover:not(:disabled) { opacity: .84; }
	.refresh-button:disabled { opacity: .5; }
	svg { width: 18px; height: 18px; flex-shrink: 0; }
	.document-tools { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.3fr) minmax(0, .9fr); grid-template-areas: 'type search sort'; gap: 12px; padding: 20px 24px; background: var(--surface); border-block: 1px solid var(--rule); }
	.document-tools label { display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: 12px; font-weight: 600; }
	.type-field { grid-area: type; } .search-field { grid-area: search; } .sort-field { grid-area: sort; }
	select, input { width: 100%; min-width: 0; min-height: 44px; border: 1px solid var(--rule); background-color: var(--bg); color: var(--ink); font: inherit; font-size: 13px; font-weight: 400; }
	select { padding: 10px 28px 10px 12px; text-overflow: ellipsis; }
	.search-control { position: relative; }
	.search-control svg { position: absolute; left: 12px; top: 13px; color: var(--muted); pointer-events: none; }
	input { padding: 10px 12px 10px 38px; }
	select:hover:not(:disabled), input:hover:not(:disabled) { border-color: var(--muted); }
	select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: none; }
	.list-caption { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 14px 24px; font-size: 12px; color: var(--muted); }
	.list-caption p { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
	.list-caption strong, .documents-footer strong { font-family: var(--font-mono); font-weight: 500; color: var(--ink); }
	.source-caption { font-size: 11px; white-space: nowrap; }
	.text-button { min-height: 36px; padding: 4px 8px; color: var(--ink); font-size: 12px; font-weight: 600; text-decoration: underline; text-underline-offset: 4px; }
	.text-button:hover { background: var(--surface); }
	.document-row { border-top: 1px solid var(--rule); }
	summary { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 20px 24px; list-style: none; transition: background var(--dur); }
	summary::-webkit-details-marker { display: none; }
	summary:hover { background: var(--surface); }
	summary:focus-visible { position: relative; outline-offset: -3px; }
	.row-copy { display: block; min-width: 0; }
	.row-metadata { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; font-size: 11px; line-height: 1.4; }
	.category-label { padding: 4px 8px; background: var(--surface); font-weight: 600; }
	time { font-family: var(--font-mono); font-size: 10px; color: var(--muted); }
	.document-title { display: block; font-size: 14px; line-height: 1.65; font-weight: 600; overflow-wrap: anywhere; }
	.row-action { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; font-size: 11px; color: var(--muted); }
	.row-action svg { transition: transform var(--dur) var(--ease); }
	.close-label { display: none; }
	.document-row[open] .read-label { display: none; }
	.document-row[open] .close-label { display: inline; }
	.document-row[open] .row-action svg { transform: rotate(180deg); }
	.document-row[open] summary { background: var(--surface); }
	.document-content { padding: 4px 24px 24px; background: var(--surface); }
	.document-content h4 { padding-top: 16px; border-top: 1px solid var(--rule); font-family: var(--font-sans); font-size: 13px; font-weight: 700; }
	.summary-prose { display: grid; gap: 14px; max-width: 70ch; padding-top: 12px; font-size: 14px; line-height: 1.8; overflow-wrap: anywhere; }
	.summary-prose p { white-space: pre-line; }
	.filing-source { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--rule); }
	.filing-source > div { flex: 1; min-width: min(100%, 180px); }
	.source-label { color: var(--muted); font-size: 11px; }
	.filing-source p { margin-top: 4px; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
	.filing-source a { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 12px; border: 1px solid var(--ink); background: var(--bg); font-size: 12px; font-weight: 600; }
	.filing-source a:hover { background: var(--ink); color: var(--bg); }
	.new-tab-note { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
	.document-empty { display: flex; align-items: flex-start; flex-direction: column; gap: 12px; padding: 28px 24px 36px; border-top: 1px solid var(--rule); }
	.document-empty > svg { width: 28px; height: 28px; margin-bottom: 4px; color: var(--muted); }
	.document-empty h4 { font-size: 16px; font-weight: 600; }
	.document-empty p { max-width: 52ch; font-size: 13px; line-height: 1.75; color: var(--muted); }
	.document-warning { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 16px 24px; border-top: 1px solid var(--rule); background: var(--surface); }
	.document-warning h4 { font-family: var(--font-sans); font-size: 13px; font-weight: 700; }
	.document-warning p { margin-top: 8px; font-size: 12px; line-height: 1.7; color: var(--muted); }
	.document-warning .text-button { flex-shrink: 0; }
	.documents-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; padding: 16px 24px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 11px; line-height: 1.7; }
	.documents-footer > span { white-space: nowrap; }
	.loading-row { display: grid; gap: 12px; padding: 24px; border-top: 1px solid var(--rule); }
	.loading-row span { display: block; width: 72%; height: 12px; background: var(--surface-3); }
	.loading-row span:first-child { width: 28%; height: 10px; }
	@container documents (max-width: 640px) {
		.document-tools { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: 'type sort' 'search search'; gap: 16px 12px; }
		.read-label, .close-label, .document-row[open] .close-label { display: none; }
		summary { gap: 12px; }
	}
	@container documents (max-width: 420px) {
		.document-tools { grid-template-columns: minmax(0, 1fr) 144px; grid-template-areas: 'type type' 'search sort'; }
		.documents-header, .document-tools { padding: 20px 16px; }
		.refresh-button { width: 100%; }
		.list-caption { padding: 12px 16px; }
		summary { padding: 20px 16px; }
		.document-content { padding: 0 16px 20px; }
		.documents-footer, .document-warning { padding: 16px; }
		.document-empty { padding: 24px 16px; }
		.source-caption { display: none; }
		.row-metadata { gap: 8px; }
	}
	@container documents (max-width: 340px) { .document-tools { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'type' 'search' 'sort'; } }
	@media (prefers-reduced-motion: reduce) { .row-action svg, summary, .refresh-button { transition: none; } }
</style>
