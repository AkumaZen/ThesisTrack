// Reads DATABASE_URL from .production.env internally - never logs it.
// Diagnostic only, no writes. Checks for every migration (0003-0007) that
// could plausibly not have been reconciled to production yet, per the
// recurring "migration file committed but never applied to prod" gotcha.
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
	where table_schema = 'public' and table_name in ('sectors', 'sector_companies', 'custom_notes', 'operating_models')
	order by table_name
`;
console.log('Existing tables (sectors/sector_companies/custom_notes/operating_models):', tables.map((t) => t.table_name));

const companiesCols = await client`
	select column_name, data_type from information_schema.columns
	where table_schema = 'public' and table_name = 'companies'
	and column_name in ('nse_ticker', 'bse_ticker', 'operating_model')
`;
console.log('companies columns:', companiesCols);

const metricCol = await client`
	select column_name, data_type, character_maximum_length from information_schema.columns
	where table_schema = 'public' and table_name = 'metric_definitions' and column_name = 'unit'
`;
console.log('metric_definitions.unit:', metricCol);

const guidanceCols = await client`
	select column_name from information_schema.columns
	where table_schema = 'public' and table_name = 'guidance_notes'
	and column_name in ('target_metric', 'target_metric_label', 'target_value', 'target_unit', 'target_period', 'outcome', 'expected_results_date')
	order by column_name
`;
console.log('guidance_notes new columns present:', guidanceCols.map((c) => c.column_name));

const users = await client`select email, is_active from users where email in ('rohit.negi@rdc.in', 'siddhesh.dige@rdc.in', 'shishir.bhat@rdc.in') order by email`;
console.log('Users found:', users.map((u) => `${u.email} (active=${u.is_active})`));

await client.end();
