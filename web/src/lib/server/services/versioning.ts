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

async function writeKillTriggers(versionId: number, thesis: ThesisData) {
	if (!thesis.what_can_kill_it.length) return;
	await db.insert(killTriggers).values(
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

export async function createCompany(payload: ThesisCreate, actor: string) {
	const companyId = deriveCompanyId(payload);
	const [existing] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (existing && (await getScenarioOptional(companyId, actor))) {
		throw new AlreadyExistsError(`'${actor}' already has a thesis on company '${companyId}'`);
	}

	let company = existing;
	if (!company) {
		const { industry, niche } = await resolveTaxonomy(
			payload.classification.broad_industry,
			payload.classification.specific_niche
		);
		const model = await resolveOperatingModel(payload.classification.operating_model);
		[company] = await db
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

	const [scenario] = await db
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

	const [version] = await db
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

	await writeKillTriggers(version.versionId, payload.thesis_data);

	const [updated] = await db
		.update(thesisScenarios)
		.set({ currentVersionId: version.versionId })
		.where(eq(thesisScenarios.id, scenario.id))
		.returning();

	return updated;
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
