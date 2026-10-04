import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchDailyCandles, fetchIndexCandles } from '$lib/server/angelone';
import { BENCHMARK_INDEX } from '$lib/server/sectorIndices';
import { computeStageAnalysis } from '$lib/stageAnalysis';

export const GET: RequestHandler = async ({ params }) => {
	try {
		// 400 calendar days of buffer so the 200-day MA still has ~20 trading days of margin
		// behind it to check whether it's trending up (see computeStageAnalysis).
		const [candles, niftyCandles] = await Promise.all([
			fetchDailyCandles(params.symbol, 400),
			fetchIndexCandles(BENCHMARK_INDEX.token, 400).catch(() => null)
		]);

		if (!candles) {
			error(404, `${params.symbol} isn't listed on Angel One (NSE equity only).`);
		}
		if (candles.length < 10) {
			error(502, `Not enough price history returned for ${params.symbol} to analyze.`);
		}

		return json(computeStageAnalysis(candles, niftyCandles));
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // already a SvelteKit error()
		const message = e instanceof Error ? e.message : 'Unknown error';
		if (message === 'ANGEL_CREDENTIALS_MISSING') {
			error(500, 'Angel One API credentials are not configured on the server.');
		}
		error(502, message);
	}
};
