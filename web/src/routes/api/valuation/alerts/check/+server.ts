import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runBreakoutChecks, runPriceChecks, runSectorChecks } from '$lib/server/alertChecks';

/** Runs checks on demand. scope: "price" (fast; falls back to last CMP when the market is
 *  closed) or "structural" (sector flips + breakouts; reads the warmed candle caches, so it can
 *  take a while if they're cold). */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { scope?: unknown } | null;
	const scope = body?.scope;
	if (scope === 'price') {
		return json({ summaries: [await runPriceChecks({ force: true })] });
	}
	if (scope === 'structural') {
		const sector = await runSectorChecks();
		const breakout = await runBreakoutChecks();
		return json({ summaries: [sector, breakout] });
	}
	error(400, 'scope must be "price" or "structural".');
};
