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

// Every serverless instance keeps its own pool, and a managed Postgres allows only a few dozen
// connections in total, so a burst of instances used to fill every slot ("remaining connection
// slots are reserved for roles with the SUPERUSER attribute") and the whole site returned 500s.
// On Vercel each instance therefore holds at most two connections and lets idle ones go after a
// few seconds, instead of keeping them open for as long as the instance lives.
const serverless = Boolean(env.VERCEL);
const client = postgres(connectionString ?? '', {
	max: serverless ? 2 : 3,
	idle_timeout: serverless ? 5 : 30,
	max_lifetime: 10 * 60,
	connect_timeout: 15,
	ssl: connectionString?.includes('sslmode=require') ? 'require' : undefined,
	onnotice: () => {}
});
export const db = drizzle(client, { schema: { ...schema, ...valuationSchema } });
