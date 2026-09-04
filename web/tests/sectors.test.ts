// DB-backed integration coverage for the Sectors service, following the
// pattern in services.integration.test.ts: throwaway company ids, real dev
// Postgres, full cleanup in afterAll (including sector rows this time -
// a previous test's leaked data had to be cleaned up manually once, don't
// repeat that).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { companies, sectorCompanies, sectors, thesisScenarios, thesisVersions } from '../src/lib/server/db/schema';
import {
	NotFoundError,
	addCompaniesToSector,
	createSector,
	deleteSector,
	getSectorById,
	listSectorsWithCompanies,
	removeCompanyFromSector,
	updateSector
} from '../src/lib/server/services/sectors';

const RUN_ID = Date.now();
const ACTOR = 'vitest-sectors-actor';
const COMPANY_A = `VITEST_SEC_A_${RUN_ID}`;
const COMPANY_B = `VITEST_SEC_B_${RUN_ID}`;
const COMPANY_C = `VITEST_SEC_C_${RUN_ID}`;

const sectorIdsToClean: number[] = [];

async function makeCompanyWithStatus(companyId: string, name: string, status: 'on_track' | 'watch_closely' | 'broken') {
	const niche = await db.query.specificNiches.findFirst({ where: (t, { eq }) => eq(t.broadIndustryId, 1) });
	await db.insert(companies).values({
		companyId,
		name,
		broadIndustryId: 1,
		specificNicheId: niche!.id,
		operatingModel: 'factory',
		currency: 'INR'
	});
	const [scenario] = await db
		.insert(thesisScenarios)
		.values({ companyId, owner: ACTOR, status, lastReviewed: '2026-01-01' })
		.returning();
	const [version] = await db
		.insert(thesisVersions)
		.values({
			companyId,
			scenarioId: scenario.id,
			versionNo: 1,
			thesisData: { proof_points: { model_specific_metrics: {} } },
			authoredBy: ACTOR
		})
		.returning();
	await db.update(thesisScenarios).set({ currentVersionId: version.versionId }).where(eq(thesisScenarios.id, scenario.id));
	return { companyId, scenarioId: scenario.id };
}

beforeAll(async () => {
	await makeCompanyWithStatus(COMPANY_A, 'Vitest Sector Co A', 'on_track');
	await makeCompanyWithStatus(COMPANY_B, 'Vitest Sector Co B', 'watch_closely');
	await makeCompanyWithStatus(COMPANY_C, 'Vitest Sector Co C', 'broken');
});

afterAll(async () => {
	for (const id of sectorIdsToClean) {
		await db.delete(sectors).where(eq(sectors.id, id));
	}
	await db.execute(sql`ALTER TABLE thesis_versions DISABLE TRIGGER trg_forbid_version_update`);
	try {
		for (const companyId of [COMPANY_A, COMPANY_B, COMPANY_C]) {
			await db.delete(companies).where(eq(companies.companyId, companyId));
		}
	} finally {
		await db.execute(sql`ALTER TABLE thesis_versions ENABLE TRIGGER trg_forbid_version_update`);
	}
});

describe('sectors service', () => {
	it('creates a sector with initial companies', async () => {
		const sector = await createSector(
			{ name: `Vitest Sector ${RUN_ID}`, description: 'test sector', operating_model: 'factory', company_ids: [COMPANY_A, COMPANY_B] },
			ACTOR
		);
		sectorIdsToClean.push(sector.id);

		expect(sector.name).toBe(`Vitest Sector ${RUN_ID}`);
		expect(sector.company_count).toBe(2);
		expect(sector.companies.map((c) => c.company_id).sort()).toEqual([COMPANY_A, COMPANY_B].sort());
	});

	it('lists sectors with correct health rollups', async () => {
		const sector = await createSector({ name: `Vitest Sector Health ${RUN_ID}`, company_ids: [COMPANY_A, COMPANY_B, COMPANY_C] }, ACTOR);
		sectorIdsToClean.push(sector.id);

		const list = await listSectorsWithCompanies();
		const found = list.find((s) => s.id === sector.id)!;
		expect(found.health_counts).toEqual({ on_track: 1, watch_closely: 1, broken: 1 });
		expect(found.company_count).toBe(3);
	});

	it('adds companies to an existing sector', async () => {
		const sector = await createSector({ name: `Vitest Sector Add ${RUN_ID}`, company_ids: [COMPANY_A] }, ACTOR);
		sectorIdsToClean.push(sector.id);

		const updated = await addCompaniesToSector(sector.id, [COMPANY_B, COMPANY_C]);
		expect(updated.company_count).toBe(3);
		expect(updated.companies.map((c) => c.company_id).sort()).toEqual([COMPANY_A, COMPANY_B, COMPANY_C].sort());
	});

	it('removes one company without deleting the company itself', async () => {
		const sector = await createSector({ name: `Vitest Sector Remove ${RUN_ID}`, company_ids: [COMPANY_A, COMPANY_B] }, ACTOR);
		sectorIdsToClean.push(sector.id);

		const updated = await removeCompanyFromSector(sector.id, COMPANY_A);
		expect(updated.companies.map((c) => c.company_id)).toEqual([COMPANY_B]);

		const [company] = await db.select().from(companies).where(eq(companies.companyId, COMPANY_A)).limit(1);
		expect(company).toBeDefined();
	});

	it('deletes a sector without deleting its companies theses', async () => {
		const sector = await createSector({ name: `Vitest Sector Delete ${RUN_ID}`, company_ids: [COMPANY_A] }, ACTOR);

		await deleteSector(sector.id);

		await expect(getSectorById(sector.id)).rejects.toBeInstanceOf(NotFoundError);
		const mapping = await db.select().from(sectorCompanies).where(eq(sectorCompanies.sectorId, sector.id));
		expect(mapping.length).toBe(0);

		const [company] = await db.select().from(companies).where(eq(companies.companyId, COMPANY_A)).limit(1);
		expect(company).toBeDefined();
		const [scenario] = await db.select().from(thesisScenarios).where(eq(thesisScenarios.companyId, COMPANY_A)).limit(1);
		expect(scenario).toBeDefined();
	});

	it('updates a sector', async () => {
		const sector = await createSector({ name: `Vitest Sector Update ${RUN_ID}` }, ACTOR);
		sectorIdsToClean.push(sector.id);

		const updated = await updateSector(sector.id, { description: 'updated description' });
		expect(updated.description).toBe('updated description');
	});
});
