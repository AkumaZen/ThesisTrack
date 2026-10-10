<script lang="ts">
	import { untrack } from 'svelte';
	import type { Guidance, Preview, TrackerCompany, TrackerModel } from '../masterTracker';
	import { modelSchema, guidanceSchema, statuses, projectedLabels } from '../masterTracker';
	import TrackerSources from './TrackerSources.svelte';
	import TrackerValuation from './TrackerValuation.svelte';
	let { preview, company, busy, onSave, onReject, onRegenerate }: { preview: Preview; company: TrackerCompany; busy: boolean; onSave: (ids: string[], valuation: boolean, edited: Guidance[], model?: TrackerModel) => void; onReject: () => void; onRegenerate: () => void } = $props();
	let accepted = $state(untrack(()=>preview.analysis.guidance.map((g)=>g.id)));
	let takeValuation = $state(untrack(()=>!!preview.analysis.valuation));
	let acknowledged = $state(false);
	let edits = $state<Record<string, Guidance>>({});
	let modelEdit = $state<TrackerModel | null>(null);
	let editError = $state('');
	const historicalMismatch = $derived(modelEdit?.history.some((y)=>Math.abs(y.pbt-y.tax-y.netProfit)>1) ?? false);
	const historicalFields = [
		{key:'sales',label:'Sales'}, {key:'expenses',label:'Expenses'}, {key:'otherIncome',label:'Other income'},
		{key:'interest',label:'Interest'}, {key:'depreciation',label:'Depreciation'}, {key:'pbt',label:'Profit before tax'},
		{key:'tax',label:'Tax amount'}, {key:'netProfit',label:'Net profit'}, {key:'ownersPAT',label:'PAT attributable to owners'}, {key:'eps',label:'EPS'}
	] as const;
	const assumptionFields = [
		{key:'revenueGrowthPct',label:'Revenue growth %'}, {key:'expensePct',label:'Expenses / sales %'},
		{key:'targetMultiple',label:'Valuation multiple ×'}, {key:'shares',label:'Shares outstanding (Cr)'},
		{key:'otherIncome',label:'Other income (₹ Cr)'}, {key:'interest',label:'Interest (₹ Cr)'},
		{key:'depreciation',label:'Depreciation (₹ Cr)'}, {key:'taxPct',label:'Tax %'},
		{key:'netDebt',label:'Net debt (₹ Cr)'}, {key:'dividendPayoutPct',label:'Dividend payout %'},
		{key:'minorityPAT',label:'Minority PAT (₹ Cr)'}, {key:'equityRaised',label:'New equity capital (₹ Cr)'}
	] as const;
	function editGuidance(g:Guidance,key:'commitment'|'targetPeriod'|'status'|'actual'|'explanation',value:string) { edits={...edits,[g.id]:{...(edits[g.id]??g),[key]:value}}; }
	const touchesManual = $derived(preview.analysis.guidance.some((g)=>accepted.includes(g.id) && company.guidance.find((old)=>old.id===g.previousId)?.manual) || (takeValuation && company.valuation?.manual));
	function save() {
		try {
			const edited = accepted.filter((id)=>edits[id]).map((id)=>guidanceSchema.parse(edits[id]));
			const model = modelEdit && takeValuation ? modelSchema.parse(modelEdit) : undefined;
			onSave(accepted,takeValuation,edited,model); editError='';
		} catch { editError='Complete all edited fields with valid numbers and text before saving. Share counts and multiples must be positive.'; }
	}
