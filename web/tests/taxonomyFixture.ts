// The DB-backed tests need one broad industry with one niche. Migrations do not seed the taxonomy
// (the team's rows are data), so a fresh database has none: add a placeholder pair when the tables
// are empty and use whatever the first row is otherwise. Left in place; it is harmless taxonomy data.
import { asc, eq } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { broadIndustries, specificNiches } from '../src/lib/server/db/schema';

export async function ensureTaxonomy(): Promise<{
	broadIndustryId: number;
	broadIndustry: string;
	specificNicheId: number;
	specificNiche: string;
}> {
	const first = () =>
		db
			.select({
				broadIndustryId: broadIndustries.id,
				broadIndustry: broadIndustries.name,
				specificNicheId: specificNiches.id,
				specificNiche: specificNiches.name
			})
			.from(specificNiches)
			.innerJoin(broadIndustries, eq(broadIndustries.id, specificNiches.broadIndustryId))
			.orderBy(asc(broadIndustries.id), asc(specificNiches.id))
			.limit(1);
	const existing = (await first())[0];
	if (existing) return existing;

	await db.insert(broadIndustries).values({ name: 'Test industry' }).onConflictDoNothing();
	const industry = await db.query.broadIndustries.findFirst({ where: (t, { eq }) => eq(t.name, 'Test industry') });
	await db
		.insert(specificNiches)
		.values({ broadIndustryId: industry!.id, name: 'Test niche' })
		.onConflictDoNothing();
	return (await first())[0];
}
