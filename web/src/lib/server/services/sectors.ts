// Service layer for the Sectors feature - groups companies for a rollup
// health view across their theses. Ported in the style of guidance.ts /
// customTables.ts.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { companies, sectorCompanies, sectors, thesisScenarios } from '../db/schema';
import { coreMetricsForScenarios } from './companiesShared';
import { NotFoundError } from './scenarios';

export { NotFoundError };

// A company can carry multiple thesis scenarios (one per analyst/owner) -
// there is no single canonical "the" status. For a cross-analyst sector
// rollup there is no requesting-actor context to key off (unlike the
// dashboard, which picks the caller's own scenario), so the simplest
// defensible stand-in is: the most recently updated scenario for that
// company represents its current health. This mirrors "whoever looked at
// it last has the freshest read" rather than picking an arbitrary owner.
function pickRepresentativeScenario<T extends { companyId: string; updatedAt: Date }>(
	scenarios: T[]
): Map<string, T> {
	const byCompany = new Map<string, T>();
	for (const s of scenarios) {
		const existing = byCompany.get(s.companyId);
		if (!existing || s.updatedAt > existing.updatedAt) byCompany.set(s.companyId, s);
	}
	return byCompany;
}

async function hydrateSector(sector: typeof sectors.$inferSelect) {
	const rows = await db
		.select({ company: companies })
		.from(sectorCompanies)
		.innerJoin(companies, eq(sectorCompanies.companyId, companies.companyId))
		.where(eq(sectorCompanies.sectorId, sector.id))
		.orderBy(asc(companies.name));

	const companyIds = rows.map((r) => r.company.companyId);
	const allScenarios = companyIds.length
		? await db.select().from(thesisScenarios).where(inArray(thesisScenarios.companyId, companyIds))
		: [];
	const representative = pickRepresentativeScenario(allScenarios);
	const coreMetrics = await coreMetricsForScenarios([...representative.values()]);

	const healthCounts = { on_track: 0, watch_closely: 0, broken: 0 };
	const companiesOut = rows.map((r) => {
		const scenario = representative.get(r.company.companyId) ?? null;
		if (scenario) healthCounts[scenario.status as keyof typeof healthCounts]++;
		return {
			company_id: r.company.companyId,
			name: r.company.name,
			operating_model: r.company.operatingModel,
			status: scenario?.status ?? null,
			last_reviewed: scenario?.lastReviewed ?? null,
			core_metrics: scenario ? (coreMetrics[scenario.id] ?? {}) : {}
		};
	});

	return {
		id: sector.id,
		name: sector.name,
		description: sector.description,
		operating_model: sector.operatingModel,
		created_by: sector.createdBy,
		created_at: sector.createdAt,
		updated_at: sector.updatedAt,
		company_count: companiesOut.length,
		health_counts: healthCounts,
		companies: companiesOut
	};
}

export async function listSectorsWithCompanies() {
	const rows = await db.select().from(sectors).orderBy(asc(sectors.name));
	return Promise.all(rows.map(hydrateSector));
}

export async function getSectorById(id: number) {
	const [sector] = await db.select().from(sectors).where(eq(sectors.id, id)).limit(1);
	if (!sector) throw new NotFoundError(`sector '${id}' not found`);
	return hydrateSector(sector);
}

export async function createSector(
	data: { name: string; description?: string; operating_model?: string | null; company_ids?: string[] },
	actorName: string
) {
	return db.transaction(async (tx) => {
		const [sector] = await tx
			.insert(sectors)
			.values({
				name: data.name,
				description: data.description || null,
				operatingModel: (data.operating_model ?? null) as never,
				createdBy: actorName
			})
			.returning();

		if (data.company_ids?.length) {
			await tx
				.insert(sectorCompanies)
				.values(data.company_ids.map((companyId) => ({ sectorId: sector.id, companyId })))
				.onConflictDoNothing();
		}

		return sector;
	}).then((sector) => getSectorById(sector.id));
}

export async function updateSector(
	id: number,
	data: { name?: string; description?: string; operating_model?: string | null }
) {
	const [existing] = await db.select().from(sectors).where(eq(sectors.id, id)).limit(1);
	if (!existing) throw new NotFoundError(`sector '${id}' not found`);

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) updates.name = data.name;
	if (data.description !== undefined) updates.description = data.description || null;
	if (data.operating_model !== undefined) updates.operatingModel = data.operating_model;

	await db.update(sectors).set(updates).where(eq(sectors.id, id));
	return getSectorById(id);
}

export async function deleteSector(id: number) {
	const [existing] = await db.select().from(sectors).where(eq(sectors.id, id)).limit(1);
	if (!existing) throw new NotFoundError(`sector '${id}' not found`);
	// Cascade (sector_companies.sector_id ON DELETE CASCADE) removes the
	// mapping rows only - companies and their theses are untouched.
	await db.delete(sectors).where(eq(sectors.id, id));
}

export async function addCompaniesToSector(sectorId: number, companyIds: string[]) {
	const [sector] = await db.select().from(sectors).where(eq(sectors.id, sectorId)).limit(1);
	if (!sector) throw new NotFoundError(`sector '${sectorId}' not found`);

	await db
		.insert(sectorCompanies)
		.values(companyIds.map((companyId) => ({ sectorId, companyId })))
		.onConflictDoNothing();

	return getSectorById(sectorId);
}

export async function removeCompanyFromSector(sectorId: number, companyId: string) {
	const [sector] = await db.select().from(sectors).where(eq(sectors.id, sectorId)).limit(1);
	if (!sector) throw new NotFoundError(`sector '${sectorId}' not found`);

	await db
		.delete(sectorCompanies)
		.where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)));

	return getSectorById(sectorId);
}
