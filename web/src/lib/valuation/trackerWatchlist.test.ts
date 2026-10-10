import { describe, expect, it } from 'vitest';
import { trackerWatchlistRecord } from './trackerWatchlist';
import { freshAllAssumptions, METHODS, SCENARIOS, project } from './valuationEngine';
import { scenarioYears, type TrackerCompany } from './masterTracker';
import { mockAnalysis, mockResearch } from './server/masterTrackerMock';
import { assumptionsProblem } from './savedValuations';

const company: TrackerCompany = { symbol: 'SUPREMEPWR', name: 'Mock company', bseCode: '999001', sector: '', subsector: '', version: 1, quarters: [], guidance: [], valuation: null, valuationHistory: [], updatedAt: 1, updatedBy: 'Test' };
describe('Accepted tracker valuation in watchlist format', () => {
	it('uses corrected historical sales and book value even when the company feed still has the old figures',()=>{
		const model=mockAnalysis(company,mockResearch(company),['2026-06-30'],true,'pb').valuation!;
		model.history[1].sales=200;model.bookValuePerShare=40;
		const record=trackerWatchlistRecord(company,model,null);
		const years=project('pb',120,25,record.shares,record.assumptions.pb.base);
		const expected=scenarioYears(model,'base');
		expect(years[0].sales).toBe(260);expect(years[1].impliedPrice).toBeCloseTo(expected[1].impliedPrice,8);
	});
	it('preserves other imported methods and explicitly selects the accepted method', () => {
		const model = mockAnalysis(company, mockResearch(company), ['2026-06-30'], true, 'ev_ebitda').valuation!;
		const existing = { name: 'Old', shares: 1, lastUpdated: 1, assumptions: freshAllAssumptions() };
		existing.assumptions.pe.base.years[0].targetMultiple = 65;
		const record = trackerWatchlistRecord(company, model, existing);
		expect(record.activeMethod).toBe('ev_ebitda'); expect(record.activeScenario).toBe('base');
		expect(record.assumptions.pe.base.years[0].targetMultiple).toBe(65);
		expect(record.assumptions.ev_ebitda.base.years[0].revenueGrowthPct).toBe(30);
		expect(assumptionsProblem(record.assumptions)).toBeNull();
	});
	it('matches tracker per-share targets for every method, including dilution and minority PAT', () => {
		for (const method of METHODS) {
			const model = mockAnalysis(company, mockResearch(company), ['2026-06-30'], true, method).valuation!;
			for (const s of SCENARIOS) model.scenarios[s].forEach((y, i) => { y.shares = 2 + i; y.minorityPAT = 1; y.equityRaised = i === 1 ? 10 : 0; });
			const record = trackerWatchlistRecord(company, model, null);
			for (const s of SCENARIOS) {
				const saved = project(method, model.history[1].sales, model.bookValuePerShare, record.shares, record.assumptions[method][s]);
				const tracker = scenarioYears(model, s);
				saved.forEach((y, i) => expect(y.impliedPrice).toBeCloseTo(tracker[i].impliedPrice, 8));
			}
		}
	});
});
