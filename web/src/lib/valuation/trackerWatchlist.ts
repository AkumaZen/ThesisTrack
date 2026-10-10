import { buildImportedRecord } from './importValuation';
import { SCENARIOS, type ScenarioAssumptions } from './valuationEngine';
import type { SavedValuationRecord } from './savedValuations';
import type { TrackerCompany, TrackerModel } from './masterTracker';

/** Use the same method/scenario structure as JSON import; retain other saved methods. */
export function trackerWatchlistRecord(company: TrackerCompany, model: TrackerModel, existing: SavedValuationRecord | null): SavedValuationRecord {
	const scenarios = Object.fromEntries(SCENARIOS.map((s) => [s, { years: model.scenarios[s].map(({ reasoning, sources, ...numbers }) => numbers) }]));
	const record = buildImportedRecord(existing, { symbol: company.symbol, name: company.name, shares: model.shares, methods: { [model.method]: scenarios } });
	for (const s of SCENARIOS) record.assumptions[model.method][s] = { baseSales: model.history[1].sales, baseBookValuePerShare: model.bookValuePerShare, years: model.scenarios[s].map(({ reasoning, sources, ...numbers }) => numbers) as ScenarioAssumptions['years'] };
	return { ...record, activeMethod: model.method, activeScenario: 'base' };
}
