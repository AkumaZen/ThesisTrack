import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { AnalysisError } from '$lib/valuation/concall/analysis';
import { analyseBatch, MAX_ANALYSES_PER_RUN, modelConfig, refreshBatch } from '$lib/valuation/server/concallJob';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 300 };

const body = z.object({
	mode: z.enum(['refresh', 'analyse']),
	limit: z.number().int().min(1).max(10).default(3),
	symbols: z.array(z.string().regex(/^[A-Z0-9&._-]{1,40}$/i).transform((s) => s.toUpperCase())).max(100).optional()
});

// One run at a time per server instance, so a double click cannot pay for the same transcript twice.
let running = false;

/**
 * The explicit "Refresh" (Screener + rules, no model) and "Analyse" (model, capped) actions. Each call
 * does a small, bounded batch and reports what is left, so the page repeats it until done: resumable
 * because finished transcripts are cached by content hash.
 */
export const POST: RequestHandler = async ({ request }) => {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid request.');
	if (running) error(429, 'A run is already in progress. Wait for it to finish.');
	running = true;
	try {
		const { mode, limit, symbols } = parsed.data;
		if (mode === 'refresh') return json({ mode, ...(await refreshBatch(Math.min(limit, 5), symbols)) });
		if (!modelConfig().key) error(503, 'The OpenAI key is not configured on the server.');
		return json({ mode, cap: MAX_ANALYSES_PER_RUN, ...(await analyseBatch(limit, symbols)) });
	} catch (e) {
		if (e instanceof AnalysisError) error(502, e.message);
		throw e;
	} finally {
		running = false;
	}
};
