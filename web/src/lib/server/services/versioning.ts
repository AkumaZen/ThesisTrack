// Ports app/services/versioning.py
import { and, eq, max } from 'drizzle-orm';
import { db } from '../db';
import {
	broadIndustries,
	companies,
	killTriggers,
	operatingModels,
	specificNiches,
	thesisScenarios,
	thesisVersions
} from '../db/schema';
import type { ThesisCreate, ThesisData } from '../schemas/thesis';
import { getScenarioOptional, ScenarioNotFoundError } from './scenarios';

export class NotFoundError extends Error {}
export class TaxonomyError extends Error {}
export class AlreadyExistsError extends Error {}

async function resolveTaxonomy(broadIndustryName: string, specificNicheName: string) {
	const [industry] = await db.select().from(broadIndustries).where(eq(broadIndustries.name, broadIndustryName)).limit(1);
	if (!industry) throw new TaxonomyError(`unknown broad_industry '${broadIndustryName}'`);
	const [niche] = await db
		.select()
		.from(specificNiches)
		.where(and(eq(specificNiches.broadIndustryId, industry.id), eq(specificNiches.name, specificNicheName)))
		.limit(1);
	if (!niche) {
		throw new TaxonomyError(
			`unknown specific_niche '${specificNicheName}' under '${broadIndustryName}'; propose it via POST /taxonomy/niches first`
		);
	}
	return { industry, niche };
}

async function resolveOperatingModel(name: string) {
	const [model] = await db.select().from(operatingModels).where(eq(operatingModels.name, name)).limit(1);
	if (!model) {
		throw new TaxonomyError(`unknown operating_model '${name}'; propose it via POST /taxonomy/operating-models first`);
	}
	return model;
}

// The db itself or an open transaction, so multi-step writes can share one.
type Executor = Pick<typeof db, 'select' | 'insert' | 'update'>;

async function writeKillTriggers(versionId: number, thesis: ThesisData, ex: Executor = db) {
	if (!thesis.what_can_kill_it.length) return;
	await ex.insert(killTriggers).values(
		thesis.what_can_kill_it.map((t) => ({
			versionId,
			label: t.label,
			metricKey: t.metric_key ?? null,
			operator: t.operator ?? null,
			threshold: t.threshold != null ? String(t.threshold) : null,
			severity: t.severity,
			action: t.action,
			gracePeriods: t.grace_periods,
			manualCheck: t.manual_check
		}))
	);
}

// The form no longer collects a raw company_id - it derives one from
// whichever exchange ticker was supplied (NSE preferred, since that's the
// more commonly quoted one), falling back to a passed-through company_id
// for API/JSON-import callers that still provide it directly.
function deriveCompanyId(payload: ThesisCreate): string {
	if (payload.company_id) return payload.company_id;
	const raw = payload.nse_ticker || payload.bse_ticker;
	if (!raw) throw new TaxonomyError('one of nse_ticker, bse_ticker, or company_id is required');
	return raw.replace(/[^A-Z0-9_]/g, '_').slice(0, 50);
}

// Same test the dashboard (GET /api/companies) uses to decide whether a
// scenario is a real thesis or a thin placeholder it hides. Keep them in sync:
// if the dashboard hides it, creating a thesis must be allowed to replace it.
export function isSubstantiveThesis(data: unknown): boolean {
	const d = (data ?? {}) as {
		the_business?: { what_it_does?: unknown };
		proof_points?: { hard_evidence?: unknown };
		why_we_believe_it?: unknown;
	};
	const whatItDoes = d.the_business?.what_it_does;
	if (typeof whatItDoes === 'string' && whatItDoes.trim().length > 0) return true;
	const evidence = d.proof_points?.hard_evidence;
	if (Array.isArray(evidence) && evidence.length > 0) return true;
	return Array.isArray(d.why_we_believe_it) && d.why_we_believe_it.length > 0;
}

async function scenarioHasSubstantiveThesis(scenario: typeof thesisScenarios.$inferSelect) {
	if (scenario.currentVersionId == null) return false;
	const [version] = await db
		.select({ thesisData: thesisVersions.thesisData })
		.from(thesisVersions)
		.where(eq(thesisVersions.versionId, scenario.currentVersionId))
		.limit(1);
	return version ? isSubstantiveThesis(version.thesisData) : false;
}

// Fills an empty placeholder scenario (no version, or a version with no real
// content, which the dashboard hides) with the submitted thesis. Appends a new
// version rather than editing old ones, so nothing is lost.
async function adoptPlaceholderScenario(
	scenario: typeof thesisScenarios.$inferSelect,
	payload: ThesisCreate,
	actor: string,
	ex: Executor
) {
	const [row] = await ex
		.select({ maxNo: max(thesisVersions.versionNo) })
		.from(thesisVersions)
		.where(eq(thesisVersions.scenarioId, scenario.id));

	const [version] = await ex
		.insert(thesisVersions)
		.values({
			companyId: scenario.companyId,
			scenarioId: scenario.id,
			versionNo: (row?.maxNo ?? 0) + 1,
			thesisData: payload.thesis_data,
			changeNote: 'initial thesis',
			authoredBy: actor
		})
		.returning();

	await writeKillTriggers(version.versionId, payload.thesis_data, ex);

	const [updated] = await ex
		.update(thesisScenarios)
		.set({
			currentVersionId: version.versionId,
			status: payload.status,
			statusSource: 'manual',
			lastReviewed: payload.last_reviewed
		})
		.where(eq(thesisScenarios.id, scenario.id))
		.returning();
	return updated;
}