</script>
<section class="preview" aria-label={`Review analysis for ${company.name}`}>
	<h3>Review analysis before saving</h3><p>{preview.analysis.summary}</p>
	{#each preview.analysis.warnings as warning}<p class="warning">{warning}</p>{/each}
	{#if preview.baseVersion!==company.version}<p role="alert">This company has changed since this draft. Regenerate before saving.</p>{/if}
	{#each preview.analysis.guidance as g}
		<article class="draft">
			<label class="choice"><input type="checkbox" value={g.id} bind:group={accepted}/><strong>{g.metric}: {g.commitment}</strong></label>
			<p>{company.quarters.find((q)=>q.id===g.quarter)?.label ?? g.quarter} · {g.targetPeriod} · {g.status}</p>
			{#if g.previousId}<p class="warning">Updates earlier guidance{company.guidance.find((old)=>old.id===g.previousId)?.manual ? ' that you manually edited' : ''}. The original will be retained.</p>{/if}
			{#if g.actual}<p><strong>Reported actual:</strong> {g.actual}</p>{/if}<p>{g.explanation}</p>
			<TrackerSources sources={g.sources}/>
			<details><summary>Edit this proposed item</summary><div class="edit-fields">
				<label>Proposed commitment<textarea aria-label={`Edit ${g.metric} commitment`} value={edits[g.id]?.commitment??g.commitment} oninput={(e)=>editGuidance(g,'commitment',e.currentTarget.value)} rows="2" maxlength="2000"></textarea></label>
				<label>Target period<input value={edits[g.id]?.targetPeriod??g.targetPeriod} oninput={(e)=>editGuidance(g,'targetPeriod',e.currentTarget.value)} maxlength="100"/></label>
				<label>Proposed status<select value={edits[g.id]?.status??g.status} onchange={(e)=>editGuidance(g,'status',e.currentTarget.value)}>{#each statuses as s}<option>{s}</option>{/each}</select></label>
				<label>Reported actual<textarea value={edits[g.id]?.actual??g.actual} oninput={(e)=>editGuidance(g,'actual',e.currentTarget.value)} rows="2" maxlength="2000"></textarea></label>
				<label>Proposed reasoning<textarea value={edits[g.id]?.explanation??g.explanation} oninput={(e)=>editGuidance(g,'explanation',e.currentTarget.value)} rows="3" maxlength="3000"></textarea></label>
			</div><p>Edited items will be marked as manual. Their original source references and history links remain attached.</p></details>
		</article>
	{/each}
	{#if preview.analysis.valuation}
		<label class="choice"><input type="checkbox" bind:checked={takeValuation}/>Accept this valuation model</label><p>Saving this valuation also adds it to the watchlist using the selected method. Other saved methods are retained.</p>
		<TrackerValuation model={modelEdit ?? preview.analysis.valuation}/>
		<details ontoggle={(e)=>{if(e.currentTarget.open&&!modelEdit)modelEdit=structuredClone($state.snapshot(preview.analysis.valuation));}}><summary>Edit scenario assumptions</summary>
			{#if modelEdit}{@const labels=projectedLabels(modelEdit)}
				<h4>Market and historical figures</h4><p>Correct questionable numbers here. Historical tax is an amount in ₹ Cr, not a percentage. Source references stay attached; saved changes are marked as manual.</p><p role="status" class:warning={historicalMismatch}>{historicalMismatch ? 'Review needed: historical PBT minus tax does not match net profit. You can still save this model for manual review.' : 'Current historical PBT, tax and net profit reconcile.'}</p>
				<div class="numbers"><label>CMP (₹)<input type="number" step="any" aria-label="Edit valuation CMP" bind:value={modelEdit.cmp}/></label><label>Shares outstanding (Cr)<input type="number" step="any" aria-label="Edit valuation shares" bind:value={modelEdit.shares}/></label><label>Book value per share (₹)<input type="number" step="any" aria-label="Edit valuation book value" bind:value={modelEdit.bookValuePerShare}/></label></div>
				<div class="model-years">{#each modelEdit.history as year,i}<fieldset><legend>{year.label}</legend><div class="numbers">{#each historicalFields as f}<label>{f.label}<input type="number" step="any" aria-label={`Edit ${year.label} ${f.label}`} value={year[f.key]} oninput={(e)=>{if(modelEdit)modelEdit.history[i][f.key]=e.currentTarget.valueAsNumber;}}/></label>{/each}</div></fieldset>{/each}</div>
				{#each ['bear','base','bull'] as raw}{@const s=raw as 'bear'|'base'|'bull'}<h4>{s[0].toUpperCase()+s.slice(1)} assumptions</h4><div class="model-years">{#each modelEdit.scenarios[s] as year,i}<fieldset><legend>{labels[i].label}</legend><div class="numbers">{#each assumptionFields as f}<label>{f.label}<input type="number" step="any" aria-label={`${s} ${labels[i].label} ${f.label}`} value={year[f.key]} oninput={(e)=>{if(modelEdit)modelEdit.scenarios[s][i][f.key]=e.currentTarget.valueAsNumber;}}/></label>{/each}</div><label>Reasoning<textarea aria-label={`${s} ${labels[i].label} reasoning`} bind:value={year.reasoning} rows="3" maxlength="4000"></textarea></label></fieldset>{/each}</div>{/each}
				<label>Diagnosis and method reasoning<textarea aria-label="Valuation diagnosis" bind:value={modelEdit.diagnosis} rows="3" maxlength="5000"></textarea></label>
				<p>Tables update as you edit. Saved corrections and reasoning are marked as manual, and the original model is retained in valuation history. Source references cannot be changed.</p>
			{/if}
		</details>
	{:else}<p class="warning">{preview.valuationRequested ? 'Valuation could not be created. Review the reasons above, then retry Create valuation. No valuation has been saved to the watchlist.' : 'Valuation was not requested. Use Create valuation to build scenarios.'} Guidance can be saved independently.</p>{/if}
	{#if touchesManual}<label class="choice warning"><input type="checkbox" bind:checked={acknowledged}/>I reviewed the proposed changes to manually edited work.</label>{/if}
	{#if editError}<p role="alert">{editError}</p>{/if}
	<div class="actions"><button class="primary" disabled={busy || (!accepted.length && !takeValuation) || (!!touchesManual && !acknowledged) || preview.baseVersion!==company.version} onclick={save}>Save selected analysis</button>{#if preview.quarters.length}<button disabled={busy} onclick={onRegenerate}>Regenerate draft</button>{/if}<button disabled={busy} onclick={onReject}>Discard draft</button></div>
</section>
<style>.edit-fields{display:grid;gap:10px}.edit-fields label,fieldset label{display:grid;gap:6px;font-size:12px}.model-years{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.numbers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}fieldset{min-width:0;border:1px solid var(--rule);padding:12px}input:not([type=checkbox]),select{padding:8px;border:1px solid var(--rule);font:inherit;max-width:100%;min-width:0}input[type=number]{width:100%;box-sizing:border-box}@media(max-width:800px){.model-years{grid-template-columns:minmax(0,1fr)}}.preview{padding:20px;margin-top:18px;border:2px solid var(--accent);background:var(--bg)}h3{font-size:18px;margin:0 0 10px}.draft{border:1px solid var(--rule);padding:14px;margin:14px 0}.choice{display:flex;gap:8px;align-items:flex-start;font-size:13px}.warning{color:var(--warn)}p{font-size:13px;line-height:1.5}details{margin:10px 0}summary{cursor:pointer;color:var(--accent);font-size:13px}textarea{width:100%;max-width:100%;box-sizing:border-box;font-family:var(--font-mono);font-size:12px;border:1px solid var(--rule);padding:10px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}button{border:1px solid var(--rule);background:var(--bg);padding:9px 13px;font:inherit;font-size:13px;cursor:pointer}.primary{background:var(--accent);color:var(--accent-ink,white)}button:disabled{opacity:.5;cursor:default}</style>
