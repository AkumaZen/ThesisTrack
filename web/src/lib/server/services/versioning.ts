// Ports app/services/versioning.py
import { and, eq, max } from 'drizzle-orm';
import { db } from '../db';
import { broadIndustries, companies, killTriggers, specificNiches, thesisScenarios, thesisVersions } from '../db/schema';
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

export async function createCompany(payload: ThesisCreate, actor: string) {
	const [existing] = await db.select().from(companies).where(eq(companies.companyId, payload.company_id)).limit(1);
	if (existing && (await getScenarioOptional(payload.company_id, actor))) {
		throw new AlreadyExistsError(`'${actor}' already has a thesis on company '${payload.company_id}'`);
	}

	let company = existing;
	if (!company) {
		const { industry, niche } = await resolveTaxonomy(
			payload.classification.broad_industry,
			payload.classification.specific_niche
		);
		[company] = await db
			.insert(companies)
			.values({
				companyId: payload.company_id,
				name: payload.name,
				broadIndustryId: industry.id,
				specificNicheId: niche.id,
				operatingModel: payload.classification.operating_model,
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
