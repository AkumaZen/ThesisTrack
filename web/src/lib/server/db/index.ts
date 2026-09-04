// Mirrors app/db.py: small pool (serverless-friendly), same DATABASE_URL
// convention (Aiven/managed Postgres hands out "postgres://").
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

const connectionString = env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const client = postgres(connectionString, { max: 3, ssl: connectionString.includes('sslmode=require') ? 'require' : undefined });
export const db = drizzle(client, { schema });
