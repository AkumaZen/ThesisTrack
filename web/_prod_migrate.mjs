// Applies the given drizzle/*.sql migration (usage: node _prod_migrate.mjs <envFile> <sqlFile>) to
// the production database (checked by _prod_db.mjs) from the given env file. Never logs the URL.
import fs from 'node:fs';
import postgres from 'postgres';
import { productionDatabaseUrl } from './_prod_db.mjs';

const envPath = process.argv[2];
const sqlPath = process.argv[3];
const url = productionDatabaseUrl(envPath);

const sql = fs.readFileSync(sqlPath, 'utf8');
const statements = sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);

const client = postgres(url, { max: 1, ssl: 'require' });
for (const stmt of statements) {
	await client.unsafe(stmt);
	console.log('Applied:', stmt.split('\n')[0].slice(0, 60));
}
await client.end();
console.log('Migration complete.');
