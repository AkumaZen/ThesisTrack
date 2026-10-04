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

// Every serverless instance keeps its own pool, and this managed Postgres allows only 17 usable
// connections in total, so a burst of instances fills every slot ("remaining connection slots are
// reserved for roles with the SUPERUSER attribute") and the whole site returns 500s. On Vercel each
// instance holds just one connection, closes it after one idle second, and hooks.server.ts keeps the
// instance awake for IDLE_GRACE_MS after each reply so that idle timer can actually run before the
// instance is frozen. The stronger remedy is a pooler in front of the database (see STATE.md).
const serverless = Boolean(env.VERCEL);
export const IDLE_GRACE_MS = 2000;
const client = postgres(connectionString ?? '', {
	max: serverless ? 1 : 3,
	idle_timeout: serverless ? 1 : 30,
	max_lifetime: 10 * 60,
	connect_timeout: 15,
	ssl: connectionString?.includes('sslmode=require') ? 'require' : undefined,
	onnotice: () => {}
});
export const db = drizzle(client, { schema: { ...schema, ...valuationSchema } });
