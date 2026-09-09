// Ports app/services/taxonomy.py's propose_niche (list_taxonomy already
// inlined directly in web/src/routes/api/taxonomy/+server.ts's GET handler).
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { broadIndustries, operatingModels, specificNiches } from '../db/schema';

export class TaxonomyError extends Error {}

export async function proposeOperatingModel(name: string) {
	const [existing] = await db.select().from(operatingModels).where(eq(operatingModels.name, name)).limit(1);
	if (existing) return existing;

	const [model] = await db.insert(operatingModels).values({ name, isActive: true }).returning();
	return model;
}

export async function proposeIndustry(name: string) {
	const [existing] = await db.select().from(broadIndustries).where(eq(broadIndustries.name, name)).limit(1);
	if (existing) return existing;

	const [industry] = await db.insert(broadIndustries).values({ name, isActive: true }).returning();
	return industry;
}

export async function proposeNiche(broadIndustryName: string, nicheName: string) {
	const [industry] = await db.select().from(broadIndustries).where(eq(broadIndustries.name, broadIndustryName)).limit(1);
	if (!industry) throw new TaxonomyError(`unknown broad_industry '${broadIndustryName}'`);

	const [existing] = await db
		.select()
		.from(specificNiches)
		.where(and(eq(specificNiches.broadIndustryId, industry.id), eq(specificNiches.name, nicheName)))
		.limit(1);
	if (existing) return existing;

	const [niche] = await db
		.insert(specificNiches)
		.values({ broadIndustryId: industry.id, name: nicheName, isActive: true })
		.returning();
	return niche;
}
