<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { canWrite } from '$lib/auth';
	import { trackView } from '$lib/viewMemory.svelte';
	import CompanyPicker from '$lib/components/CompanyPicker.svelte';
	import TrackerCompanyRow from '$lib/valuation/components/TrackerCompanyRow.svelte';
	import TrackerPreview from '$lib/valuation/components/TrackerPreview.svelte';
	import { latestGuidance, statuses, type Guidance, type TrackerCompany, type TrackerModel } from '$lib/valuation/masterTracker';
	import type { SymbolHit } from '$lib/valuation/symbolSearch';
	import type { PageData } from './$types';
	import { readTrackerResponse, type TrackerStep } from '$lib/valuation/trackerProgress';
	let { data }: { data: PageData } = $props();
	let query=$state(''),status=$state<'all'|Guidance['status']>('all'),period=$state(''),expanded=$state(''),selections=$state('');
	const memory=trackView({view:'masterTracker',userId:()=>data.user?.id,read:()=>({query,status,period,expanded,selections}),apply:(s)=>{query=s.query;status=s.status;period=s.period;expanded=s.expanded;selections=s.selections;}});
	query=memory.initial.query;status=memory.initial.status;period=memory.initial.period;expanded=memory.initial.expanded;selections=memory.initial.selections;
	let adding=$state(false),chosen=$state<SymbolHit|null>(null),bseCode=$state(''),sector=$state(''),subsector=$state('');
	let identityLoading=$state(false),identityWarning=$state('');
	let identityRequest=0;
	async function chooseCompany(hit:SymbolHit) {
		const request=++identityRequest;
		chosen=hit;bseCode=hit.bseCode??(/^\d{6}$/.test(hit.symbol)?hit.symbol:'');sector=hit.sector??'';subsector=hit.subsector??'';identityWarning='';identityLoading=true;
		try {
			const response=await fetch(`/api/valuation/master-tracker/identity?${new URLSearchParams({symbol:hit.symbol,name:hit.name})}`);
			if(!response.ok)throw new Error('Identifier lookup unavailable. The selected exchange symbol is still usable.');
			const identity=await response.json();
			if(request!==identityRequest)return;
			bseCode=identity.bseCode??bseCode;sector=identity.sector??sector;subsector=identity.subsector??subsector;identityWarning=identity.warning??'';
		} catch(e) { if(request===identityRequest)identityWarning=e instanceof Error?e.message:'Identifier lookup unavailable.'; }
		finally { if(request===identityRequest)identityLoading=false; }
	}
	let busy=$state(''),message=$state(''),failure=$state('');
	let progress=$state<{symbol:string;step:TrackerStep;status:'running'|'ready'|'error'}|null>(null);
	const writable=$derived(canWrite(data.user?.role));
	const periods=$derived([...new Map(data.companies.flatMap((c)=>c.quarters).map((q)=>[q.id,q])).values()].sort((a,b)=>b.id.localeCompare(a.id)));
	const visible=$derived(data.companies.filter((c)=>`${c.name} ${c.symbol} ${c.sector} ${c.subsector}`.toLowerCase().includes(query.toLowerCase()) && (status==='all'||latestGuidance(c).some((g)=>g.status===status)) && (!period||c.quarters.some((q)=>q.id===period))));
	function selectionMap():Record<string,string[]> { try { const o=JSON.parse(selections);return o && typeof o==='object' && !Array.isArray(o) ? o : {}; } catch { return {}; } }
	function selected(c:TrackerCompany) { const values=selectionMap()[c.symbol];return Array.isArray(values) ? values.filter((q)=>c.quarters.some((p)=>p.id===q)) : c.quarters.length ? [c.quarters[c.quarters.length-1].id] : []; }
	function setSelected(symbol:string,values:string[]) { selections=JSON.stringify({...selectionMap(),[symbol]:values}); }
	async function call(symbol:string,body:Record<string,unknown>) {
		busy=symbol||'create';failure='';message='';
		if(body.action==='analyse')progress={symbol,step:'financials',status:'running'};
		try {
			const response=await fetch(`/api/valuation/master-tracker${symbol ? `/${encodeURIComponent(symbol)}` : ''}`,{method:'POST',headers:{'Content-Type':'application/json',...(body.action==='analyse'?{Accept:'application/x-ndjson'}:{})},body:JSON.stringify(body)});
			const result=await readTrackerResponse(response,(step)=>{progress={symbol,step,status:'running'};});
			if(!response.ok) throw new Error(typeof result.message==='string' ? result.message : 'The action could not be completed.');
			if(body.action==='analyse'&&progress)progress.status='ready';
			await invalidateAll();
			message=body.action==='analyse' ? 'Draft ready. Review its sources and choose what to save.' : body.action==='accept' ? body.valuation ? 'Selected analysis saved and valuation added to the watchlist.' : 'Selected guidance saved.' : body.action==='edit' ? 'Manual revision saved; original retained.' : body.action==='reject' ? 'Draft discarded.' : 'Tracker updated.';
			return result;
		} catch(e) { failure=e instanceof Error ? e.message : 'Request failed. Please retry.';if(body.action==='analyse'&&progress)progress.status='error';return null; } finally { busy=''; }
	}
	async function add() {
		if(!chosen)return;
		const result=await call('',{symbol:chosen.symbol,name:chosen.name,bseCode:bseCode||null,sector,subsector});
		if(result){adding=false;chosen=null;bseCode='';sector='';subsector='';message=typeof result.identityWarning==='string' ? result.identityWarning : 'Company added with its detected exchange identifiers. Load its reported quarters to start analysis.';}
	}
	function analyse(c:TrackerCompany,valuation:boolean,method:string,refresh:boolean) { return call(c.symbol,{action:'analyse',quarters:selected(c),valuation,method,refresh}); }
