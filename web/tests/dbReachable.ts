// The DB-backed tests need the dev Postgres from docker-compose. When it isn't running they are
// skipped (with a note) instead of failing on ECONNREFUSED, so the rest of the suite stays readable.
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/server/db';

async function check(): Promise<boolean> {
	const timeout = new Promise<false>((done) => setTimeout(() => done(false), 3000));
	const ping = db.execute(sql`select 1`).then(
		() => true,
		() => false
	);
	const ok = await Promise.race([ping, timeout]);
	if (!ok) console.warn('[tests] test database unreachable: skipping DB-backed tests (start it with docker compose up)');
	return ok;
}

let cached: Promise<boolean> | undefined;
export function dbReachable(): Promise<boolean> {
	return (cached ??= check());
}
