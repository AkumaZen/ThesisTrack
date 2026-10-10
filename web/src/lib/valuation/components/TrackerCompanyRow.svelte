<script lang="ts">
	import { untrack } from 'svelte';
	import type { TrackerCompany, Guidance } from '../masterTracker';
	import { annualizedReturn, latestGuidance, projectedLabels, scenarioYears, statuses } from '../masterTracker';
	import { METHOD_MULTIPLE_LABEL } from '../valuationEngine';
	import TrackerSources from './TrackerSources.svelte';
	import TrackerValuation from './TrackerValuation.svelte';
	import TrackerProgress from './TrackerProgress.svelte';
	import type { TrackerStep } from '../trackerProgress';
	let { company, writable, busy, selected, expanded, onSelect, onExpand, onPeriods, onAnalyse, onEdit, onIdentity, onModelEdit, progress }: {
		progress?: { step: TrackerStep; status: 'running' | 'ready' | 'error' };
		company: TrackerCompany; writable: boolean; busy: boolean; selected: string[]; expanded: boolean;
		onSelect: (values:string[])=>void; onExpand: ()=>void; onPeriods: ()=>void;
		onAnalyse: (valuation:boolean,method:string,refresh:boolean)=>void; onEdit: (g:Guidance,changes:{commitment:string;status:Guidance['status'];actual:string;explanation:string})=>void;
		onIdentity:(code:string)=>void;
		onModelEdit:()=>void;
	} = $props();
	let method=$state('auto'), refresh=$state(false), includeValuation=$state(false), editId=$state('');
	let commitment=$state(''),status=$state<Guidance['status']>('Pending'),actual=$state(''),explanation=$state(''),bse=$state(untrack(()=>company.bseCode ?? ''));
	const latest=$derived(latestGuidance(company));
	const count=(s:string)=>latest.filter((g)=>g.status===s).length;
	const labels=$derived(company.valuation ? projectedLabels(company.valuation) : []);
	const base=$derived(company.valuation ? scenarioYears(company.valuation,'base')[1] : null);
	const rate=$derived(company.valuation && base ? annualizedReturn(base.impliedPrice,company.valuation.cmp,labels[1].endDate,company.valuation.priceDate) : null);
	function edit(g:Guidance) { editId=g.id; commitment=g.commitment;status=g.status;actual=g.actual;explanation=g.explanation; }
	function toggle(id:string) { onSelect(selected.includes(id) ? selected.filter((v)=>v!==id) : [...selected,id]); }
