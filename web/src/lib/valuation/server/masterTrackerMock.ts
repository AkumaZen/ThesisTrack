import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { Analysis, Research, TrackerCompany, TrackerModel } from '../masterTracker';

// Never enabled in a production build, even if the flag is accidentally deployed.
export function trackerMocksEnabled() { return dev && !env.VERCEL && env.MASTER_TRACKER_TEST_MODE === 'true'; }
export function isTrackerTestRequest(url: URL) { return trackerMocksEnabled() && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); }
export const mockCompanies = [
	{ symbol: 'SUPREMEPWR', name: 'Supreme Power Equipment Ltd', bseCode: '999001', sector: 'Power', subsector: 'Transmission & Distribution' },
	{ symbol: 'QUALITYPWR', name: 'Quality Power Electrical Equipments Ltd', bseCode: '999002', sector: 'Power', subsector: 'Electrical Equipment' }
];
export const mockQuarters = [
	{ id: '2024-09-30', label: 'Q2 FY25' }, { id: '2024-12-31', label: 'Q3 FY25' },
	{ id: '2025-03-31', label: 'Q4 FY25' }, { id: '2025-06-30', label: 'Q1 FY26' }, { id: '2025-09-30', label: 'Q2 FY26' },
	{ id: '2025-12-31', label: 'Q3 FY26' }, { id: '2026-03-31', label: 'Q4 FY26' }, { id: '2026-06-30', label: 'Q1 FY27' }
];
export function mockResearch(company: TrackerCompany): Research {
	return { fetchedAt: Date.now(), quarters: mockQuarters, warnings: ['Mock research: these figures are fictional and are only for testing.'],
		sources: mockQuarters.map((q) => ({ id: `call-${q.id}`, title: `${company.name} ${q.label} mock company call`, url: `https://example.com/mock/${company.symbol}/${q.id}.pdf`,
			pages: [{ page: 2, text: `Management guides FY27 revenue growth of ${q.id === '2026-06-30' ? 35 : 30}%. EBITDA margin guidance is 15%. Planned capex is ₹40 crore. Capacity will increase by 20%. Utilisation is expected to reach 75%. FY27 order inflow target is ₹300 crore. Reported revenue grew ${q.id === '2026-06-30' ? 32 : 20}% year on year. Commissioning is expected in December 2026.` },
				{ page: 3, text: 'FY25 sales 100, expenses 85, other income 1, interest 2, depreciation 3, PBT 11, tax 2.75, net profit 8.25, owners PAT 8.25, EPS 4.125. FY26 sales 120, expenses 102, other income 1, interest 2, depreciation 3, PBT 14, tax 3.5, net profit 10.5, owners PAT 10.5, EPS 5.25. Shares outstanding 2 crore, book value per share 25, CMP 100 on 2026-10-05. Net debt 20 crore. Company disclosed no dilution or minority interest. Working capital remains elevated; cash conversion is weak.' }] })) };
}
export function mockAnalysis(company: TrackerCompany, research: Research, selected: string[], valuation: boolean, method: string): Analysis {
	const working = { ...company, guidance: [...company.guidance] };
	const guidance = [...selected].sort().flatMap((quarter) => {
		const d = research.sources.find((s) => s.id === `call-${quarter}`)!;
		const earlier = [...working.guidance].reverse().find((g) => g.metric === 'Revenue growth' && g.quarter <= quarter);
		const items = [{ id: crypto.randomUUID(), threadId: earlier?.threadId ?? crypto.randomUUID(), quarter,
			metric: 'Revenue growth', commitment: `FY27 revenue growth ${quarter === '2026-06-30' ? '35' : '30'}%`, targetPeriod: 'FY27',
			status: (earlier && quarter === '2026-06-30' ? 'Revised' : 'Pending') as 'Revised' | 'Pending',
			actual: quarter === '2026-06-30' ? 'Reported quarterly revenue growth: 32% YoY; the FY27 target is not yet due.' : '',
			explanation: earlier ? 'Management updated the earlier commitment. Review this change before accepting it.' : 'Explicit annual management target. Quarterly progress does not establish full-year execution.',
			sources: [{ id: d.id, title: d.title, url: d.url, page: 2, excerpt: `Management guides FY27 revenue growth of ${quarter === '2026-06-30' ? 35 : 30}%.` }],
			origin: 'AI' as const, manual: false, previousId: earlier?.id ?? null, recordedAt: Date.now() }];
		working.guidance.push(...items); return items;
	});
	const source = research.sources[0];
	const citation = { id: source.id, title: source.title, url: source.url, page: 3, excerpt: source.pages[1].text };
	const year = (growth: number, multiple: number) => ({ revenueGrowthPct: growth, expensePct: 85, otherIncome: 1, interest: 2, depreciation: 3, taxPct: 25,
		dividendPayoutPct: 0, netDebt: 20, targetMultiple: multiple, shares: 2, minorityPAT: 0, equityRaised: 0,
		reasoning: 'Testing assumption: management-guided growth anchors the base year; interest, depreciation, tax and valuation multiple are model estimates. This is fictional test data.', sources: [citation] });
	const historical = (label: string, endDate: string, sales: number, expenses: number, pbt: number, netProfit: number) => ({ label, endDate, sales, expenses, otherIncome: 1, interest: 2, depreciation: 3, pbt, tax: pbt * .25, netProfit, ownersPAT: netProfit, eps: netProfit / 2, sources: [citation] });
	const model: TrackerModel = { method: method === 'auto' ? 'ev_ebitda' : method as TrackerModel['method'], recommendedMethod: 'ev_ebitda',
		diagnosis: 'The capex programme and weak cash conversion favour EV/EBITDA, with asset turnover and cash-flow checks. The selected method is respected. Mock diagnosis only.',
		cmp: 100, priceDate: '2026-10-05', shares: 2, bookValuePerShare: 25,
		history: [historical('FY25', '2025-03-31', 100, 85, 11, 8.25), historical('FY26', '2026-03-31', 120, 102, 14, 10.5)],
		scenarios: { bear: [year(15, 8), year(12, 8), year(10, 8)], base: [year(30, 12), year(20, 12), year(15, 12)], bull: [year(35, 14), year(25, 14), year(20, 14)] },
		caveats: ['Revenue guidance anchors the base case; later growth, interest, depreciation, tax and multiples are estimated.', 'Shares: 2 crore, no disclosed dilution. No minority interest. Multiples are held flat within each scenario, but differ between bear/base/bull.', 'Mock cash-flow and asset data are incomplete; FCF yield, cash conversion cycle and asset turnover cannot be reliably computed.'], manual: false };
	return { guidance, valuation: valuation ? model : null, warnings: research.warnings, summary: 'Revenue guidance and progress extracted from the selected mock calls. Annual execution remains pending.' };
}
