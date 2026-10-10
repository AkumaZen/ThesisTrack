import { beforeEach, describe, expect, it, vi } from 'vitest';
const stub=vi.hoisted(()=>({dev:false,env:{} as Record<string,string>,tools:[] as unknown[],calls:[] as {name:string;arguments:Record<string,unknown>}[]}));
vi.mock('$app/environment',()=>({get dev(){return stub.dev;}}));
vi.mock('$env/dynamic/private',()=>({env:stub.env}));
vi.mock('@modelcontextprotocol/sdk/client/index.js',()=>({Client:class {
	async connect(){} async close(){} async listTools(){return {tools:stub.tools};}
	async callTool(input:{name:string;arguments:Record<string,unknown>}) {stub.calls.push(input);return {structuredContent:{quarters:['Mar 2026','Jun 2026'],data:'Reported structured data'}};}
}}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js',()=>({StreamableHTTPClientTransport:class{}}));
import { analyseResearch, loadResearch, reportedQuarters, trackerConfiguration, overviewBseCode, lookupTrackerIdentity, openaiEvidenceFormat, valuationHistoryIssue, reconcileHistoricalTax, valuationHistoricalPeriods } from './masterTrackerProvider';
import { mockAnalysis, mockResearch } from './masterTrackerMock';
import { isTrackerTestRequest, trackerMocksEnabled } from './masterTrackerMock';
import type { TrackerCompany } from '../masterTracker';
const company:TrackerCompany={symbol:'SUPREMEPWR',name:'Mock name',bseCode:'999001',sector:'',subsector:'',version:1,quarters:[],guidance:[],valuation:null,valuationHistory:[],updatedAt:1,updatedBy:'Test'};
beforeEach(()=>{stub.dev=false;Object.keys(stub.env).forEach((key)=>delete stub.env[key]);stub.calls=[];stub.tools=[];vi.unstubAllGlobals();});
function configured() {Object.assign(stub.env,{SCREENER_MCP_URL:'https://example.com/mcp',CONCALL_SERVICE_URL:'https://example.com/concall',CONCALL_SERVICE_TOKEN:'test-token',ANTHROPIC_API_KEY:'test-key',ANTHROPIC_MODEL:'test-model'});
	stub.tools=['get_company_overview','get_quarterly_results','get_financials','get_document_list'].map((name)=>({name,inputSchema:{properties:{symbol:{type:'string'}},required:['symbol']}}));}
describe('Master Tracker provider boundaries',()=>{
	it('keeps a numerically inconsistent model as a sourced draft with a review warning',async()=>{
		configured();stub.env.OPEN_AI_KEY='private-test-key';
		const research=mockResearch(company),analysis=mockAnalysis(company,research,['2026-06-30'],true,'auto');
		analysis.valuation!.history[0].tax=25;
		const evidence=openaiEvidenceFormat(research),id=Object.entries(evidence.evidence).find(([,s])=>s.page===3)![0];
		const model=analysis.valuation!;
		const wire={...analysis,guidance:[],warnings:[],valuation:{...model,history:model.history.map((y)=>({...y,sources:[id]})),scenarios:Object.fromEntries(Object.entries(model.scenarios).map(([s,years])=>[s,years.map((y)=>({...y,sources:[id]}))]))}};
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',model:'gpt-5.6-luna',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(wire)}]}]}),{status:200})));
		const result=await analyseResearch(company,research,['2026-06-30'],true,'auto');
		expect(result.valuation).not.toBeNull();expect(result.valuation!.history[0].tax).toBe(25);
		expect(result.warnings.some((w)=>w.startsWith('Review needed:'))).toBe(true);
		expect(result.valuation!.caveats.at(-1)).toContain('Generated draft warning');
	});
	it('anchors historical years to annual statements even when quarterly metadata omits the latest March',()=>{
		const research=mockResearch(company),analysis=mockAnalysis(company,research,['2026-06-30'],true,'auto');
		research.quarters=research.quarters.filter((q)=>q.id!=='2026-03-31');
		research.sources.push({id:'screener-get_financials_profit_loss',title:'P&L',url:'https://example.com/pl',pages:[{page:null,text:JSON.stringify({result:{data:{years:['Mar 2023','Mar 2024','Mar 2025','Mar 2026','TTM']}}})}]});
		expect(valuationHistoricalPeriods(research)).toEqual(['2025-03-31','2026-03-31']);
		expect(valuationHistoryIssue(analysis,research)).toBeNull();
		const evidence=openaiEvidenceFormat(research),year=evidence.format.shape.valuation.unwrap().shape.history.element;
		const input={...analysis.valuation!.history[0],sources:[Object.keys(evidence.evidence)[0]]};
		expect(year.safeParse(input).success).toBe(true);expect(year.safeParse({...input,endDate:'2024-03-31'}).success).toBe(false);
	});
	it('explains an unexplained empty valuation and reports validation rather than pretending a model exists',async()=>{
		configured();stub.env.OPEN_AI_KEY='private-test-key';
		const research=mockResearch(company),progress=vi.fn();
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',model:'gpt-5.6-luna',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({guidance:[],valuation:null,warnings:[],summary:'Guidance only.'})}]}]}),{status:200})));
		const result=await analyseResearch(company,research,['2026-06-30'],true,'auto',progress);
		expect(result.valuation).toBeNull();expect(result.warnings[0]).toContain('no model or explanation');
		expect(progress.mock.calls).toEqual([['analysis'],['validation']]);
	});
	it('derives tax amounts from verified rounded PBT and PAT, never from Tax %',()=>{
		const research=mockResearch(company),analysis=mockAnalysis(company,research,['2026-06-30'],true,'auto');
		Object.assign(analysis.valuation!.history[1],{pbt:190,netProfit:138,tax:28});
		research.sources.push({id:'screener-get_financials_profit_loss',title:'P&L',url:'https://example.com/pl',pages:[{page:null,text:JSON.stringify({result:{data:{years:['Mar 2025','Mar 2026','TTM'],rows:[{label:'Profit before tax',values:['142','190','194']},{label:'Tax %',values:['28%','28%','']},{label:'Net Profit +',values:['102','138','141']}]}}})}]});
		reconcileHistoricalTax(analysis,research);
		expect(analysis.valuation!.history[1].tax).toBe(52);expect(valuationHistoryIssue(analysis,research)).toBeNull();
		expect(analysis.valuation!.caveats.at(-1)).toContain('rounded Screener');
		analysis.valuation!.history[1].pbt=200;analysis.valuation!.history[1].tax=28;
		reconcileHistoricalTax(analysis,research);expect(analysis.valuation!.history[1].tax).toBe(28);
		expect(valuationHistoryIssue(analysis,research)).toContain('does not reconcile');
	});
	it('cannot enable fixtures in production or on a public host',()=>{
		stub.env.MASTER_TRACKER_TEST_MODE='true';expect(trackerMocksEnabled()).toBe(false);stub.dev=true;
		expect(isTrackerTestRequest(new URL('https://public.example/valuation/master-tracker'))).toBe(false);
		expect(isTrackerTestRequest(new URL('http://127.0.0.1/valuation/master-tracker'))).toBe(true);
		stub.env.VERCEL='1';expect(trackerMocksEnabled()).toBe(false);
	});
	it('fails explicitly for missing configuration instead of substituting mocks',async()=>{
		expect(trackerConfiguration().ready).toBe(false);await expect(loadResearch(company)).rejects.toThrow('Configure ANTHROPIC_API_KEY');
	});
	it('uses built-in research without requiring separately hosted services',()=>{
		stub.env.OPEN_AI_KEY='private-test-key';expect(trackerConfiguration().ready).toBe(true);
		stub.env.VERCEL='1';expect(trackerConfiguration().missing).toEqual(['CONCALL_SERVICE_TOKEN']);
	});
	it('normalises reported periods without creating future quarters',()=>{
		expect(reportedQuarters({columns:['Mar 2026','Jun 2026','Jun 2026','2030-03-31']})).toEqual([{id:'2026-03-31',label:'Mar 2026'},{id:'2026-06-30',label:'Jun 2026'}]);
	});
	it('extracts only explicit and unambiguous BSE identities',()=>{
		expect(overviewBseCode({bse_code:'500321'})).toBe('500321');expect(overviewBseCode([{text:'Company overview: BSE: 500321'}])).toBe('500321');
		expect(overviewBseCode({bse_code:'500321',peer:{bse_code:'500322'}})).toBeUndefined();expect(overviewBseCode({revenue:500321})).toBeUndefined();
	});
	it('uses MCP structured data and passes selected quarters to the hosted downloader',async()=>{
		configured();const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({documents:[],warnings:['No call found']}),{status:200}));vi.stubGlobal('fetch',fetchMock);
		const research=await loadResearch(company,['2026-03-31'],true);
		expect(stub.calls).toHaveLength(4);expect(stub.calls.every((call)=>call.arguments.symbol===company.symbol)).toBe(true);
		expect(research.sources).toHaveLength(4);expect(research.sources[0].pages[0].page).toBeNull();expect(research.warnings).toContain('No call found');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({bseCode:'999001',quarters:['2026-03-31'],refresh:true});
	});
	it('rejects unsupported required MCP inputs rather than guessing',async()=>{
		configured();stub.tools=[{name:'get_company_overview',inputSchema:{properties:{unknown_id:{type:'string'}},required:['unknown_id']}}];
		await expect(loadResearch(company)).rejects.toThrow('input format is unsupported');
	});
	it('requests every enumerated financial statement type, including balance sheet and cash flow',async()=>{
		configured();stub.tools[2]={name:'get_financials',inputSchema:{properties:{symbol:{type:'string'},statement_type:{type:'string',enum:['profit_loss','balance_sheet','cash_flow']}},required:['symbol','statement_type']}};
		await loadResearch(company);expect(stub.calls.filter((call)=>call.name==='get_financials').map((call)=>call.arguments.statement_type)).toEqual(['profit_loss','balance_sheet','cash_flow']);
	});
	it('requires an identified BSE company and rejects failed document downloads',async()=>{
		configured();await expect(loadResearch({...company,bseCode:null},['2026-03-31'])).rejects.toThrow('verified six-digit BSE code');
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('no',{status:500})));
		await expect(loadResearch(company,['2026-03-31'])).rejects.toThrow('document service returned HTTP 500');
	});
	it('looks up company identity using only the overview tool, without AI credentials',async()=>{
		configured();delete stub.env.ANTHROPIC_API_KEY;delete stub.env.ANTHROPIC_MODEL;delete stub.env.CONCALL_SERVICE_URL;
		expect(await lookupTrackerIdentity(company)).toMatchObject({nseSymbol:'SUPREMEPWR',bseCode:null});
		expect(stub.calls.map((call)=>call.name)).toEqual(['get_company_overview']);
	});
	it('recognises BSE-only selections without needing an additional lookup',async()=>{
		expect(await lookupTrackerIdentity({symbol:'500321',name:'BSE-only company'})).toEqual({symbol:'500321',nseSymbol:null,bseCode:'500321'});expect(stub.calls).toHaveLength(0);
	});
	it('requests all statements when the installed Screener tool does not enumerate statement choices',async()=>{
		configured();stub.tools[2]={name:'get_financials',inputSchema:{properties:{symbol:{type:'string'},statement:{type:'string'},financial_type:{type:'string'}},required:['symbol']}};
		await loadResearch(company);expect(stub.calls.filter((call)=>call.name==='get_financials').map((call)=>call.arguments.statement)).toEqual(['profit_loss','balance_sheet','cash_flow']);
	});
	it('uses the configured private OpenAI key and Luna structured output, without an Anthropic call',async()=>{
		configured();stub.env.OPEN_AI_KEY='private-test-key';delete stub.env.ANTHROPIC_API_KEY;delete stub.env.ANTHROPIC_MODEL;
		expect(trackerConfiguration().ready).toBe(true);
		const research=mockResearch(company),analysis=mockAnalysis(company,research,['2026-06-30'],false,'auto');
		const evidence=openaiEvidenceFormat(research);const id=Object.entries(evidence.evidence).find(([,s])=>s.id==='call-2026-06-30'&&s.page===2)![0];
		const wire={...analysis,guidance:analysis.guidance.map(g=>({...g,sources:[id]}))};
		const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',model:'gpt-5.6-luna',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(wire)}]}]}),{status:200}));vi.stubGlobal('fetch',fetchMock);
		const result=await analyseResearch(company,research,['2026-06-30'],false,'auto');expect(result.guidance).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
		const body=JSON.parse(fetchMock.mock.calls[0][1].body);expect(body.model).toBe('gpt-5.6-luna');expect(body.store).toBe(false);expect(body.text.format).toMatchObject({type:'json_schema',strict:true});
		expect(JSON.stringify(body.text.format.schema)).not.toContain('"format":"uri"');
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer private-test-key');
		expect(result.guidance[0].sources[0]).toEqual(evidence.evidence[id]);
		expect(()=>evidence.decode({...wire,guidance:[{...wire.guidance[0],sources:['invented-id']}]})).toThrow();
	});
	it('does not fall back to another model/provider after an OpenAI failure',async()=>{
		configured();stub.env.OPEN_AI_KEY='private-test-key';const fetchMock=vi.fn().mockResolvedValue(new Response('{}',{status:429}));vi.stubGlobal('fetch',fetchMock);
		await expect(analyseResearch(company,mockResearch(company),['2026-06-30'],false,'auto')).rejects.toThrow('No other model was used');expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it('assigns a fresh record ID when regeneration copies existing guidance and preserves its manual history link',async()=>{
		configured();stub.env.OPEN_AI_KEY='private-test-key';
		const research=mockResearch(company),analysis=mockAnalysis(company,research,['2026-06-30'],false,'auto');
		const old={...analysis.guidance[0],manual:true,origin:'Manual' as const};
		const existing={...company,guidance:[old]};
		const evidence=openaiEvidenceFormat(research);const id=Object.entries(evidence.evidence).find(([,s])=>s.id==='call-2026-06-30'&&s.page===2)![0];
		const wire={...analysis,guidance:[{...analysis.guidance[0],id:old.id,threadId:old.threadId,previousId:null,sources:[id]}]};
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',model:'gpt-5.6-luna',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(wire)}]}]}),{status:200})));
		const result=await analyseResearch(existing,research,['2026-06-30'],false,'auto');
		expect(result.guidance[0].id).not.toBe(old.id);expect(result.guidance[0].previousId).toBe(old.id);
		expect(result.guidance[0].threadId).toBe(old.threadId);expect(existing.guidance[0].manual).toBe(true);
	});
	it('remaps predecessor IDs between new quarter records without breaking their history',async()=>{
		configured();stub.env.OPEN_AI_KEY='private-test-key';
		const selected=['2026-03-31','2026-06-30'],research=mockResearch(company),analysis=mockAnalysis(company,research,selected,false,'auto');
		const evidence=openaiEvidenceFormat(research);
		const wire={...analysis,guidance:analysis.guidance.map(g=>({...g,sources:[Object.entries(evidence.evidence).find(([,s])=>s.id===`call-${g.quarter}`&&s.page===2)![0]]}))};
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',model:'gpt-5.6-luna',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(wire)}]}]}),{status:200})));
		const result=await analyseResearch(company,research,selected,false,'auto');
		expect(result.guidance[0].id).not.toBe(analysis.guidance[0].id);
		expect(result.guidance[1].previousId).toBe(result.guidance[0].id);
		expect(result.guidance[1].threadId).toBe(result.guidance[0].threadId);
	});
	it('identifies document-service authentication errors without exposing its token',async()=>{
		configured();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));
		await expect(loadResearch({...company,bseCode:'999001'},['2026-06-30'])).rejects.toThrow('CONCALL_SERVICE_TOKEN matches on both services');
	});
	it('explains a document timeout and permits a cached retry',async()=>{
		configured();vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new DOMException('Timeout','TimeoutError')));
		await expect(loadResearch({...company,bseCode:'999001'},['2026-06-30'])).rejects.toThrow('downloaded files will be reused');
	});
	it('flags stale years or tax percentages used as amounts for review',()=>{
		const research=mockResearch(company),analysis=mockAnalysis(company,research,['2026-06-30'],true,'auto');
		expect(valuationHistoryIssue(analysis,research)).toBeNull();
		analysis.valuation!.history[1].endDate='2025-03-31';expect(valuationHistoryIssue(analysis,research)).toContain('latest two');
		analysis.valuation!.history[1].endDate='2026-03-31';analysis.valuation!.history[0].tax=25;expect(valuationHistoryIssue(analysis,research)).toContain('Tax must be an amount');
	});
});
