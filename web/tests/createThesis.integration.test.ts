// DB-backed check of the SOTL case (BUGS-TO-FIX.md #1): an analyst whose own thesis on a company is
// an empty placeholder (hidden by the dashboard) can create it again, and a real thesis stays
// protected. Throwaway company ids, cleaned up in afterAll like sectors.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { broadIndustries, companies, specificNiches, thesisScenarios, thesisVersions } from '../src/lib/server/db/schema';
import { thesisCreate } from '../src/lib/server/schemas/thesis';
import { AlreadyExistsError, createCompany } from '../src/lib/server/services/versioning';
import { dbReachable } from './dbReachable';

const dbUp = await dbReachable();

const RUN_ID = Date.now();
const THESIS = { the_business: { what_it_does: 'Makes cables', revenue_split: [] } };
const ACTOR = 'vitest-create-actor';
const PLACEHOLDER = `VITEST_ADOPT_${RUN_ID}`;
const REAL = `VITEST_REAL_${RUN_ID}`;

let classification: { broad_industry: string; specific_niche: string; operating_model: string };

const payload = (companyId: string) =>
	thesisCreate.parse({ company_id: companyId, name: `Vitest ${companyId}`, classification, thesis_data: THESIS });

beforeAll(async () => {
	if (!dbUp) return;
	const [row] = await db
		.select({ industry: broadIndustries.name, niche: specificNiches.name, industryId: broadIndustries.id })
		.from(specificNiches)
		.innerJoin(broadIndustries, eq(broadIndustries.id, specificNiches.broadIndustryId))
		.limit(1);
	classification = { broad_industry: row.industry, specific_niche: row.niche, operating_model: 'factory' };

	// What a create that failed part-way used to leave: a scenario whose only version is empty.
	const niche = await db.query.specificNiches.findFirst({ where: (t, { eq }) => eq(t.name, row.niche) });
	await db.insert(companies).values({
		companyId: PLACEHOLDER,
		name: 'Vitest placeholder',
		broadIndustryId: row.industryId,
		specificNicheId: niche!.id,
		operatingModel: 'factory',
		currency: 'INR'
	});
	const [scenario] = await db
		.insert(thesisScenarios)
		.values({ companyId: PLACEHOLDER, owner: ACTOR, lastReviewed: '2026-01-01' })
		.returning();
	const [version] = await db
		.insert(thesisVersions)
		.values({
			companyId: PLACEHOLDER,
			scenarioId: scenario.id,
			versionNo: 1,
			thesisData: { the_business: { what_it_does: '\n ' }, proof_points: { hard_evidence: [] }, why_we_believe_it: [] },
			authoredBy: ACTOR
		})
		.returning();
	await db.update(thesisScenarios).set({ currentVersionId: version.versionId }).where(eq(thesisScenarios.id, scenario.id));
});

afterAll(async () => {
	if (!dbUp) return;
	// The same opt-in the admin Delete endpoint uses (drizzle/0011), scoped to this transaction.
	await db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('app.allow_thesis_delete', 'on', true)`);
		for (const companyId of [PLACEHOLDER, REAL]) await tx.delete(companies).where(eq(companies.companyId, companyId));
	});
});

describe.skipIf(!dbUp)('creating a thesis over an empty placeholder', () => {
	it('fills in the placeholder instead of saying the analyst already has a thesis', async () => {
		const scenario = await createCompany(payload(PLACEHOLDER), ACTOR);
		const scenarios = await db.select().from(thesisScenarios).where(eq(thesisScenarios.companyId, PLACEHOLDER));
		expect(scenarios).toHaveLength(1);
		expect(scenarios[0].id).toBe(scenario.id);
		const [current] = await db
			.select()
			.from(thesisVersions)
			.where(eq(thesisVersions.versionId, scenarios[0].currentVersionId!));
		expect(current.versionNo).toBe(2);
		expect((current.thesisData as typeof THESIS).the_business.what_it_does).toBe('Makes cables');
	});

	it('still refuses a second thesis once the first has content', async () => {
		await createCompany(payload(REAL), ACTOR);
		await expect(createCompany(payload(REAL), ACTOR)).rejects.toBeInstanceOf(AlreadyExistsError);
		const scenarios = await db.select().from(thesisScenarios).where(eq(thesisScenarios.companyId, REAL));
		expect(scenarios).toHaveLength(1);
	});
});
