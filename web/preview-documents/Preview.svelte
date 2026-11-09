<script lang="ts">
	import CompanyDocuments from '../src/lib/components/CompanyDocuments.svelte';
	const params = new URLSearchParams(window.location.search);
	let state = $state(params.get('state') ?? 'populated');
	function changeState() { window.location.assign(state === 'populated' ? '/' : `/?state=${state}`); }
</script>

<div class="preview-banner"><span>Local UI preview</span><span>Illustrative filings. No production data or AI calls.</span></div>
<main>
	<header class="preview-header"><div><a href="/">Thesis Tracker</a><p>Company view / Important documents</p></div><label>Preview state<select bind:value={state} onchange={changeState}><option value="populated">With documents</option><option value="empty">No documents</option><option value="pending">Awaiting review</option><option value="warning">Refresh warning</option><option value="error">Load error</option><option value="loading">Loading</option><option value="readonly">Read-only account</option></select></label></header>
	<div class="company-heading"><h1>Company research</h1><p>Review the new documents section below. Try the picklists, search and expandable summaries.</p></div>
	<CompanyDocuments companyId="LOCAL_PREVIEW" canWrite={state !== 'readonly'} />
	<p class="preview-note">This preview uses the same component as the company page. Sample figures and PDF are illustrative, not investment research. Changes remain local until you approve them.</p>
</main>

<style>
	.preview-banner { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px 24px; padding: 12px 32px; border-bottom: 1px solid var(--rule); background: var(--surface); color: var(--muted); font-size: 12px; }
	.preview-banner span:first-child { font-weight: 700; color: var(--ink); }
	main { max-width: 968px; margin: 0 auto; padding: 32px 32px 64px; }
	.preview-header { display: flex; justify-content: space-between; flex-wrap: wrap; align-items: center; gap: 24px; padding-bottom: 28px; border-bottom: 2px solid var(--ink); }
	.preview-header a { font-family: var(--font-display); font-size: 20px; font-weight: 700; }
	.preview-header p { margin-top: 8px; font-size: 12px; color: var(--muted); }
	.preview-header label { display: flex; flex-direction: column; gap: 6px; font-size: 11px; font-weight: 600; }
	select { min-height: 40px; min-width: 180px; padding: 8px 28px 8px 12px; border: 1px solid var(--rule); font-size: 12px; font-weight: 400; }
	.company-heading { margin-top: 32px; }
	h1 { font-size: 24px; font-weight: 600; }
	.company-heading p { max-width: 60ch; margin-top: 10px; color: var(--muted); font-size: 13px; line-height: 1.8; }
	.preview-note { margin-top: 24px; max-width: 76ch; font-size: 12px; line-height: 1.8; color: var(--muted); }
	@media (max-width: 520px) { .preview-banner { padding: 12px 20px; } main { padding: 24px 16px 40px; } .preview-header { gap: 20px; } .preview-header label { width: 100%; } .company-heading { margin-top: 24px; } }
</style>
