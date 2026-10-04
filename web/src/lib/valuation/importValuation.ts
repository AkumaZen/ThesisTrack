import {
	METHODS,
	SCENARIOS,
	freshScenario,
	freshAllAssumptions,
	type MethodId,
	type ScenarioId,
	type ScenarioAssumptions,
	type YearAssumptions
} from './valuationEngine';
import type { SavedValuationRecord } from './savedValuations';

const METHOD_SET = new Set<string>(METHODS);
const SCENARIO_SET = new Set<string>(SCENARIOS);

/**
 * One scenario's assumptions in import JSON. Either flat fields (applied to all 3 projected
 * years — the common case for a hand- or LLM-written payload) or a `years` array of per-year
 * partial overrides (for a ramping growth profile), or both — `years[i]` wins over the flat
 * fields for whatever it specifies. Anything left unspecified falls back to this app's own
 * default assumptions (see `freshScenario`), so a minimal payload still produces a complete,
 * valid scenario instead of a crash or a silently-zeroed model.
 */
export interface ImportScenarioInput extends Partial<YearAssumptions> {
	years?: Partial<YearAssumptions>[];
}

export interface ImportCompanyInput {
	symbol: string;
	name?: string;
	shares?: number;
	methods: Partial<Record<MethodId, Partial<Record<ScenarioId, ImportScenarioInput>>>>;
}

export interface ImportOutcome {
	symbol: string;
	ok: boolean;
	message: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parses raw pasted/uploaded JSON into normalized candidates, accepting either a single
 *  company object or an array of them. */
export function parseImportPayload(raw: string): { candidates: unknown[] } | { error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return { error: e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON.' };
	}
	const candidates = Array.isArray(parsed) ? parsed : [parsed];
	if (candidates.length === 0) return { error: 'No entries found in the JSON.' };
	return { candidates };
}

/** Validates one candidate entry. Every failure is scoped to that entry so one bad symbol in
 *  a batch doesn't block the rest — the caller reports per-entry outcomes. */
export function validateCandidate(c: unknown): { input: ImportCompanyInput } | { error: string } {
	if (!isPlainObject(c)) return { error: 'Entry is not a JSON object.' };

	const symbolRaw = c.symbol;
	if (typeof symbolRaw !== 'string' || !symbolRaw.trim()) {
		return { error: 'Missing or invalid "symbol" field (expected a string).' };
	}
	const symbol = symbolRaw.trim().toUpperCase();

	const methodsRaw = c.methods;
	if (!isPlainObject(methodsRaw)) {
		return { error: `${symbol}: missing "methods" object.` };
	}

	const methods: ImportCompanyInput['methods'] = {};
	let anyScenario = false;
	for (const [methodKey, scenariosRaw] of Object.entries(methodsRaw)) {
		if (!METHOD_SET.has(methodKey)) {
			return {
				error: `${symbol}: unknown method "${methodKey}" (expected one of ${METHODS.join(', ')}).`
			};
		}
		if (!isPlainObject(scenariosRaw)) {
			return { error: `${symbol}: method "${methodKey}" must be an object keyed by scenario.` };
		}
		const scenarios: Partial<Record<ScenarioId, ImportScenarioInput>> = {};
		for (const [scenarioKey, scenarioVal] of Object.entries(scenariosRaw)) {
			if (!SCENARIO_SET.has(scenarioKey)) {
				return {
					error: `${symbol}: unknown scenario "${scenarioKey}" (expected bear, base, or bull).`
				};
			}
			if (!isPlainObject(scenarioVal)) {
				return { error: `${symbol}: ${methodKey}.${scenarioKey} must be an object.` };
			}
			scenarios[scenarioKey as ScenarioId] = scenarioVal as ImportScenarioInput;
			anyScenario = true;
		}
		methods[methodKey as MethodId] = scenarios;
	}
	if (!anyScenario) {
		return { error: `${symbol}: no method/scenario entries found under "methods".` };
	}

	const shares = c.shares;
	if (shares != null && typeof shares !== 'number') {
		return { error: `${symbol}: "shares" must be a number if provided.` };
	}
	const name = c.name;
	if (name != null && typeof name !== 'string') {
		return { error: `${symbol}: "name" must be a string if provided.` };
	}

	return {
		input: {
			symbol,
			name: typeof name === 'string' ? name : undefined,
			shares: typeof shares === 'number' ? shares : undefined,
			methods
		}
	};
}

function buildScenario(
	method: MethodId,
	scenario: ScenarioId,
	input: ImportScenarioInput
): ScenarioAssumptions {
	const base = freshScenario(method, scenario);
	const { years: perYearOverrides, ...flatOverrides } = input;

	const years = base.years.map((baseYear, i) => ({
		...baseYear,
		...flatOverrides,
		...(perYearOverrides?.[i] ?? {})
	})) as ScenarioAssumptions['years'];

	return { years };
}

/** Merges an imported company into a full saved-valuation record. Unspecified methods/
 *  scenarios fall back to whatever was already saved for that symbol (so importing just a
 *  PE model doesn't wipe an existing EV/EBITDA one) or, failing that, to the same defaults
 *  the company page itself seeds a fresh model with. */
export function buildImportedRecord(
	existing: SavedValuationRecord | null,
	input: ImportCompanyInput
): SavedValuationRecord {
	const assumptions = existing
		? (structuredClone(existing.assumptions) as SavedValuationRecord['assumptions'])
		: freshAllAssumptions();

	for (const method of METHODS) {
		const scenarios = input.methods[method];
		if (!scenarios) continue;
		for (const scenario of SCENARIOS) {
			const scenarioInput = scenarios[scenario];
			if (!scenarioInput) continue;
			assumptions[method][scenario] = buildScenario(method, scenario, scenarioInput);
		}
	}

	return {
		name: input.name ?? existing?.name ?? input.symbol,
		lastUpdated: Date.now(),
		assumptions,
		shares: input.shares ?? existing?.shares ?? 100
	};
}
