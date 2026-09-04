// Shared helpers ported from app/routers/companies.py's module-level
// functions (_scenario_to_out, _core_metrics_for_scenarios,
// _latest_override_flags, and the batched kill-trigger-evaluation helper
// added by the N+1 perf fix on the Python side).
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { metricDefinitions, statusEvents, thesisVersions, triggerEvaluations } from '../db/schema';

export function scenarioToOut(
	company: { companyId: string; name: string; operatingModel: string; currency: string },
	industryName: string,
	nicheName: string,
	scenario: {
		id: number;
		status: string;
		statusSource: string;
		outcome: string;
		conviction: number | null;
		lastReviewed: string;
		currentVersionId: number | null;
	} | null,
	scenarioCount: number,
	hasActiveOverride = false,
	coreMetrics: Record<string, number> | null = null
) {
	return {
		company_id: company.companyId,
		name: company.name,
		broad_industry: industryName,
		specific_niche: nicheName,
		operating_model: company.operatingModel,
		currency: company.currency,
		status: scenario?.status ?? null,
		status_source: scenario?.statusSource ?? null,
		outcome: scenario?.outcome ?? null,
		conviction: scenario?.conviction ?? null,
		last_reviewed: scenario?.lastReviewed ?? null,
		current_version_id: scenario?.currentVersionId ?? null,
		scenario_id: scenario?.id ?? null,
		has_own_scenario: scenario != null,
		scenario_count: scenarioCount,
		has_active_override: hasActiveOverride,
		core_metrics: coreMetrics ?? {}
	};
}

export async function coreMetricsForScenarios(
	scenarios: { id: number; currentVersionId: number | null }[]
): Promise<Record<number, Record<string, number>>> {
	const versionIds = scenarios.map((s) => s.currentVersionId).filter((v): v is number => v != null);
	if (!versionIds.length) return {};

	const versions = await db.select().from(thesisVersions).where(inArray(thesisVersions.versionId, versionIds));
	const versionsById = new Map(versions.map((v) => [v.versionId, v]));

	const coreKeyRows = await db
		.select({ metricKey: metricDefinitions.metricKey })
		.from(metricDefinitions)
		.where(eq(metricDefinitions.isCore, true));
	const coreKeys = new Set(coreKeyRows.map((r) => r.metricKey));

	const result: Record<number, Record<string, number>> = {};
	for (const scenario of scenarios) {
		const version = scenario.currentVersionId != null ? versionsById.get(scenario.currentVersionId) : undefined;
		if (!version) continue;
		const thesisData = version.thesisData as { proof_points?: { model_specific_metrics?: Record<string, number> } };
		const snapshot = thesisData?.proof_points?.model_specific_metrics ?? {};
		const filtered: Record<string, number> = {};
		for (const [k, v] of Object.entries(snapshot)) {
			if (coreKeys.has(k)) filtered[k] = v;
		}
		result[scenario.id] = filtered;
	}
	return result;
}

export async function latestOverrideFlags(scenarioIds: number[]): Promise<Record<number, boolean>> {
	if (!scenarioIds.length) return {};
	const rows = await db
		.selectDistinctOn([statusEvents.scenarioId], {
			scenarioId: statusEvents.scenarioId,
			override: statusEvents.override
		})
		.from(statusEvents)
		.where(inArray(statusEvents.scenarioId, scenarioIds))
		.orderBy(statusEvents.scenarioId, desc(statusEvents.createdAt));
	const out: Record<number, boolean> = {};
	for (const row of rows) out[row.scenarioId] = Boolean(row.override);
	return out;
}

// Batches the per-trigger "latest evaluation" lookup into one query - same
// N+1 fix already applied on the Python side (see ADR history: kill-trigger
// evaluation loop originally issued one query per trigger).
export async function latestTriggerEvaluations(triggerIds: number[]) {
	if (!triggerIds.length) return new Map<number, typeof triggerEvaluations.$inferSelect>();
	const rows = await db
		.selectDistinctOn([triggerEvaluations.triggerId])
		.from(triggerEvaluations)
		.where(inArray(triggerEvaluations.triggerId, triggerIds))
		.orderBy(triggerEvaluations.triggerId, desc(triggerEvaluations.evaluatedAt));
	return new Map(rows.map((r) => [r.triggerId, r]));
}
