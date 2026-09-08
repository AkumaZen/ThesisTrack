// Shared helpers ported from app/routers/companies.py's module-level
// functions (_scenario_to_out, _core_metrics_for_scenarios,
// _latest_override_flags, and the batched kill-trigger-evaluation helper
// added by the N+1 perf fix on the Python side).
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { guidanceNotes, killTriggers, metricDefinitions, statusEvents, thesisVersions, triggerEvaluations } from '../db/schema';

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
	coreMetrics: Record<string, number> | null = null,
	// Whether the actor has their own scenario on this company - independent
	// of which scenario `scenario` above actually is. Defaults to "same as
	// scenario" for every caller that only ever passes the actor's own
	// scenario (company create/list/outcome); the company-detail GET is the
	// only caller that can display someone else's scenario, so it's the only
	// one that needs to pass this explicitly.
	hasOwnScenario: boolean | null = null
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
		has_own_scenario: hasOwnScenario ?? scenario != null,
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

export type TrackableOut = {
	id: number;
	label: string;
	severity: string;
	manual_check: boolean;
	metric_key: string | null;
	operator: string | null;
	threshold: number | null;
	latest_fired: boolean | null;
};

// "Trackables" - the kill triggers on a scenario's current thesis version,
// the things that "need to be actively monitored" (the card/Review-tab
// checklist), as opposed to the Review Queue's pending status_proposals
// (things already flagged and awaiting an accept/reject decision). Batched
// the same way coreMetricsForScenarios is, one query per company/dashboard
// page load rather than one per scenario.
export async function trackablesForScenarios(
	scenarios: { id: number; currentVersionId: number | null }[]
): Promise<Record<number, TrackableOut[]>> {
	const versionIds = scenarios.map((s) => s.currentVersionId).filter((v): v is number => v != null);
	if (!versionIds.length) return {};

	const triggers = await db.select().from(killTriggers).where(inArray(killTriggers.versionId, versionIds));
	if (!triggers.length) return {};
	const evalMap = await latestTriggerEvaluations(triggers.map((t) => t.id));
	const byVersion = new Map<number, typeof triggers>();
	for (const t of triggers) {
		(byVersion.get(t.versionId) ?? byVersion.set(t.versionId, []).get(t.versionId)!).push(t);
	}

	const result: Record<number, TrackableOut[]> = {};
	for (const scenario of scenarios) {
		const rows = scenario.currentVersionId != null ? (byVersion.get(scenario.currentVersionId) ?? []) : [];
		if (!rows.length) continue;
		result[scenario.id] = rows.map((t) => ({
			id: t.id,
			label: t.label,
			severity: t.severity,
			manual_check: t.manualCheck,
			metric_key: t.metricKey,
			operator: t.operator,
			threshold: t.threshold != null ? Number(t.threshold) : null,
			latest_fired: evalMap.get(t.id)?.fired ?? null
		}));
	}
	return result;
}

export type GuidanceSummaryOut = { id: number; block_key: string; note: string; created_at: string };

// Open guidance notes, grouped by (companyId, owner) so the card and the
// Guidance tab can both show "my notes on this company" without a
// per-scenario query. Guidance notes have no separate owner column -
// created_by *is* the owner (see the Guidance-scope product decision: notes
// stay attached to whoever wrote them, visible to teammates viewing that
// analyst's scenario, but the shared /guidance tab only ever shows your own).
export async function openGuidanceForScenarios(
	companyIds: string[],
	scenarios: { id: number; companyId: string; owner: string }[]
): Promise<Record<number, GuidanceSummaryOut[]>> {
	if (!companyIds.length) return {};
	const rows = await db
		.select()
		.from(guidanceNotes)
		.where(and(inArray(guidanceNotes.companyId, companyIds), eq(guidanceNotes.status, 'open')))
		.orderBy(desc(guidanceNotes.createdAt));

	const byKey = new Map<string, GuidanceSummaryOut[]>();
	for (const row of rows) {
		const key = `${row.companyId}::${row.createdBy}`;
		const list = byKey.get(key) ?? [];
		list.push({ id: row.id, block_key: row.blockKey, note: row.note, created_at: row.createdAt as unknown as string });
		byKey.set(key, list);
	}

	const result: Record<number, GuidanceSummaryOut[]> = {};
	for (const s of scenarios) {
		const list = byKey.get(`${s.companyId}::${s.owner}`);
		if (list?.length) result[s.id] = list;
	}
	return result;
}