</script>
<article class="company" aria-label={company.name}>
	<header><div><h2>{company.name}</h2><p>{company.symbol} · {company.sector || 'Sector not set'} › {company.subsector || 'Subsector not set'}</p></div>
		<div class="counts" aria-label="Guidance execution counts"><strong>Guidance: {latest.length}</strong>{#each statuses as s}<span>{s}: {count(s)}</span>{/each}</div></header>
	<div class="body"><aside aria-label="Base valuation summary">
		{#if company.valuation && base}<h3>Base case {labels[1].label}</h3><p>Stock price CAGR</p><strong class="big">{rate===null ? '—' : `${rate.toFixed(1)}%`}</strong><p>Target price</p><strong>{base.impliedPrice>0 ? `₹${base.impliedPrice.toFixed(2)}` : '—'}</strong><p>{METHOD_MULTIPLE_LABEL[company.valuation.method]}</p><strong>{company.valuation.scenarios.base[1].targetMultiple}×</strong><p class="muted">CMP ₹{company.valuation.cmp} · {company.valuation.priceDate}</p>{:else}<h3>Base scenario</h3><p class="muted">No accepted valuation yet.</p>{/if}
		<p class="muted">Execution: {count('Met')+count('Beat')} achieved · {count('Miss')} missed · {count('Pending')} pending</p>
		{#if company.valuation}<button aria-expanded={expanded} onclick={onExpand}>{expanded ? 'Hide scenarios' : 'View scenarios & reasoning'}</button>{/if}
		{#if company.valuation}<a href="/valuation">View in watchlist</a>{/if}
		{#if company.valuation && writable}<button disabled={busy} onclick={onModelEdit}>Edit valuation</button>{/if}
	</aside><div class="left">
		{#if company.quarters.length}
			<p class="muted">Select one or more reported quarters to analyse.</p>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable region needs focus for native arrow-key scrolling.) -->
			<div class="quarters" role="region" aria-label="Reported quarters" tabindex="0">
				{#each [...company.quarters].reverse() as q}
					{@const items=company.guidance.filter((g)=>g.quarter===q.id)}
					<section class="quarter" aria-label={q.label}><label class="quarter-head"><input type="checkbox" checked={selected.includes(q.id)} disabled={!writable || busy} onchange={()=>toggle(q.id)}/><strong>{q.label}</strong><span>{q.id}</span></label>
						{#if !items.length}<p class="muted">No accepted guidance for this quarter.</p>{/if}
						{#each items as g}<div class="item"><div class="item-head"><strong>{g.metric}</strong><span class:good={g.status==='Met'||g.status==='Beat'} class:bad={g.status==='Miss'} class="badge">{g.status}</span></div><p>{g.commitment}</p><p class="muted">Target: {g.targetPeriod} · {g.origin}{g.manual ? ' · Protected manual edit' : ''}{latest.some((l)=>l.id===g.id) ? '' : ' · Earlier version'}</p>
							{#if g.actual}<p><strong>Actual:</strong> {g.actual}</p>{/if}<details><summary>Reasoning & history</summary><p>{g.explanation}</p>{#if g.previousId}{@const old=company.guidance.find((o)=>o.id===g.previousId)}<p>Earlier commitment: {old?.commitment ?? g.previousId} ({old?.status})</p>{/if}</details><TrackerSources sources={g.sources}/>
							{#if writable && latest.some((l)=>l.id===g.id)}<button class="small" disabled={busy} onclick={()=>edit(g)}>Edit guidance</button>{/if}
							{#if editId===g.id}<form class="editor" onsubmit={(e)=>{e.preventDefault();onEdit(g,{commitment,status,actual,explanation});editId='';}}><label>Commitment<textarea bind:value={commitment} required maxlength="2000"></textarea></label><label>Status<select bind:value={status}>{#each statuses as s}<option>{s}</option>{/each}</select></label><label>Reported actual<textarea bind:value={actual} maxlength="2000" required={['Met','Beat','Miss'].includes(status)}></textarea></label><label>Reasoning<textarea bind:value={explanation} required maxlength="3000"></textarea></label><p class="muted">This creates a manual revision and preserves the original.</p><button type="submit" disabled={busy}>Save manual revision</button><button type="button" onclick={()=>editId=''}>Cancel edit</button></form>{/if}
						</div>{/each}
					</section>
				{/each}
			</div>
		{:else}<p class="muted">Load available quarters to start tracking this company.</p>{/if}
		{#if writable}<div class="controls"><button disabled={busy} onclick={onPeriods}>{company.quarters.length ? 'Refresh available quarters' : 'Load available quarters'}</button>
			{#if company.quarters.length}<label>Valuation method<select aria-label={`Valuation method for ${company.symbol}`} bind:value={method}><option value="auto">Recommend best fit</option><option value="pe">P/E</option><option value="ev_ebitda">EV/EBITDA</option><option value="mcap_sales">P/S</option><option value="pb">P/B</option></select></label><label class="check"><input type="checkbox" bind:checked={includeValuation}/>Include valuation</label><label class="check"><input type="checkbox" bind:checked={refresh}/>Refresh research</label><button class="primary" disabled={busy||!selected.length} onclick={()=>onAnalyse(includeValuation,method,refresh)}>{busy ? 'Working…' : 'Analyse selected quarters'}</button><button disabled={busy||!selected.length} onclick={()=>onAnalyse(true,method,refresh)}>Create valuation</button>{/if}</div>
			{#if progress}<TrackerProgress step={progress.step} status={progress.status}/>{/if}
			<details class="identity"><summary>Company document identifier</summary><form onsubmit={(e)=>{e.preventDefault();onIdentity(bse);}}><label>Verified BSE code<input aria-label={`BSE code for ${company.symbol}`} bind:value={bse} pattern={'[0-9]{6}'} required maxlength="6"/></label><button disabled={busy||bse===company.bseCode}>Save BSE code</button><p class="muted">Required by the document downloader. Financials use the selected Screener symbol.</p></form></details>
		{/if}
	</div></div>
	{#if expanded && company.valuation}<TrackerValuation model={company.valuation}/>{#if company.valuationHistory.length}<details><summary>Earlier valuation versions ({company.valuationHistory.length})</summary>{#each company.valuationHistory as model}<TrackerValuation {model}/>{/each}</details>{/if}{/if}
	<footer>Updated by {company.updatedBy} · {new Date(company.updatedAt).toLocaleDateString('en-IN')}</footer>
</article>
<style>.company{border:1px solid var(--rule);background:var(--bg);padding:20px;margin:18px 0;min-width:0}header{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}h2{font-size:20px;margin:0}h3{font-size:14px;margin:0 0 16px}p{font-size:13px;margin:8px 0;line-height:1.5}.muted,footer{color:var(--muted);font-size:12px}.counts{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;align-items:center}.body{display:grid;grid-template-columns:180px minmax(0,1fr);gap:16px;margin-top:12px}.left{min-width:0}.quarters{display:flex;gap:12px;overflow-x:auto;padding-bottom:10px}.quarter{min-width:260px;flex:1;border:1px solid var(--rule);padding:12px;background:var(--surface)}.quarter-head{display:flex;align-items:center;gap:8px;font-size:13px}.quarter-head span{margin-left:auto;color:var(--muted);font-size:10px}.item{padding:12px 0;border-top:1px solid var(--rule);margin-top:12px}.item-head{display:flex;justify-content:space-between;gap:10px;font-size:12px}.badge{padding:3px 6px;background:var(--warn-soft);color:var(--warn);font-size:11px}.good{color:var(--good);background:var(--good-soft)}.bad{color:var(--danger);background:var(--danger-soft)}aside{padding:16px;border:1px solid var(--rule);align-self:start}.big{font-size:26px;color:var(--accent)}.controls{display:flex;flex-wrap:wrap;align-items:end;gap:10px;margin-top:12px}label{font-size:12px;display:grid;gap:6px}.check{display:flex;align-items:center;padding:10px 0}button{padding:9px 12px;background:var(--bg);border:1px solid var(--rule);font:inherit;font-size:12px;cursor:pointer}.primary{background:var(--accent);color:white}button:disabled{opacity:.5;cursor:default}.small{padding:5px 8px;margin-top:8px}select,input:not([type=checkbox]),textarea{padding:8px;border:1px solid var(--rule);background:var(--bg);font:inherit;max-width:100%}textarea{width:100%;box-sizing:border-box}.editor{display:grid;gap:8px;margin-top:10px}details{margin-top:8px;font-size:12px}summary{cursor:pointer;color:var(--accent)}.identity{margin-top:16px}.identity form{max-width:300px;display:grid;gap:10px}footer{margin-top:16px}@media(max-width:720px){.company{padding:14px}.body{grid-template-columns:minmax(0,1fr)}aside{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.quarter{min-width:250px}.counts{gap:8px}.controls{align-items:stretch}.controls button{flex-grow:1}}</style>
