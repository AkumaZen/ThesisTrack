import { analysisSchema, validateAnalysis, type TrackerCompany, type Analysis, type Guidance } from '../masterTracker';
import { mockAnalysis, mockResearch, mockQuarters } from './masterTrackerMock';

/** Explicit local demo only: all commitments, actuals and document excerpts are fictional. */
export function supremePowerSample(company: TrackerCompany): Analysis {
	const research = mockResearch(company);
	const quarters = mockQuarters.map((q) => q.id);
	const items = [
		{ metric: 'Revenue growth', before: 'FY27 revenue growth 30%', after: 'FY27 revenue growth 35%', target: 'FY27', status: 'Revised', actual: 'Q1 revenue grew 32% YoY; full-year execution remains pending.' },
		{ metric: 'EBITDA margin', before: 'Maintain EBITDA margin of at least 15%', after: 'Maintain EBITDA margin of at least 15%', target: 'FY27', status: 'Pending', actual: 'Q1 EBITDA margin: 16%. Full-year target is not yet due.' },
		{ metric: 'Capex mobilisation', before: 'Start the ₹40 Cr expansion project by June 2026', after: 'Start the ₹40 Cr expansion project by June 2026', target: 'Q1 FY27', status: 'Met', actual: 'Expansion started in June 2026; ₹10 Cr spent. This meets the start milestone, not the full capex-spending target.' },
		{ metric: 'Capacity growth', before: 'Add 20% capacity and commission by December 2026', after: 'Add 20% capacity and commission by December 2026', target: 'December 2026', status: 'Pending', actual: 'Equipment installation is underway; commissioning remains scheduled for December 2026.' },
		{ metric: 'Utilisation', before: 'Reach 75% utilisation by June 2026', after: 'Reach 75% utilisation by June 2026', target: 'Q1 FY27', status: 'Miss', actual: 'Reported Q1 utilisation: 68%, below the 75% target.' },
		{ metric: 'Order inflow', before: 'Secure ₹30 Cr of transformer orders by June 2026', after: 'Secure ₹30 Cr of transformer orders by June 2026', target: 'Q1 FY27', status: 'Beat', actual: 'Transformer orders of ₹32 Cr secured by June 2026, exceeding the ₹30 Cr target.' }
	] as const;
	const guidance: Guidance[] = [];
	for (const item of items) {
		// Keep existing user work intact when adding the demo to an already populated company.
		if (company.guidance.some((g) => g.metric === item.metric)) continue;
		const threadId = crypto.randomUUID();
		let previousId: string | null = null;
		for (const quarter of quarters) {
			const latest = quarter === quarters.at(-1);
			const source = research.sources.find((s) => s.id === `call-${quarter}`)!;
			const commitment = latest ? item.after : item.before;
			const excerpt = `FICTIONAL DEMO: ${commitment}. ${latest ? item.actual : 'Management commitment recorded; execution will be reviewed in the next quarter.'}`;
			source.pages.push({ page: 4 + guidance.length, text: excerpt });
			const id = crypto.randomUUID();
			guidance.push({ id, threadId, quarter, metric: item.metric, commitment, targetPeriod: item.target,
				status: latest ? item.status : 'Pending', actual: latest ? item.actual : '',
				explanation: 'Fictional mock trigger for interface testing. Compare the original commitment with the next-quarter update; this is not real company guidance.',
				sources: [{ id: source.id, title: `${source.title} — fictional sample`, url: source.url, page: 4 + guidance.length, excerpt }],
				origin: 'AI', manual: false, previousId, recordedAt: Date.now() });
			previousId = id;
		}
	}
	const model = mockAnalysis(company, research, quarters, true, 'auto').valuation;
	const analysis = analysisSchema.parse({ guidance, valuation: company.valuation ? null : model,
		warnings: research.warnings, summary: 'Six fictional growth triggers across eight quarters, covering revised, pending, met, missed and beaten commitments.' });
	validateAnalysis(analysis, research, company, quarters, 'auto');
	return analysis;
}
