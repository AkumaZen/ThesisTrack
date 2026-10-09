// Reads the production URL from the given env file via _prod_db.mjs - never logs it.
// Diagnostic only, no writes. Checks for every migration (0003-0007) that
// could plausibly not have been reconciled to production yet, per the
// recurring "migration file committed but never applied to prod" gotcha.
import postgres from 'postgres';
import { productionDatabaseUrl } from './_prod_db.mjs';

const envPath = process.argv[2];
const url = productionDatabaseUrl(envPath);

const client = postgres(url, { max: 1, ssl: 'require' });

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
