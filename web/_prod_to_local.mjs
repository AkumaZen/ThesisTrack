// Dumps production DB (via pg_dump running inside the local postgres
// container, given production's DATABASE_URL through a --env-file so the
// secret never appears on a command line or in this script's stdout) and
// restores it into the local "thesis" database, replacing it entirely.
// Usage: node _prod_to_local.mjs <prodEnvFile>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [envPath] = process.argv.slice(2);
if (!envPath) {
	console.error('usage: node _prod_to_local.mjs <prodEnvFile>');
	process.exit(1);
}

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

const CONTAINER = 'thesistrack-postgres-1';
const tmpEnvFile = path.join(os.tmpdir(), `prod-db-${Date.now()}.env`);
fs.writeFileSync(tmpEnvFile, `DATABASE_URL=${url}\n`, { mode: 0o600 });

function run(args) {
	return execFileSync('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

const VOLUME = 'prod_migrate_tmp';
// Production is Postgres 18; the local container's pg_dump/pg_restore are
// only 16.x, which refuses to dump a newer server. Use a throwaway
// postgres:18 image purely for its client tools instead of touching the
// local container's version.
const TOOLS_IMAGE = 'postgres:18';

try {
	run(['volume', 'create', VOLUME]);

	console.log('Pulling postgres:18 client tools (first run only)...');
	run(['pull', TOOLS_IMAGE]);

	console.log('Dumping production database...');
	run([
		'run',
		'--rm',
		`--env-file=${tmpEnvFile}`,
		'-v',
		`${VOLUME}:/dump`,
		TOOLS_IMAGE,
		'sh',
		'-c',
		'pg_dump "$DATABASE_URL" -Fc -f /dump/prod_migrate.dump'
	]);

	console.log('Dump complete. Recreating local database...');
	run([
		'exec',
		CONTAINER,
		'psql',
		'-U',
		'thesis',
		'-d',
		'postgres',
		'-c',
		"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'thesis' AND pid <> pg_backend_pid();"
	]);
	run(['exec', CONTAINER, 'psql', '-U', 'thesis', '-d', 'postgres', '-c', 'DROP DATABASE IF EXISTS thesis;']);
	run(['exec', CONTAINER, 'psql', '-U', 'thesis', '-d', 'postgres', '-c', 'CREATE DATABASE thesis OWNER thesis;']);

	console.log('Restoring into local...');
	try {
		const restoreOut = run([
			'run',
			'--rm',
			`--network=container:${CONTAINER}`,
			'-e',
			'PGPASSWORD=thesis',
			'-v',
			`${VOLUME}:/dump`,
			TOOLS_IMAGE,
			'pg_restore',
			'-h',
			'localhost',
			'-U',
			'thesis',
			'-d',
			'thesis',
			'--no-owner',
			'/dump/prod_migrate.dump'
		]);
		console.log(restoreOut || '(restore produced no output)');
	} catch (err) {
		const stderr = err.stderr ? err.stderr.toString() : String(err);
		// pg18's dump includes `SET transaction_timeout = 0` (a pg18-only GUC),
		// which pg16's pg_restore doesn't recognize and logs as one ignored
		// error but otherwise proceeds - not a real failure of the data restore.
		if (stderr.includes('transaction_timeout') && stderr.includes('errors ignored on restore: 1')) {
			console.log('(restore hit the known pg18/pg16 transaction_timeout GUC warning - continuing)');
		} else {
			throw err;
		}
	}

	console.log('Verifying restore...');
	const verifyOut = run([
		'exec',
		CONTAINER,
		'psql',
		'-U',
		'thesis',
		'-d',
		'thesis',
		'-t',
		'-c',
		"SELECT (SELECT count(*) FROM companies) AS companies, (SELECT count(*) FROM thesis_versions) AS thesis_versions, (SELECT count(*) FROM users) AS users;"
	]);
	console.log(verifyOut);
	console.log('Done. Local database now mirrors production.');
} finally {
	fs.rmSync(tmpEnvFile, { force: true });
	try {
		run(['volume', 'rm', '-f', VOLUME]);
	} catch {}
}
