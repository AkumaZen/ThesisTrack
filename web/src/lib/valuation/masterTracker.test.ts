import { describe, expect, it } from 'vitest';
import { acceptPreview, analysisSchema, annualizedReturn, latestGuidance, scenarioYears, validateAnalysis, type TrackerCompany, type Preview } from './masterTracker';
import { mockAnalysis, mockResearch } from './server/masterTrackerMock';
import { supremePowerSample } from './server/masterTrackerSample';

function fixture() {
	const company:TrackerCompany={symbol:'SUPREMEPWR',name:'Mock company',bseCode:'999001',sector:'Power',subsector:'Equipment',version:1,quarters:[],guidance:[],valuation:null,valuationHistory:[],updatedBy:'Test',updatedAt:1};
	const research=mockResearch(company);company.quarters=research.quarters;
	const analysis=analysisSchema.parse(mockAnalysis(company,research,['2026-03-31'],true,'auto'));
	const preview:Preview={id:crypto.randomUUID(),symbol:company.symbol,userId:1,baseVersion:1,quarters:['2026-03-31'],analysis,createdAt:1};
	return {company,research,analysis,preview};
}
describe('Master Tracker integrity',()=>{
	it('retains the generated model when a user corrects historical numbers',()=>{
		const {company,preview}=fixture();preview.analysis.valuation!.history[0].tax=25;
		const corrected=structuredClone(preview.analysis.valuation!);corrected.history[0].tax=2.75;corrected.manual=true;
		const next=acceptPreview(company,preview,[],true,'Analyst',[],corrected);
		expect(next.valuation!.history[0].tax).toBe(2.75);expect(next.valuation!.manual).toBe(true);
		expect(next.valuationHistory[0].history[0].tax).toBe(25);expect(company.valuation).toBeNull();
	});
	it('only accepts citations that match a supplied source, URL, page and excerpt',()=>{
		const {company,research,analysis}=fixture();expect(()=>validateAnalysis(analysis,research,company,['2026-03-31'],'auto')).not.toThrow();
		for(const change of [{page:999},{excerpt:'Invented management promise'},{url:'https://attacker.example/fake.pdf'}]) {
			const bad=structuredClone(analysis);Object.assign(bad.guidance[0].sources[0],change);
			expect(()=>validateAnalysis(bad,research,company,['2026-03-31'],'auto')).toThrow('unverified source');
		}
	});
	it('rejects an explicit metric override, unknown quarter and execution with no actual',()=>{
		const {company,research,analysis}=fixture();
		expect(()=>validateAnalysis(analysis,research,company,['2026-03-31'],'pe')).toThrow('requested valuation method');
		expect(()=>validateAnalysis(analysis,research,company,['2030-03-31'],'auto')).toThrow('invalid quarter');
		analysis.guidance[0].status='Met';expect(()=>validateAnalysis(analysis,research,company,['2026-03-31'],'auto')).toThrow('reported actual');
	});
	it('requires all scenario inputs rather than filling generic defaults',()=>{
		const {analysis}=fixture();const raw=structuredClone(analysis) as unknown as {valuation:{scenarios:{base:Record<string,unknown>[]}}};
		delete raw.valuation.scenarios.base[0].interest;expect(analysisSchema.safeParse(raw).success).toBe(false);
	});
	it('selectively saves and leaves rejected draft items out',()=>{
		const {company,preview}=fixture();const next=acceptPreview(company,preview,[],true,'Analyst');expect(next.guidance).toHaveLength(0);expect(next.valuation).not.toBeNull();expect(company.valuation).toBeNull();
	});
	it('preserves original and manual commitments when accepted updates arrive',()=>{
		const {company,preview}=fixture();const g=preview.analysis.guidance[0];
		const manual=acceptPreview(company,preview,[g.id],false,'Analyst',[{...g,commitment:'My manual target'}]);
		const research=mockResearch(manual);const analysis=mockAnalysis(manual,research,['2026-06-30'],false,'auto');
		const next=acceptPreview(manual,{...preview,baseVersion:manual.version,analysis},analysis.guidance.map((g)=>g.id),false,'Analyst');
		expect(next.guidance[0].commitment).toBe('My manual target');expect(next.guidance[0].manual).toBe(true);expect(next.guidance[1].previousId).toBe(g.id);expect(latestGuidance(next)).toHaveLength(1);
	});
	it('rejects stale saves and attempts to change source/history links',()=>{
		const {company,preview}=fixture();const g=preview.analysis.guidance[0];
		expect(()=>acceptPreview({...company,version:2},preview,[g.id],false,'Test')).toThrow('company changed');
		expect(()=>acceptPreview(company,preview,[g.id],false,'Test',[{...g,threadId:'another-thread'}])).toThrow('history links');
	});
	it('derives EBITDA and targets using the existing valuation engine',()=>{
		const {analysis}=fixture();const m=analysis.valuation!;const y=scenarioYears(m,'base')[0];
		expect(y.sales).toBeCloseTo(156);expect(y.ebitda).toBeCloseTo(23.4);expect(y.netProfit).toBeCloseTo(14.55);expect(y.impliedPrice).toBeCloseTo((23.4*12-20)/2);
	});
	it('uses owners PAT and projected shares for EPS, with a pre-dilution comparison',()=>{
		const {analysis}=fixture();const m=analysis.valuation!;m.method='pe';m.scenarios.base[0].shares=4;m.scenarios.base[0].minorityPAT=2;
		const after=scenarioYears(m,'base')[0];const before=scenarioYears(m,'base',true)[0];
		expect(after.eps).toBeCloseTo((14.55-2)/4);expect(before.eps).toBeCloseTo((14.55-2)/2);expect(after.impliedPrice).toBeCloseTo(after.eps*12);
	});
	it('calculates CAGR from actual price and target dates, and does not turn invalid returns into 0%',()=>{
		expect(annualizedReturn(121,100,'2028-10-05','2026-10-05')).toBeCloseTo(10,1);
		expect(annualizedReturn(-1,100,'2028-10-05','2026-10-05')).toBeNull();expect(annualizedReturn(100,100,'2025-03-31','2026-10-05')).toBeNull();
	});
	it('includes equity capital when calculating post-dilution book value',()=>{
		const {analysis}=fixture();const m=analysis.valuation!;m.method='pb';m.scenarios.base[0].shares=4;m.scenarios.base[0].equityRaised=100;
		const y=scenarioYears(m,'base')[0];expect(y.bookValuePerShare).toBeCloseTo((50+100+14.55)/4);expect(y.impliedPrice).toBeCloseTo(y.bookValuePerShare*12);
	});
	it('keeps newer-quarter execution current when an older quarter is reanalysed',()=>{
		const {company,preview}=fixture();const old=preview.analysis.guidance[0];
		company.guidance=[{...old,id:'newer',quarter:'2026-06-30',status:'Revised'},old];expect(latestGuidance(company)[0].id).toBe('newer');
	});
	it('relinks selectively accepted multi-quarter updates past rejected draft items',()=>{
		const {company,research,preview}=fixture();preview.analysis=mockAnalysis(company,research,['2026-03-31','2026-06-30'],false,'auto');
		validateAnalysis(preview.analysis,research,company,['2026-03-31','2026-06-30'],'auto');const second=preview.analysis.guidance[1];
		const next=acceptPreview(company,preview,[second.id],false,'Test');expect(next.guidance).toHaveLength(1);expect(next.guidance[0].previousId).toBeNull();
	});
	it('provides six sourced fictional triggers with linked quarter updates',()=>{
		const {company}=fixture();const analysis=supremePowerSample(company);expect(analysis.guidance).toHaveLength(48);
		const next=acceptPreview(company,{id:crypto.randomUUID(),symbol:company.symbol,userId:1,baseVersion:1,quarters:['2026-03-31','2026-06-30'],analysis,createdAt:1},analysis.guidance.map(g=>g.id),true,'Test');
		expect(latestGuidance(next).map(g=>g.status).sort()).toEqual(['Beat','Met','Miss','Pending','Pending','Revised']);expect(supremePowerSample(next).guidance).toHaveLength(0);
	});
	it('does not replace existing guidance or valuation when adding the local sample',()=>{
		const {company,preview}=fixture();company.guidance=[{...preview.analysis.guidance[0],manual:true}];company.valuation={...preview.analysis.valuation!,manual:true};
		const analysis=supremePowerSample(company);expect(analysis.valuation).toBeNull();expect(analysis.guidance.some(g=>g.metric==='Revenue growth')).toBe(false);
	});
});