export async function createCompany(payload: ThesisCreate, actor: string) {
	const companyId = deriveCompanyId(payload);
	const [existing] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	const mine = existing ? await getScenarioOptional(companyId, actor) : null;
	if (mine) {
		if (await scenarioHasSubstantiveThesis(mine)) {
			throw new AlreadyExistsError(`'${actor}' already has a thesis on company '${companyId}'`);
		}
		return db.transaction((tx) => adoptPlaceholderScenario(mine, payload, actor, tx));
	}

	// Resolve lookups before writing, then do every write in one transaction:
	// a failure part-way used to leave an empty scenario behind that the
	// dashboard hides but that still blocked the analyst from creating again.
	const taxonomy = existing
		? null
		: {
				...(await resolveTaxonomy(payload.classification.broad_industry, payload.classification.specific_niche)),
				model: await resolveOperatingModel(payload.classification.operating_model)
			};

	return db.transaction(async (tx) => {
		let company = existing;
		if (!company) {
			const { industry, niche, model } = taxonomy!;
			[company] = await tx
				.insert(companies)
				.values({
					companyId,
					name: payload.name,
					nseTicker: payload.nse_ticker ?? null,
					bseTicker: payload.bse_ticker ?? null,
					broadIndustryId: industry.id,
					specificNicheId: niche.id,
					operatingModel: model.name,
					currency: payload.classification.currency
				})
				.returning();
		}

		const [scenario] = await tx
			.insert(thesisScenarios)
			.values({
				companyId: company.companyId,
				owner: actor,
				label: 'Thesis',
				status: payload.status,
				statusSource: 'manual',
				lastReviewed: payload.last_reviewed
			})
			.returning();

		const [version] = await tx
			.insert(thesisVersions)
			.values({
				companyId: company.companyId,
				scenarioId: scenario.id,
				versionNo: 1,
				thesisData: payload.thesis_data,
				changeNote: 'initial thesis',
				authoredBy: actor
			})
			.returning();

		await writeKillTriggers(version.versionId, payload.thesis_data, tx);

		const [updated] = await tx
			.update(thesisScenarios)
			.set({ currentVersionId: version.versionId })
			.where(eq(thesisScenarios.id, scenario.id))
			.returning();

		return updated;
	});
}

export async function updateCompanyDetails(
	companyId: string,
	patch: { name?: string; broad_industry?: string; specific_niche?: string; operating_model?: string; currency?: string }
) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const values: Partial<typeof companies.$inferInsert> = {};
	if (patch.name !== undefined) values.name = patch.name;
	if (patch.operating_model !== undefined) {
		const model = await resolveOperatingModel(patch.operating_model);
		values.operatingModel = model.name;
	}
	if (patch.currency !== undefined) values.currency = patch.currency;
	if (patch.broad_industry !== undefined || patch.specific_niche !== undefined) {
		const { industry, niche } = await resolveTaxonomy(
			patch.broad_industry ?? (await db.select().from(broadIndustries).where(eq(broadIndustries.id, company.broadIndustryId)).limit(1))[0].name,
			patch.specific_niche ?? (await db.select().from(specificNiches).where(eq(specificNiches.id, company.specificNicheId)).limit(1))[0].name
		);
		values.broadIndustryId = industry.id;
		values.specificNicheId = niche.id;
	}

	const [updated] = await db.update(companies).set(values).where(eq(companies.companyId, companyId)).returning();
	return updated;
}

export async function amendThesis(companyId: string, thesisData: ThesisData, changeNote: string, actor: string) {
	const scenario = await getScenarioOptional(companyId, actor);
	if (!scenario) {
		const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
		if (!company) throw new NotFoundError(`company '${companyId}' not found`);
		throw new ScenarioNotFoundError(`'${actor}' has no thesis on company '${companyId}' yet - start one first`);
	}

	const [row] = await db
		.select({ maxNo: max(thesisVersions.versionNo) })
		.from(thesisVersions)
		.where(eq(thesisVersions.scenarioId, scenario.id));
	const nextVersionNo = (row?.maxNo ?? 0) + 1;

	const [version] = await db
		.insert(thesisVersions)
		.values({
			companyId,
			scenarioId: scenario.id,
			versionNo: nextVersionNo,
			thesisData,
			changeNote,
			authoredBy: actor
		})
		.returning();

	await writeKillTriggers(version.versionId, thesisData);
	await db.update(thesisScenarios).set({ currentVersionId: version.versionId }).where(eq(thesisScenarios.id, scenario.id));

	return version;
}

function flatten(obj: unknown, prefix = ''): Record<string, unknown> {
	const flat: Record<string, unknown> = {};
	if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			Object.assign(flat, flatten(value, prefix ? `${prefix}.${key}` : key));
		}
	} else if (Array.isArray(obj)) {
		obj.forEach((value, i) => Object.assign(flat, flatten(value, `${prefix}[${i}]`)));
	} else {
		flat[prefix] = obj;
	}
	return flat;
}

export function diffVersions(v1: { thesisData: unknown }, v2: { thesisData: unknown }) {
	const left = flatten(v1.thesisData);
	const right = flatten(v2.thesisData);
	const paths = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
	const changes: { path: string; old: unknown; new: unknown }[] = [];
	for (const path of paths) {
		const oldVal = left[path];
		const newVal = right[path];
		if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
			changes.push({ path, old: oldVal ?? null, new: newVal ?? null });
		}
	}
	return changes;
}
