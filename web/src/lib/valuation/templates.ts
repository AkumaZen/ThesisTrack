import {
	METHODS,
	type MethodId,
	type ScenarioAssumptions,
	type ScenarioId
} from './valuationEngine';
import { assumptionsProblem } from './savedValuations';

/** A named starting point for a valuation, shared by the team (server: templatesStore.ts). */
export interface ValuationTemplate {
	id: number;
	name: string;
	assumptions: Record<MethodId, Record<ScenarioId, ScenarioAssumptions>>;
	activeMethod: MethodId;
	createdBy: string;
	updatedBy: string;
	updatedAt: number;
	/** Sector basket keys that start new valuations from this template. */
	basketDefaults: string[];
}

/** Which template a new valuation of a company starts from, and why. */
export interface StartingTemplate {
	template: ValuationTemplate;
	/** e.g. "your default" or "the default for Chip Design & IP". */
	reason: string;
}

export const TEMPLATE_NAME_MAX = 60;

export function templateNameProblem(name: unknown): string | null {
	if (typeof name !== 'string' || !name.trim()) return 'Give the template a name.';
	if (name.trim().length > TEMPLATE_NAME_MAX)
		return `Keep the name under ${TEMPLATE_NAME_MAX} characters.`;
	return null;
}

/** Validates a template body's content; returns a readable problem or null. */
export function templateContentProblem(body: {
	assumptions?: unknown;
	activeMethod?: unknown;
}): string | null {
	if (!METHODS.includes(body.activeMethod as MethodId)) return 'Unknown valuation method.';
	const problem = assumptionsProblem(body.assumptions);
	return problem ? `The assumptions are incomplete (${problem}).` : null;
}
