import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { stageScanCache } from '$lib/server/db/valuationSchema';
import { getCompanySeries } from './companyGrowthSeries';
import { getNifty500Candles } from './nifty500Series';
import { fetchMarketDepth, type Candle } from './angelone';
import { isMarketOpenIST } from './marketHours';
import { getAnalysisSettings } from './analysisSettingsStore';
import {
	computeStructuralResult,
	combineLiveOverlay,
	scanParamsKey,
	resultParamsKey,
	type StructuralResult,
	type LiveQuote,
	type StageScanResult
} from '../stageScan';

// The live overlay's real freshness target — see LiveQuote/combineLiveOverlay in stageScan.ts
// for why this doesn't require re-fetching the full candle history on the same cadence.
const LIVE_TTL_MS = 10 * 60 * 1000;

function todayIST(now: Date = new Date()): string {
	// en-CA formats as YYYY-MM-DD, matching the date prefix Angel One's candle dates use.
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

/** Drops today's still-forming candle, if Angel One's historical endpoint included one — the
 *  structural layer must only ever see fully closed trading days. */
function closedCandlesOnly(candles: Candle[], now: Date = new Date()): Candle[] {
	const today = todayIST(now);
	return candles.filter((c) => c.date.slice(0, 10) !== today);
}

function sessionFractionElapsed(now: Date = new Date()): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Kolkata',
		hour: 'numeric',
		minute: 'numeric',
		hourCycle: 'h23'
	}).formatToParts(now);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	const minutesSinceMidnight = get('hour') * 60 + get('minute');
	const openAt = 9 * 60 + 15;
	const closeAt = 15 * 60 + 30;
	if (minutesSinceMidnight <= openAt) return 0;
	if (minutesSinceMidnight >= closeAt) return 1;
	return (minutesSinceMidnight - openAt) / (closeAt - openAt);
}

/**
 * CACHE -> READ -> CALCULATE -> RENDER for one symbol. The structural layer (base/resistance/
 * breakout/MAs/RS — from closed candles) is only ever recomputed when getCompanySeries()'s
 * latest closed-candle date has actually moved past what's already cached; in steady state
 * that candle cache is already kept warm by sectorRotationScheduler for this same universe, so
 * this is normally a cache hit with zero extra Angel One calls. The live overlay (today's LTP +
 * volume-so-far) refreshes independently on its own ~10-minute cadence via the much cheaper
 * quote endpoint, gated to market hours.
 */
export async function getStageScanResult(
	symbol: string,
	// Alert checks pass allowLive: false - they only need the structural stage, so they must not
	// trigger a live quote call for every symbol in the universe on each pass.
	options: { allowLive?: boolean } = {}
): Promise<StageScanResult | null> {
	const key = symbol.toUpperCase();
	const [row] = await db.select().from(stageScanCache).where(eq(stageScanCache.symbol, key));

	const candles = await getCompanySeries(key);
	if (!candles || candles.length === 0) return null;
	const closed = closedCandlesOnly(candles);
	if (closed.length === 0) return null;
	const latestClosedDate = closed[closed.length - 1].date.slice(0, 10);

	let structural: StructuralResult;
	let structuralComputedAt: number;

	// Recompute when a newer candle closed or the team changed the scanner settings.
	const params = (await getAnalysisSettings()).scan;
	const cachedStructural = row?.structural as StructuralResult | undefined;
	if (
		row &&
		row.structuralSourceDate === latestClosedDate &&
		cachedStructural != null &&
		resultParamsKey(cachedStructural) === scanParamsKey(params)
	) {
		structural = row.structural as StructuralResult;
		structuralComputedAt = row.structuralComputedAt;
	} else {
		const nifty500Closes = (await getNifty500Candles()).map((c) => c.close);
		structural = computeStructuralResult(closed, nifty500Closes, params);
		structuralComputedAt = Date.now();
	}

	let live: LiveQuote | null = (row?.live as LiveQuote | null) ?? null;
	const liveStale = !row?.liveFetchedAt || Date.now() - row.liveFetchedAt >= LIVE_TTL_MS;

	if (options.allowLive !== false && liveStale && isMarketOpenIST()) {
		try {
			const depth = await fetchMarketDepth(key);
			if (depth) {
				live = {
					fetchedAt: Date.now(),
					livePrice: depth.ltp,
					liveVolumeSoFar: depth.tradeVolume,
					sessionFractionElapsed: sessionFractionElapsed()
				};
			}
		} catch {
			// Live overlay is best-effort — fall back to whatever was already cached (or null)
			// rather than failing the whole scan for one symbol's quote hiccup.
		}
	}

	const result = combineLiveOverlay(structural, live);

	await db
		.insert(stageScanCache)
		.values({
			symbol: key,
			structural,
			structuralSourceDate: structural.sourceDate,
			structuralComputedAt,
			live,
			liveFetchedAt: live?.fetchedAt ?? null,
			stage: structural.stage,
			updatedAt: Date.now()
		})
		.onConflictDoUpdate({
			target: stageScanCache.symbol,
			set: {
				structural,
				structuralSourceDate: structural.sourceDate,
				structuralComputedAt,
				live,
				liveFetchedAt: live?.fetchedAt ?? null,
				stage: structural.stage,
				updatedAt: Date.now()
			}
		});

	return result;
}
