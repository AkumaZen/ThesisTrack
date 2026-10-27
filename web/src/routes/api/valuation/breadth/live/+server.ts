import { json, error } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { recomputeBreadthDma } from '$lib/valuation/server/breadthDmaStore';
import { refreshBreadth } from '$lib/valuation/server/breadthStore';
import { BATCH_SIZE } from '$lib/valuation/server/batchRefresh';
import { loadLiveContext, noteManualRefresh, refreshLiveBatch } from '$lib/valuation/server/intradayPrices';

// The "Refresh breadth" button: the page walks the same symbol list the background pass uses, one
// POST per batch of 50 (one Angel One quote request each), then asks for the two recomputes. Steps:
//   { step: 'plan' }               -> the symbols to walk
//   { step: 'batch', symbols }     -> live quotes for them into the price series and the breadth closes
//   { step: 'cards' | 'market' }   -> recompute the table/cards, or the whole-market chart
// A write, so read-only accounts are refused by the access policy (lib/access.ts). Each batch marks the
// background pass busy, like Refresh all sectors, so the two never fight over the quotes.
export const config: Config = { maxDuration: 120 };

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { step?: unknown; symbols?: unknown } | null;
	try {
		switch (body?.step) {
			case 'plan': {
				await noteManualRefresh().catch(() => {});
				const { symbols } = await loadLiveContext();
				return json({ symbols, batchSize: BATCH_SIZE });
			}
			case 'batch': {
				const symbols = body.symbols;
				if (!Array.isArray(symbols) || symbols.length === 0 || !symbols.every((s) => typeof s === 'string' && s.trim())) {
					error(400, 'symbols must be a non-empty list of tickers.');
				}
				if (symbols.length > BATCH_SIZE) error(400, `At most ${BATCH_SIZE} symbols per request.`);
				await noteManualRefresh().catch(() => {});
				const { ctx } = await loadLiveContext();
				const batch = [...new Set((symbols as string[]).map((s) => s.trim().toUpperCase()))];
				return json(await refreshLiveBatch(batch, ctx));
			}
			case 'cards':
				return json(await refreshBreadth());
			case 'market':
				return json(await recomputeBreadthDma());
			default:
				error(400, 'step must be plan, batch, cards or market.');
		}
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		const message = e instanceof Error ? e.message : 'Unknown error';
		error(message === 'ANGEL_CREDENTIALS_MISSING' ? 500 : 502, message);
	}
};
