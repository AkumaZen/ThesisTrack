// DB-backed check of migration 0034, which copies the old team lists into personal sections.
// Runs the real SQL file twice against seeded rows and removes everything it created.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import { watchlistMembers, watchlists } from '../src/lib/server/db/valuationSchema';
import { watchlistSectionItems, watchlistSections } from '../src/lib/server/db/marketIntelSchema';
import { dbReachable } from './dbReachable';

const dbUp = await dbReachable();
const RUN = Date.now();
const MIGRATION = readFileSync(new URL('../drizzle/0034_merge_team_lists_into_sections.sql', import.meta.url), 'utf8');

async function runMigration() {
	for (const statement of MIGRATION.split('--> statement-breakpoint')) await db.execute(sql.raw(statement));
}

let byEmail = 0;
let byName = 0;
const listIds: number[] = [];

describe.skipIf(!dbUp)('migration 0034: team lists become sections', () => {
	beforeAll(async () => {
		const mk = async (tag: string) =>
			(await db.insert(users).values({ email: `vt-wl-${tag}-${RUN}@example.test`, passwordHash: 'x', displayName: `VtWl.${tag}.${RUN}` }).returning({ id: users.id }))[0].id;
		byEmail = await mk('email');
		byName = await mk('name');
		// A section the email owner already has, so the copy of a same-named list needs a suffix.
		await db.insert(watchlistSections).values({ userId: byEmail, name: `Ideas ${RUN}`, position: 1 });
		const now = Date.now();
		const seed = async (name: string, createdBy: string, symbols: string[]) => {
			const [l] = await db.insert(watchlists).values({ name, createdBy, createdAt: now }).returning({ id: watchlists.id });
			listIds.push(l.id);
			if (symbols.length) await db.insert(watchlistMembers).values(symbols.map((symbol) => ({ watchlistId: l.id, symbol, addedBy: 'x', addedAt: now })));
		};
		await seed(`Ideas ${RUN}`, `VT-WL-EMAIL-${RUN}@EXAMPLE.TEST`, [`VTA${RUN}`, `VTB${RUN}`]);
		await seed(`Defence ${RUN}`, `vtwl.name.${RUN}`, [`VTC${RUN}`]);
		await seed(`Orphan ${RUN}`, `nobody-${RUN}`, []);
	});

	afterAll(async () => {
		if (!dbUp) return;
		await db.execute(sql`delete from valuation.watchlist_sections where name like ${`%${RUN}%`}`);
		if (listIds.length) await db.delete(watchlists).where(inArray(watchlists.id, listIds));
		await db.delete(users).where(like(users.email, `vt-wl-%-${RUN}@example.test`));
	});

	it('maps owners, avoids name clashes, copies members and is idempotent', async () => {
		await runMigration();
		await runMigration();

		const sections = await db.select().from(watchlistSections).where(like(watchlistSections.name, `%${RUN}%`));
		const items = async (id: number) =>
			(await db.select().from(watchlistSectionItems).where(eq(watchlistSectionItems.sectionId, id))).map((i) => i.nseSymbol).sort();

		// Email match (case-insensitive); the clash with the person's own "Ideas" gets " (team)".
		const ideas = sections.filter((s) => s.userId === byEmail).map((s) => s.name).sort();
		expect(ideas).toEqual([`Ideas ${RUN}`, `Ideas ${RUN} (team)`]);
		const copied = sections.find((s) => s.name === `Ideas ${RUN} (team)`)!;
		expect(await items(copied.id)).toEqual([`VTA${RUN}`, `VTB${RUN}`]);

		// Display-name match.
		const defence = sections.filter((s) => s.name === `Defence ${RUN}`);
		expect(defence).toHaveLength(1);
		expect(defence[0].userId).toBe(byName);
		expect(await items(defence[0].id)).toEqual([`VTC${RUN}`]);

		// No match: lands with an admin, as an empty section; a re-run added no second copy.
		const orphan = sections.filter((s) => s.name === `Orphan ${RUN}`);
		expect(orphan).toHaveLength(1);
		const [owner] = await db.select().from(users).where(eq(users.id, orphan[0].userId));
		expect(owner.role).toBe('admin');
		expect(await items(orphan[0].id)).toEqual([]);

		// The old tables are untouched.
		expect(await db.select().from(watchlists).where(inArray(watchlists.id, listIds))).toHaveLength(3);
	});
});
