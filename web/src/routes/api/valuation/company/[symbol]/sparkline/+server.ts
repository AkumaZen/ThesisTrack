import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSparkline } from '$lib/valuation/server/sparklineCache';

// The watchlist Trend column's closes, read from the prices already stored for the company. Never
// calls Angel One. A missing series is a 404 with a `reason` so the page can tell "this company has
// no price source" (unlisted) from "not fetched yet" (not_stored, fixed by a refresh).
export const GET: RequestHandler = async ({ params }) => {
	try {
		const result = await getSparkline(params.symbol);
		if (result.kind === 'ok') return json({ closes: result.closes, fetchedAt: result.fetchedAt });
		const message =
			result.kind === 'unlisted'
				? `${params.symbol.toUpperCase()} isn't listed on Angel One (NSE equity only).`
				: `No prices are stored for ${params.symbol.toUpperCase()} yet.`;
		return json({ reason: result.kind, message }, { status: 404 });
	} catch (e) {
		error(502, e instanceof Error ? e.message : 'Unknown error');
	}
};
