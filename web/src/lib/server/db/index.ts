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

const client = postgres(connectionString ?? '', {
	max: 3,
	ssl: connectionString?.includes('sslmode=require') ? 'require' : undefined,
	onnotice: () => {}
});
export const db = drizzle(client, { schema: { ...schema, ...valuationSchema } });
