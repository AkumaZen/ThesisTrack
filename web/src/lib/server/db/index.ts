// Mirrors app/db.py: small pool (serverless-friendly), same DATABASE_URL
// convention (Aiven/managed Postgres hands out "postgres://"). One database
// for the whole app: thesis tables in `public`, the valuation tools' tables in
// the `valuation` schema (valuationSchema.ts).
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '$env/dynamic/private';
import { building } from '$app/environment';
import * as schema from './schema';
import * as valuationSchema from './valuationSchema';

const connectionString = env.DATABASE_URL;
// `vite build` imports server modules to analyse them, possibly with no database around. The
// client connects lazily, so skipping the check while building is safe.
if (!building && !connectionString) throw new Error('DATABASE_URL is not set');

// Production runs on Neon behind its connection pooler (the "-pooler" host name): Vercel can start
// many instances, and the pooler lets them all share a few real database connections. PgBouncer
// in transaction mode hands a different connection to each statement, so prepared statements are
// turned off there.
//
// Pointed straight at a small database instead (no pooler), every Vercel instance would keep its
// own connections and a burst of instances can fill the server's whole limit ("remaining connection
// slots are reserved for roles with the SUPERUSER attribute" - that took the site down once on
// Aiven's 17 usable connections). So without a pooler each instance holds a single connection,
// closes it after one idle second, and hooks.server.ts keeps the instance awake for IDLE_GRACE_MS
// after each reply so that idle timer can run before Vercel freezes the instance.
const pooled = Boolean(connectionString && /-pooler[.]/.test(connectionString));
const serverless = Boolean(env.VERCEL);
export const IDLE_GRACE_MS = 2000;
/** True when instances must be kept awake briefly so idle connections close (direct database only). */
export const holdIdleConnections = serverless && !pooled;
const client = postgres(connectionString ?? '', {
	max: serverless && !pooled ? 1 : 3,
	idle_timeout: serverless && !pooled ? 1 : 30,
	max_lifetime: 10 * 60,
	connect_timeout: 15,
	prepare: !pooled,
	ssl: connectionString?.includes('sslmode=require') ? 'require' : undefined,
	onnotice: () => {}
});
export const db = drizzle(client, { schema: { ...schema, ...valuationSchema } });
