// Applies drizzle/0002_opposite_red_ghost.sql (custom_notes table) to
// whatever DATABASE_URL is in the given .env file. Never logs the URL.
import fs from 'node:fs';
import postgres from 'postgres';

const envPath = process.argv[2];
const sqlPath = process.argv[3];
const envText = fs.readFileSync(envPath, 'utf8');
const match = envText.match(/^DATABASE_URL=(.+)$/m);
if (!match) {
	console.error('DATABASE_URL not found in env file');
	process.exit(1);
}
let url = match[1].trim();
if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
	url = url.slice(1, -1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const statements = sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);

const client = postgres(url, { max: 1, ssl: url.includes('sslmode=require') ? 'require' : undefined });
for (const stmt of statements) {
	await client.unsafe(stmt);
	console.log('Applied:', stmt.split('\n')[0].slice(0, 60));
}
await client.end();
console.log('Migration complete.');
