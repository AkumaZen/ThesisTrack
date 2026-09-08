// Reads DATABASE_URL from .production.env internally - never logs it.
import fs from 'node:fs';
import postgres from 'postgres';

const envPath = process.argv[2];
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

const client = postgres(url, { max: 1, ssl: url.includes('sslmode=require') ? 'require' : undefined });

const tables = await client`
	select table_name from information_schema.tables
	where table_schema = 'public' and table_name in ('sectors', 'sector_companies', 'custom_notes')
	order by table_name
`;
console.log('Existing new tables:', tables.map((t) => t.table_name));

const users = await client`select email, is_active from users where email in ('rohit.negi@rdc.in', 'siddhesh.dige@rdc.in', 'shishir.bhat@rdc.in') order by email`;
console.log('Users found:', users.map((u) => `${u.email} (active=${u.is_active})`));

await client.end();
