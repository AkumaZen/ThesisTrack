/**
 * Stan Weinstein's Stage Analysis, adapted to daily NSE data (50-DMA standing in for
 * Weinstein's 10-week MA, 200-DMA for his 30-week MA), plus Mansfield-style relative strength
 * and automatic Stage 1 base/resistance detection. Isomorphic (client+server safe, no I/O) —
 * every function here takes already-fetched candle arrays and returns pure computed results,
 * the same convention as sectorRotation.ts, so it's independently unit-testable and reused
 * unchanged by both the scan engine (server) and any client-side display logic.
 */

export interface Candle {
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export type Stage =
	| 'Stage 1 Base'
	| 'Near Stage 2 Breakout'
	| 'Confirmed Stage 2 Breakout'
	| 'Stage 2 Advancing'
	| 'Stage 3'
	| 'Stage 4'
	| 'Not classified / insufficient data';

export type VolumeTier = 'Normal' | 'Elevated' | 'Breakout-confirmation';
export type Slope = 'rising' | 'falling' | 'flat';

export interface BaseInfo {
	support: number;
	resistance: number;
	/** Trading days from the earliest validated resistance touch to the latest closed candle. */
	durationDays: number;
	touches: number;
}

export interface BreakoutInfo {
	date: string;
	price: number;
	volumeRatio: number;
	/** Trading days between the breakout candle and the latest closed candle. */
	ageDays: number;
}

export interface StructuralResult {
	/** Date of the latest closed candle this result was computed from — the change-detection
	 *  key the caller uses to know whether a recompute is needed at all. */
	sourceDate: string;
	price: number;
	sma50: number | null;
	sma200: number | null;
	sma200Slope: Slope | null;
	base: BaseInfo | null;
	/** The most recent qualifying breakout found in this stock's history, if any — not
	 *  necessarily recent; see Stage's Confirmed vs Advancing split for how age is used. */
	breakout: BreakoutInfo | null;
	volumeTier: VolumeTier;
	volumeRatio: number | null;
	avgVolume20: number | null;
	volumeSurgeWarning: boolean;
	mansfieldRS: number | null;
	mansfieldRSTrend: Slope | null;
	stage: Stage;
	dataPoints: number;
	/** scanParamsKey() of the thresholds this was computed with (absent on older cache rows). */
	paramsKey?: string;
}

export interface LiveQuote {
	fetchedAt: number;
	livePrice: number;
	liveVolumeSoFar: number;
	/** 0..1, how far through today's trading session this quote was taken — needed to
	 *  pace-adjust volume-so-far before it's compared against a full day's average. */
	sessionFractionElapsed: number;
}

export interface StageScanResult extends StructuralResult {
	liveFetchedAt: number | null;
	/** Live price if a fresh-enough quote is available, else the last close. */
	effectivePrice: number;
	/** ((resistance - effectivePrice) / effectivePrice) * 100 — positive = still below
	 *  resistance, negative = already trading above it. Null if there's no valid base. */
	distanceToBreakoutPct: number | null;
	/** Pace-adjusted projection of today's full-day volume from volume-so-far — informational
	 *  only; the structural volumeRatio/volumeTier (from the last CLOSED candle) is what the
	 *  Confirmed Stage 2 Breakout classification actually relies on. */
	projectedVolume: number | null;
	/** True when effectivePrice > base.resistance but this hasn't (yet) registered as a
	 *  structurally confirmed breakout — i.e. "trading above resistance intraday, awaiting a
	 *  close that actually clears the clean-break margin on volume." */
	intradayAboveResistance: boolean;
}

// ---- Named thresholds (all in one place, each with the reasoning behind the number) ----

/** Local-high fractal width for pivot detection — a bar must be the highest of the 7-bar
 *  window (3 either side) to register as a pivot at all. */
const PIVOT_FRACTAL_BARS = 3;
/** Two pivots inside this window count as one touch, not two — this is what stops a single
 *  multi-day spike's shoulder bars from faking a "validated" resistance level. */
const MIN_TOUCH_SEPARATION_DAYS = 10;
/** Pivots within this % of each other cluster into the same candidate resistance level. */
const CLUSTER_TOLERANCE_PCT = 3;
/** A resistance cluster needs at least this many time-separated touches to count as a real,
 *  validated ceiling rather than a "random short-term high." */
const MIN_TOUCH_COUNT = 2;
/** How far back (in closed trading days) to look for pivots/a base at all. */
const BASE_LOOKBACK_DAYS = 130;
/** How far back to search for a qualifying historical breakout event. */
const BREAKOUT_SEARCH_DAYS = 150;
/** A breakout only reads as "Confirmed" (just happened) within this many closed trading days;
 *  older than this and the stock is just "Advancing" now. */
const CONFIRMED_BREAKOUT_WINDOW_DAYS = 3;
/** Lower edge of the "Near Stage 2 Breakout" band (slightly above resistance, unconfirmed). */
const NEAR_BREAKOUT_MIN_PCT = -2;

/** The thresholds an analyst can tune on the Settings page. The defaults are the values this
 *  scanner was built and tested with; each field's comment says what it controls. */
export interface ScanParams {
	/** Breakout-confirmation volume floor, vs the 20-day average. */
	breakoutVolumeRatio: number;
	/** Elevated-but-not-yet-confirming volume floor. */
	elevatedVolumeRatio: number;
	/** Early-warning threshold: last-5-day avg volume vs the preceding 20-day avg. */
	volumeSurgeRatio: number;
	/** First touch to now must span at least this many trading days (~6 weeks) to count as a
	 *  meaningful base, not a brief pause. */
	minBaseDurationDays: number;
	/** Reject a base whose (resistance-support)/support range is wider than this - wide chop
	 *  isn't a Weinstein-style tight consolidation. */
	baseMaxRangePct: number;
	/** A close must clear resistance by at least this % to count as a clean (not marginal/false)
	 *  breakout. */
	cleanBreakMarginPct: number;
	/** "Near Stage 2 Breakout" band: up to this far below resistance. */
	nearBreakoutMaxPct: number;
}

export const DEFAULT_SCAN_PARAMS: ScanParams = {
	breakoutVolumeRatio: 2.0,
	elevatedVolumeRatio: 1.5,
	volumeSurgeRatio: 1.3,
	minBaseDurationDays: 30,
	baseMaxRangePct: 30,
	cleanBreakMarginPct: 1.5,
	nearBreakoutMaxPct: 7
};

/** A short stable key for a set of params, stored with cached scan results so a settings change
 *  makes them recompute. */
export function scanParamsKey(p: ScanParams): string {
	return (Object.keys(DEFAULT_SCAN_PARAMS) as (keyof ScanParams)[]).map((k) => p[k]).join('|');
}

/** The params key a cached result was computed with. Results cached before settings existed
 *  carry none; they were computed with the defaults. */
export function resultParamsKey(r: Pick<StructuralResult, 'paramsKey'>): string {
	return r.paramsKey ?? scanParamsKey(DEFAULT_SCAN_PARAMS);
}

/** A slope read (%, over the ~20-trading-day comparison window) below this magnitude counts
 *  as "flat" rather than genuinely rising/falling — avoids noise flapping the classification. */
const SLOPE_FLAT_THRESHOLD_PCT = 0.5;
/** Mansfield RS uses a 200-trading-day SMA of the RS-ratio, matching this app's existing
 *  daily-200-DMA-for-30-week-SMA convention (Mansfield's original is a 52-week/weekly-chart
 *  figure — 200 trading days is the direct daily-chart equivalent). */
const MANSFIELD_RS_PERIOD = 200;
const MANSFIELD_RS_TREND_LOOKBACK_DAYS = 10;
const MANSFIELD_RS_TREND_THRESHOLD = 0.5;

// ---- Shared math ----

export function sma(values: number[], period: number, endIndexExclusive: number): number | null {
	if (endIndexExclusive < period) return null;
	const slice = values.slice(endIndexExclusive - period, endIndexExclusive);
	return slice.reduce((a, b) => a + b, 0) / period;
}

function slopeOf(current: number | null, prior: number | null): Slope | null {
	if (current == null || prior == null || prior === 0) return null;
	const pct = ((current - prior) / prior) * 100;
	if (pct > SLOPE_FLAT_THRESHOLD_PCT) return 'rising';
	if (pct < -SLOPE_FLAT_THRESHOLD_PCT) return 'falling';
	return 'flat';
}

// ---- Base / resistance detection ----

interface Pivot {
	index: number;
	price: number;
	date: string;
}

function findPivotHighs(candles: Candle[]): Pivot[] {
	const pivots: Pivot[] = [];
	for (let i = PIVOT_FRACTAL_BARS; i < candles.length - PIVOT_FRACTAL_BARS; i++) {
		const window = candles.slice(i - PIVOT_FRACTAL_BARS, i + PIVOT_FRACTAL_BARS + 1);
		const high = candles[i].high;
		if (high === Math.max(...window.map((c) => c.high))) {
			pivots.push({ index: i, price: high, date: candles[i].date });
		}
	}
	return pivots;
}

/** Collapses pivots that are within MIN_TOUCH_SEPARATION_DAYS of an already-kept pivot into a
 *  single touch (keeping the higher of the two) — a spike's shoulder bars must not count as
 *  two independent touches of a resistance level. */
function dedupeNearbyPivots(pivots: Pivot[]): Pivot[] {
	const sorted = [...pivots].sort((a, b) => a.index - b.index);
	const kept: Pivot[] = [];
	for (const p of sorted) {
		const last = kept[kept.length - 1];
		if (last && p.index - last.index < MIN_TOUCH_SEPARATION_DAYS) {
			if (p.price > last.price) kept[kept.length - 1] = p;
			continue;
		}
		kept.push(p);
	}
	return kept;
}

/** Detects the most recent Stage 1-style base: a validated (multiply-touched, time-separated,
 *  reasonably tight) resistance level plus the base's support and duration. Returns null when
 *  no cluster of pivots clears the touch-count/tightness/duration bars — i.e. this stock
 *  either isn't basing at all, or what looks like a high is just a one-off spike. */
export function detectBase(
	candles: Candle[],
	p: ScanParams = DEFAULT_SCAN_PARAMS
): BaseInfo | null {
	if (candles.length < p.minBaseDurationDays + PIVOT_FRACTAL_BARS * 2) return null;

	const windowStart = Math.max(0, candles.length - BASE_LOOKBACK_DAYS);
	const window = candles.slice(windowStart);
	const pivots = dedupeNearbyPivots(findPivotHighs(window));
	if (pivots.length < MIN_TOUCH_COUNT) return null;

	let best: { members: Pivot[]; resistance: number } | null = null;
	for (const center of pivots) {
		const members = pivots.filter(
			(p) => Math.abs(p.price - center.price) / center.price <= CLUSTER_TOLERANCE_PCT / 100
		);
		if (members.length < MIN_TOUCH_COUNT) continue;
		const resistance = Math.max(...members.map((m) => m.price));
		if (
			!best ||
			members.length > best.members.length ||
			(members.length === best.members.length &&
				Math.max(...members.map((m) => m.index)) > Math.max(...best.members.map((m) => m.index)))
		) {
			best = { members, resistance };
		}
	}
	if (!best) return null;

	const earliestTouchIndex = Math.min(...best.members.map((m) => m.index));
	const durationDays = window.length - 1 - earliestTouchIndex;
	if (durationDays < p.minBaseDurationDays) return null;

	const baseWindow = window.slice(earliestTouchIndex);
	const support = Math.min(...baseWindow.map((c) => c.low));
	const rangePct = ((best.resistance - support) / support) * 100;
	if (rangePct > p.baseMaxRangePct) return null;

	return {
		support,
		resistance: best.resistance,
		durationDays,
		touches: best.members.length
	};
}

/** Scans for the most recent closed-candle breakout above the base's resistance — a clean
 *  margin above it, on confirming volume. Returns null if the stock hasn't broken out
 *  (recently or otherwise) within the search window. */
export function findMostRecentBreakout(
	candles: Candle[],
	base: BaseInfo,
	p: ScanParams = DEFAULT_SCAN_PARAMS
): BreakoutInfo | null {
	const closes = candles.map((c) => c.close);
	const volumes = candles.map((c) => c.volume);
	const n = candles.length;
	const searchStart = Math.max(20, n - BREAKOUT_SEARCH_DAYS);

	for (let i = n - 1; i >= searchStart; i--) {
		const close = closes[i];
		if (close < base.resistance * (1 + p.cleanBreakMarginPct / 100)) continue;
		// Prior 20 days, excluding day i itself — comparing today's volume against a baseline
		// that doesn't include today avoids a self-referential (diluted) ratio.
		const avgVol = sma(volumes, 20, i);
		if (!avgVol || avgVol <= 0) continue;
		const volumeRatio = volumes[i] / avgVol;
		if (volumeRatio < p.breakoutVolumeRatio) continue;
		return { date: candles[i].date, price: close, volumeRatio, ageDays: n - 1 - i };
	}
	return null;
}

// ---- Volume ----

function volumeTierOf(ratio: number | null, p: ScanParams): VolumeTier {
	if (ratio == null) return 'Normal';
	if (ratio >= p.breakoutVolumeRatio) return 'Breakout-confirmation';
	if (ratio >= p.elevatedVolumeRatio) return 'Elevated';
	return 'Normal';
}

/** Early-warning signal distinct from the breakout-day volume check: volume has been quietly
 *  building over the last week relative to the prior month, even though price hasn't broken
 *  out yet. Only meaningful while still basing/approaching — the caller gates this to
 *  Stage 1 Base / Near Stage 2 Breakout. */
function hasVolumeSurge(volumes: number[], p: ScanParams): boolean {
	const n = volumes.length;
	if (n < 25) return false;
	const last5 = volumes.slice(n - 5);
	const prior20 = volumes.slice(n - 25, n - 5);
	const avgLast5 = last5.reduce((a, b) => a + b, 0) / 5;
	const avgPrior20 = prior20.reduce((a, b) => a + b, 0) / 20;
	if (avgPrior20 <= 0) return false;
	return avgLast5 / avgPrior20 >= p.volumeSurgeRatio;
}

// ---- Mansfield relative strength ----

export function computeMansfieldRS(
	stockCloses: number[],
	indexCloses: number[]
): { rs: number | null; trend: Slope | null } {
	const len = Math.min(stockCloses.length, indexCloses.length);
	if (len < MANSFIELD_RS_PERIOD + MANSFIELD_RS_TREND_LOOKBACK_DAYS)
		return { rs: null, trend: null };

	const s = stockCloses.slice(-len);
	const idx = indexCloses.slice(-len);
	const ratio = s.map((v, i) => (idx[i] > 0 ? (v / idx[i]) * 100 : NaN));

	const rsSeries: (number | null)[] = ratio.map((r, i) => {
		const avg = sma(ratio, MANSFIELD_RS_PERIOD, i + 1);
		return avg && Number.isFinite(r) ? (r / avg - 1) * 100 : null;
	});

	const current = rsSeries[rsSeries.length - 1];
	if (current == null) return { rs: null, trend: null };

	const prior = rsSeries[rsSeries.length - 1 - MANSFIELD_RS_TREND_LOOKBACK_DAYS] ?? null;
	const trend: Slope | null =
		prior == null
			? null
			: current - prior > MANSFIELD_RS_TREND_THRESHOLD
				? 'rising'
				: current - prior < -MANSFIELD_RS_TREND_THRESHOLD
					? 'falling'
					: 'flat';

	return { rs: current, trend };
}

// ---- Classifier ----

function classify(input: {
	dataPoints: number;
	price: number;
	sma200: number | null;
	sma50: number | null;
	sma200Slope: Slope | null;
	base: BaseInfo | null;
	breakout: BreakoutInfo | null;
	distanceToResistancePct: number | null;
	recentHigh20: number | null;
	params: ScanParams;
}): Stage {
	const {
		dataPoints,
		price,
		sma200,
		sma50,
		sma200Slope,
		base,
		breakout,
		distanceToResistancePct,
		recentHigh20,
		params
	} = input;

	if (dataPoints < 200 || sma200 == null) return 'Not classified / insufficient data';

	// Stage 4: long-term trend has clearly turned down and price is sustained below it.
	if (sma200Slope === 'falling' && price < sma200) return 'Stage 4';

	// Stage 3: only ever assigned to a stock with a real prior breakout in its history — a
	// stock that never broke out can't be "topping" out of an advance it never had.
	if (
		breakout &&
		sma200Slope !== 'rising' &&
		price >= sma200 * 0.95 &&
		recentHigh20 != null &&
		price < recentHigh20 * 0.95
	) {
		return 'Stage 3';
	}

	// Confirmed Stage 2 Breakout: a genuine closed-candle break, and it just happened.
	if (
		breakout &&
		breakout.ageDays <= CONFIRMED_BREAKOUT_WINDOW_DAYS &&
		price > sma200 &&
		sma200Slope !== 'falling'
	) {
		return 'Confirmed Stage 2 Breakout';
	}

	// Stage 2 Advancing: full trend-template holds, whether or not a dated breakout is still
	// within the "just happened" window.
	if (price > sma200 && sma50 != null && sma50 > sma200 && sma200Slope === 'rising') {
		return 'Stage 2 Advancing';
	}

	// Near Stage 2 Breakout: a validated base exists and price is close to (or marginally,
	// unconfirmed, through) its resistance.
	if (
		base &&
		distanceToResistancePct != null &&
		distanceToResistancePct <= params.nearBreakoutMaxPct &&
		distanceToResistancePct >= NEAR_BREAKOUT_MIN_PCT &&
		sma200Slope !== 'falling'
	) {
		return 'Near Stage 2 Breakout';
	}

	// Stage 1 Base: a validated base exists and the long-term trend has leveled off.
	if (base && sma200Slope === 'flat') return 'Stage 1 Base';

	return 'Not classified / insufficient data';
}

// ---- Top-level structural computation ----

/** Computes everything derivable from CLOSED daily candles alone — the expensive, cacheable
 *  part. `candles` must not include today's still-forming bar. `indexCloses` (NIFTY 500) is
 *  optional; Mansfield RS is simply null without it. */
export function computeStructuralResult(
	candles: Candle[],
	indexCloses: number[] | null,
	params: ScanParams = DEFAULT_SCAN_PARAMS
): StructuralResult {
	const closes = candles.map((c) => c.close);
	const volumes = candles.map((c) => c.volume);
	const n = closes.length;
	const price = closes[n - 1];

	const sma50 = sma(closes, 50, n);
	const sma200 = sma(closes, 200, n);
	const sma200Prior = sma(closes, 200, Math.max(0, n - 20));
	const sma200Slope = slopeOf(sma200, sma200Prior);

	// Prior 20 days, excluding today — same reasoning as the breakout-day check above.
	const avgVolume20 = sma(volumes, 20, n - 1);
	const volumeRatio = avgVolume20 && avgVolume20 > 0 ? volumes[n - 1] / avgVolume20 : null;
	const volumeTier = volumeTierOf(volumeRatio, params);

	const base = detectBase(candles, params);
	const breakout = base ? findMostRecentBreakout(candles, base, params) : null;

	const distanceToResistancePct = base ? ((base.resistance - price) / price) * 100 : null;
	const recentHigh20 = n >= 20 ? Math.max(...candles.slice(-20).map((c) => c.high)) : null;

	const stage = classify({
		dataPoints: n,
		price,
		sma200,
		sma50,
		sma200Slope,
		base,
		breakout,
		distanceToResistancePct,
		recentHigh20,
		params
	});

	const volumeSurgeWarning =
		(stage === 'Stage 1 Base' || stage === 'Near Stage 2 Breakout') &&
		hasVolumeSurge(volumes, params);

	const { rs: mansfieldRS, trend: mansfieldRSTrend } = indexCloses
		? computeMansfieldRS(closes, indexCloses)
		: { rs: null, trend: null };

	return {
		sourceDate: candles[n - 1].date,
		price,
		sma50,
		sma200,
		sma200Slope,
		base,
		breakout,
		volumeTier,
		volumeRatio,
		avgVolume20,
		volumeSurgeWarning,
		mansfieldRS,
		mansfieldRSTrend,
		stage,
		dataPoints: n,
		paramsKey: scanParamsKey(params)
	};
}

/** Merges the cheap live quote (today's LTP + volume-so-far) into a structural result. Never
 *  upgrades a stock to "Confirmed Stage 2 Breakout" on intraday movement alone — only flags
 *  `intradayAboveResistance` so the UI can show "trading above resistance, awaiting close"
 *  without the classifier itself treating an unclosed candle as a confirmed breakout. */
export function combineLiveOverlay(
	structural: StructuralResult,
	live: LiveQuote | null
): StageScanResult {
	const effectivePrice = live ? live.livePrice : structural.price;
	const distanceToBreakoutPct = structural.base
		? ((structural.base.resistance - effectivePrice) / effectivePrice) * 100
		: null;
	const projectedVolume =
		live && live.sessionFractionElapsed > 0
			? live.liveVolumeSoFar / live.sessionFractionElapsed
			: null;
	const intradayAboveResistance =
		structural.base != null && effectivePrice > structural.base.resistance;

	return {
		...structural,
		liveFetchedAt: live ? live.fetchedAt : null,
		effectivePrice,
		distanceToBreakoutPct,
		projectedVolume,
		intradayAboveResistance
	};
}
