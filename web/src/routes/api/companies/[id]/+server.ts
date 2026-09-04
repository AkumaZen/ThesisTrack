// Ports GET /api/companies/{id} from app/routers/companies.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	broadIndustries,
	companies,
	healthChecks,
	killTriggers,
	observations,
	specificNiches,
	statusEvents,
	statusProposals,
	thesisVersions
} from '$lib/server/db/schema';
import { requireActor, errorResponse, handleAuthError } from '$lib/server/http';
import { listScenarios } from '$lib/server/services/scenarios';
import { latestTriggerEvaluations, scenarioToOut } from '$lib/server/services/companiesShared';

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const actor = requireActor(locals.actor);
		const companyId = params.id!;

		const [row] = await db
			.select({ company: companies, industryName: broadIndustries.name, nicheName: specificNiches.name })
			.from(companies)
			.innerJoin(broadIndustries, eq(companies.broadIndustryId, broadIndustries.id))
			.innerJoin(specificNiches, eq(companies.specificNicheId, specificNiches.id))
			.where(eq(companies.companyId, companyId))
			.limit(1);
		if (!row) return errorResponse(404, `company '${companyId}' not found`);
		const { company, industryName, nicheName } = row;

		const allScenarios = await listScenarios(companyId);
		const scenario = allScenarios.find((s) => s.owner === actor.identity) ?? null;
		const otherScenarios = allScenarios
			.filter((s) => s.owner !== actor.identity)
			.map((s) => ({ id: s.id, owner: s.owner, label: s.label, status: s.status, last_reviewed: s.lastReviewed }));

		if (!scenario) {
			const base = scenarioToOut(company, industryName, nicheName, null, allScenarios.length);
			return json({ ...base, other_scenarios: otherScenarios });
		}

		const currentVersion = scenario.currentVersionId
			? (
					await db.select().from(thesisVersions).where(eq(thesisVersions.versionId, scenario.currentVersionId)).limit(1)
				)[0]
			: null;

		const versions = await db
			.select()
			.from(thesisVersions)
			.where(eq(thesisVersions.scenarioId, scenario.id))
			.orderBy(desc(thesisVersions.versionNo))
			.limit(8);

		const last8Periods = (
			await db
				.selectDistinct({ period: observations.period })
				.from(observations)
				.where(eq(observations.companyId, companyId))
				.orderBy(desc(observations.period))
				.limit(8)
		).map((r) => r.period);

		const observationRows = last8Periods.length
			? await db
					.select()
					.from(observations)
					.where(and(eq(observations.companyId, companyId), inArray(observations.period, last8Periods)))
					.orderBy(desc(observations.periodEnd))
			: [];

		const healthCheckRows = await db
			.select()
			.from(healthChecks)
			.where(eq(healthChecks.scenarioId, scenario.id))
			.orderBy(desc(healthChecks.createdAt));

		const pendingProposalRows = await db
			.select()
			.from(statusProposals)
			.where(and(eq(statusProposals.scenarioId, scenario.id), eq(statusProposals.state, 'pending')))
			.orderBy(desc(statusProposals.createdAt));

		let killTriggersOut: unknown[] = [];
		if (currentVersion) {
			const triggers = await db.select().from(killTriggers).where(eq(killTriggers.versionId, currentVersion.versionId));
			const evalMap = await latestTriggerEvaluations(triggers.map((t) => t.id));
			killTriggersOut = triggers.map((t) => {
				const latest = evalMap.get(t.id);
				return {
					id: t.id,
					label: t.label,
					metric_key: t.metricKey,
					operator: t.operator,
					threshold: t.threshold != null ? Number(t.threshold) : null,
					severity: t.severity,
					action: t.action,
					grace_periods: t.gracePeriods,
					manual_check: t.manualCheck,
					latest_observed_value: latest?.observedValue != null ? Number(latest.observedValue) : null,
					latest_breached: latest?.breached ?? null,
					latest_fired: latest?.fired ?? null
				};
			});
		}

		const [latestEvent] = await db
			.select()
			.from(statusEvents)
			.where(eq(statusEvents.scenarioId, scenario.id))
			.orderBy(desc(statusEvents.createdAt))
			.limit(1);
		const activeOverride =
			latestEvent?.override
				? {
						to_status: latestEvent.toStatus,
						rationale: latestEvent.rationale,
						actor: latestEvent.actor,
						created_at: latestEvent.createdAt
					}
				: null;

		const base = scenarioToOut(company, industryName, nicheName, scenario, allScenarios.length, activeOverride != null);

		return json({
			...base,
			current_thesis: currentVersion?.thesisData ?? {},
			versions: versions.map((v) => ({
				version_id: v.versionId,
				version_no: v.versionNo,
				change_note: v.changeNote,
				authored_by: v.authoredBy,
				authored_at: v.authoredAt
			})),
			observations: observationRows.map((o) => ({
				period: o.period,
				period_end: o.periodEnd,
				metric_key: o.metricKey,
				numeric_value: o.numericValue != null ? Number(o.numericValue) : null,
				text_value: o.textValue,
				source_type: o.sourceType,
				source_url: o.sourceUrl,
				note: o.note
			})),
			health_checks: healthCheckRows.map((h) => ({
				id: h.id,
				company_id: h.companyId,
				period: h.period,
				verdict: h.verdict,
				source: h.source,
				note: h.note,
				human_confirmed: h.humanConfirmed,
				author: h.author,
				created_at: h.createdAt
			})),
			pending_proposals: pendingProposalRows.map((p) => ({
				id: p.id,
				company_id: p.companyId,
				period: p.period,
				proposed_status: p.proposedStatus,
				source: p.source,
				rationale: p.rationale,
				evidence: p.evidence,
				state: p.state,
				model_name: p.modelName,
				created_at: p.createdAt
			})),
			kill_triggers: killTriggersOut,
			active_override: activeOverride,
			other_scenarios: otherScenarios
		});
	} catch (err) {
		return handleAuthError(err);
	}
};
