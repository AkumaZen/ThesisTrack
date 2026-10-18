import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readSegments, refreshSegments } from '$lib/valuation/server/segmentStore';

// GET: the stored segment table. POST: fetch it again from Screener (a write, so read-only accounts are refused).
export const GET: RequestHandler = async ({ params }) => json({ segments: await readSegments(params.symbol) });

export const POST: RequestHandler = async ({ params }) => {
	try {
		return json({ segments: await refreshSegments(params.symbol) });
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown error';
		error(message.startsWith('NOT_FOUND') ? 404 : 502, message);
	}
};