</script>
<svelte:head><title>Master Tracker · ThesisTrack</title></svelte:head>
<div class="band"><div class="band-inner"><h1>Master Tracker</h1><p class="sub">Track what management promised, what changed, and what was delivered.</p></div></div>
<div class="wrap wrap-wide tracker">
	{#if data.configuration.mock}<p class="notice" role="status">Mock testing mode — fictional research and valuations. Company search is limited to Supreme Power and Quality Power. Use the normal app to search other companies.</p>{:else if !data.configuration.ready}<p class="notice">Live analysis needs server configuration: {data.configuration.missing.join(', ')}. Companies can be added now; no sample data will be substituted.</p>{/if}
	<div class="toolbar"><label>Filter tracked companies<input aria-label="Search tracker" type="search" bind:value={query} placeholder="Company, sector or subsector already in this tracker"/></label><label>Execution status<select aria-label="Filter execution status" bind:value={status}><option value="all">All statuses</option>{#each statuses as s}<option>{s}</option>{/each}</select></label><label>Reported period<select aria-label="Filter reported period" bind:value={period}><option value="">All periods</option>{#each periods as p}<option value={p.id}>{p.label}</option>{/each}</select></label><button onclick={memory.reset}>Reset this view</button>{#if writable}<button class="primary" onclick={()=>adding=!adding} aria-expanded={adding}>Add company</button>{/if}</div>
	{#if adding && writable}<form class="add-panel" aria-label="Add tracker company" onsubmit={(e)=>{e.preventDefault();void add();}}><h2>Add a company to the tracker</h2><CompanyPicker id="tracker-company" label="Choose tracker company" placeholder="Search all listed companies by name or ticker" onPick={(hit)=>void chooseCompany(hit)}/>{#if chosen}<p>Selected: <strong>{chosen.name}</strong> ({chosen.symbol})</p>{/if}{#if identityLoading}<p role="status">Looking up exchange identifiers?</p>{/if}{#if identityWarning}<p class="notice">{identityWarning}</p>{/if}<div class="fields"><label>BSE code (automatically detected)<input aria-label="New company BSE code" readonly value={bseCode} pattern={'[0-9]{6}'} maxlength="6" placeholder="No BSE listing returned"/></label><label>Sector<input bind:value={sector} maxlength="100"/></label><label>Subsector<input bind:value={subsector} maxlength="100"/></label></div><p class="muted">Adding a tracker company does not automatically create a valuation.</p><button class="primary" disabled={!chosen||!!busy||identityLoading} type="submit">Create tracker company</button><button type="button" onclick={()=>adding=false}>Cancel</button></form>{/if}
	{#if failure}<p class="error" role="alert">{failure}</p>{/if}{#if message}<p class="success" role="status">{message}</p>{/if}
	<p class="muted">{visible.length} of {data.companies.length} companies · Counts show the latest state of each guidance thread.</p>
	{#if !data.companies.length}<div class="empty"><h2>No companies in your tracker yet</h2><p>Add a company explicitly, choose its reported quarters, then review and save the analysis.</p></div>{:else if !visible.length}<p>No tracked companies match these filters. Use Add company to find another listed company.</p>{/if}
	{#each visible as company (company.symbol)}
		<TrackerCompanyRow {company} {writable} busy={busy===company.symbol} progress={progress?.symbol===company.symbol ? progress : undefined} selected={selected(company)} expanded={expanded===company.symbol} onModelEdit={()=>void call(company.symbol,{action:'edit-model',baseVersion:company.version})} onSelect={(q)=>setSelected(company.symbol,q)} onExpand={()=>expanded=expanded===company.symbol ? '' : company.symbol} onPeriods={()=>void call(company.symbol,{action:'quarters',refresh:true})} onAnalyse={(v,m,r)=>void analyse(company,v,m,r)} onIdentity={(code)=>void call(company.symbol,{action:'identity',baseVersion:company.version,bseCode:code})} onEdit={(g,changes)=>void call(company.symbol,{action:'edit',baseVersion:company.version,itemId:g.id,...changes})}/>
		{@const preview=data.previews.find((p)=>p.symbol===company.symbol)}
		{#if preview && writable}{#key preview.id}<TrackerPreview {preview} {company} busy={busy===company.symbol} onSave={(ids,v,edited,model)=>void call(company.symbol,{action:'accept',previewId:preview.id,accepted:ids,valuation:v,edited,editedModel:model,acknowledgeManual:true})} onReject={()=>void call(company.symbol,{action:'reject',previewId:preview.id})} onRegenerate={()=>void call(company.symbol,{action:'analyse',quarters:preview.quarters,valuation:preview.valuationRequested ?? !!preview.analysis.valuation,method:preview.requestedMethod ?? preview.analysis.valuation?.method ?? 'auto',refresh:false})}/>{/key}{/if}
	{/each}
</div>
<style>.tracker{padding-top:20px;max-width:1500px}.toolbar,.fields{display:flex;flex-wrap:wrap;gap:12px;align-items:end}.toolbar>label:first-child{flex:1;min-width:220px}label{display:grid;gap:6px;font-size:12px}input,select{padding:10px;border:1px solid var(--rule);background:var(--bg);font:inherit;color:var(--ink);min-width:0}button{padding:10px 13px;border:1px solid var(--rule);background:var(--bg);font:inherit;font-size:13px;cursor:pointer}.primary{background:var(--accent);color:white}button:disabled{opacity:.5;cursor:default}.notice{background:var(--warn-soft);color:var(--warn);padding:14px;border:1px solid var(--rule);font-size:13px;overflow-wrap:anywhere}.muted{font-size:12px;color:var(--muted)}.add-panel,.empty{padding:20px;border:1px solid var(--rule);margin-top:20px;background:var(--surface)}h2{font-size:18px;margin:0 0 16px}.fields{margin:12px 0}.fields label{flex:1;min-width:200px}.add-panel button{margin-right:8px}.error,.success{padding:12px;border:1px solid var(--rule);font-size:13px}.error{color:var(--danger);background:var(--danger-soft)}.success{color:var(--good);background:var(--good-soft)}@media(max-width:600px){.toolbar>label{flex:1;min-width:140px}.toolbar>label:first-child{flex-basis:100%}.toolbar>button{flex:1}.tracker{padding-left:12px;padding-right:12px}}</style>
