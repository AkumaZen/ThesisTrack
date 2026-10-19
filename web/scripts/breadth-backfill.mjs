// Runs the whole-market breadth history backfill by calling /api/cron/breadth-backfill in a loop until
// every NSE equity has its daily closes stored (each call is one resumable slice).
//
//   node scripts/breadth-backfill.mjs [--base http://localhost:5173] [--budget 240000] [--retry] [--rebuild]
//
// The server needs the Angel One credentials and CRON_SECRET (web/.env locally). CRON_SECRET is read from
// the same .env (or the CRON_SECRET environment variable) and is never printed. --retry also retries
// symbols whose last fetch failed; --rebuild refetches everything. Progress is stored in the
// database, so an interrupted run can simply be started again.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

function readSecret() {
	if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
	const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
	if (!existsSync(file)) return null;
	for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
		const m = /^\s*CRON_SECRET\s*=\s*(.*)$/.exec(line);
		if (m) return m[1].trim().replace(/^["']|["']$/g, '');
	}
	return null;
}

const base = value('base', 'http://localhost:5173').replace(/\/$/, '');
const budget = value('budget', '240000');
const secret = readSecret();
if (!secret) {
	console.error('CRON_SECRET is not set (web/.env or the environment).');
	process.exit(1);
}

const started = Date.now();
let rebuild = flag('rebuild');
for (let slice = 1; ; slice++) {
	const query = new URLSearchParams({ budget });
	if (flag('retry')) query.set('retry', '1');
	if (rebuild) query.set('rebuild', '1');
	rebuild = false; // only the first slice resets the statuses
	const res = await fetch(`${base}/api/cron/breadth-backfill?${query}`, {
		headers: { authorization: `Bearer ${secret}` }
	});
	const body = await res.json().catch(() => null);
	if (!res.ok || !body) {
		console.error(`Slice ${slice} failed: HTTP ${res.status} ${body?.message ?? ''}`);
		process.exit(1);
	}
	console.log(
		`slice ${slice}: processed ${body.processed} (done ${body.done}, empty ${body.empty}, failed ${body.failed}), ` +
			`remaining ${body.remaining} of ${body.universe}, ${(body.ms / 1000).toFixed(0)} s`
	);
	if (body.aborted) {
		console.error(`Stopped: ${body.aborted}`);
		process.exit(1);
	}
	if (body.finished) {
		if (body.aggregate) console.log(`aggregate: ${body.aggregate.rows} days, latest ${body.aggregate.latest}`);
		console.log(`finished in ${((Date.now() - started) / 60000).toFixed(1)} min`);
		break;
	}
	if (body.processed === 0) {
		console.error('No progress in a slice; stopping.');
		process.exit(1);
	}
}
