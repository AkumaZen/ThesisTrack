import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

const DB_TIMEOUT_MS = 3000;

/** Short commit id of the running build (set by Vercel), so it's clear which code is live. */
const commit = env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;

async function databaseUp(): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<false>((done) => (timer = setTimeout(() => done(false), DB_TIMEOUT_MS)));
	try {
		return await Promise.race([db.execute(sql`select 1`).then(() => true), timeout]);
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

// Public (no login), so it says only whether the database answers, never why it didn't.
export const GET: RequestHandler = async () => {
	const up = await databaseUp();
	return json(
		{ status: up ? 'ok' : 'error', database: up ? 'ok' : 'unreachable', commit },
		{ status: up ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
};
