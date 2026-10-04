export interface Candle {
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface SectorReturn {
	key: string;
	label: string;
	return1w: number | null;
	return1m: number | null;
	return3m: number | null;
	return6m: number | null;
	rs1w: number | null; // weekly (5 trading days): sector return minus Nifty return
	rs1m: number | null; // sector return minus Nifty return, same window
	rs3m: number | null;
	rs6m: number | null;
	signal: 'Rotating In' | 'Rotating Out' | 'Neutral';
	// Present only for custom thematic baskets (Data Centers, AI/GPU, etc.) that are a hand-picked
	// list of stocks rather than an official NSE index — lets the UI show what's inside on click.
	constituents?: string[];
	// Every sector's own price series, indexed to 100 on its first date — official NSE indices
	// use their own close price; custom baskets use their equal-weighted synthetic index. Both
	// go through the same normalization so every sector's card chart is on a comparable scale.
	series?: { date: string; value: number }[];
}

/** Trading-day lookback windows — approximate calendar equivalents (5/21/63/126/252 trading
 *  days), consistent with how the stage-analysis module already approximates a 3-month
 *  window as ~63 trading days. */
export const WINDOWS = { w1: 5, m1: 21, m3: 63, m6: 126, y1: 252 };

/** What makes a sector "Rotating In" / "Rotating Out" - tunable on the Settings page. The
 *  signal compares relative strength over a short, a medium and a long window (in trading days);
 *  `minRsPct` is how far the short-window RS must be above (or below) Nifty for the signal to
 *  fire at all, so a sector barely ahead of Nifty doesn't flicker in and out. */
export interface RotationParams {
	shortDays: number;
	midDays: number;
	longDays: number;
	minRsPct: number;
}

export const DEFAULT_ROTATION_PARAMS: RotationParams = {
	shortDays: WINDOWS.m1,
	midDays: WINDOWS.m3,
	longDays: WINDOWS.m6,
	minRsPct: 0
};

export function returnOverWindow(closes: number[], tradingDays: number): number | null {
	const n = closes.length;
	if (n <= tradingDays) return null;
	const past = closes[n - 1 - tradingDays];
	const latest = closes[n - 1];
	if (past <= 0) return null;
	return ((latest - past) / past) * 100;
}

/**
 * Ranks NSE sectoral indices by relative strength vs Nifty 50 across four lookback windows —
 * the standard sector-rotation read paid tools show, just without the RRG scatter-plot
 * visualization (a ranked table with the same underlying numbers). "Rotating In" means
 * relative-strength *momentum* is accelerating; "Rotating Out" is the mirror case.
 *
 * The signal compares each window's RS *per trading day* (rs / window length), not the raw
 * cumulative RS. Cumulative returns over nested windows of different lengths are not directly
 * comparable — even a sector outperforming Nifty by a constant amount per day will show
 * rs6m > rs3m > rs1m purely from compounding over a longer span, which would misread a
 * perfectly steady performer as "losing steam." Normalizing to a per-day rate isolates real
 * acceleration/deceleration from that window-length bias.
 */
export function computeSectorReturns(
	sectorCandles: { key: string; label: string; candles: Candle[] }[],
	niftyCandles: Candle[],
	params: RotationParams = DEFAULT_ROTATION_PARAMS
): SectorReturn[] {
	const niftyCloses = niftyCandles.map((c) => c.close);
	const niftyReturns = {
		w1: returnOverWindow(niftyCloses, WINDOWS.w1),
		m1: returnOverWindow(niftyCloses, WINDOWS.m1),
		m3: returnOverWindow(niftyCloses, WINDOWS.m3),
		m6: returnOverWindow(niftyCloses, WINDOWS.m6)
	};

	return sectorCandles.map(({ key, label, candles }) => {
		const closes = candles.map((c) => c.close);
		const return1w = returnOverWindow(closes, WINDOWS.w1);
		const return1m = returnOverWindow(closes, WINDOWS.m1);
		const return3m = returnOverWindow(closes, WINDOWS.m3);
		const return6m = returnOverWindow(closes, WINDOWS.m6);

		const rs1w = return1w != null && niftyReturns.w1 != null ? return1w - niftyReturns.w1 : null;
		const rs1m = return1m != null && niftyReturns.m1 != null ? return1m - niftyReturns.m1 : null;
		const rs3m = return3m != null && niftyReturns.m3 != null ? return3m - niftyReturns.m3 : null;
		const rs6m = return6m != null && niftyReturns.m6 != null ? return6m - niftyReturns.m6 : null;

		// The signal's own windows may differ from the displayed 1W/1M/3M/6M columns.
		const rsOver = (days: number) => {
			const r = returnOverWindow(closes, days);
			const n = returnOverWindow(niftyCloses, days);
			return r != null && n != null ? r - n : null;
		};
		const rsShort = rsOver(params.shortDays);
		const rsMid = rsOver(params.midDays);
		const rsLong = rsOver(params.longDays);

		let signal: SectorReturn['signal'] = 'Neutral';
		if (rsShort != null && rsMid != null && rsLong != null) {
			const rateShort = rsShort / params.shortDays;
			const rateMid = rsMid / params.midDays;
			const rateLong = rsLong / params.longDays;
			if (rateShort > rateMid && rateMid > rateLong && rsShort > params.minRsPct)
				signal = 'Rotating In';
			else if (rateShort < rateMid && rateMid < rateLong && rsShort < -params.minRsPct)
				signal = 'Rotating Out';
		}

		return { key, label, return1w, return1m, return3m, return6m, rs1w, rs1m, rs3m, rs6m, signal };
	});
}

/**
 * Builds a synthetic equal-weighted index series from a basket of stocks' own daily candles —
 * used for thematic baskets (Data Centers, AI/GPU, ...) that have no official NSE index, and
 * for rolling subsector baskets up into a major-sector composite.
 *
 * Chains each date's equal-weighted *daily return* (averaged only across constituents that
 * actually traded on both that date and the prior one) into a cumulative index, rather than
 * requiring every constituent to share the full date range. A recently-listed stock (e.g. one
 * that IPO'd a few months ago) simply doesn't contribute until its first trading date — it no
 * longer truncates the whole basket's window down to its own short history, which previously
 * meant one new listing could silently wipe out 3M/6M for an entire subsector or, worse,
 * cascade up and wipe out 3M/6M for the whole major sector it rolls into.
 */
export function buildEqualWeightedIndex(stockCandles: Candle[][]): Candle[] {
	const nonEmpty = stockCandles.filter((c) => c.length > 0);
	if (nonEmpty.length === 0) return [];

	const seriesByDate = nonEmpty.map((candles) => new Map(candles.map((c) => [c.date, c.close])));
	const allDates = [...new Set(seriesByDate.flatMap((m) => [...m.keys()]))].sort();

	const out: Candle[] = [];
	let level = 100;
	let prevCloses: (number | null)[] = seriesByDate.map(() => null);

	for (const date of allDates) {
		const currCloses = seriesByDate.map((m) => m.get(date) ?? null);
		if (out.length > 0) {
			const dailyReturns: number[] = [];
			currCloses.forEach((close, i) => {
				const prev = prevCloses[i];
				if (close != null && prev != null) dailyReturns.push(close / prev - 1);
			});
			if (dailyReturns.length > 0) {
				const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
				level *= 1 + avgReturn;
			}
			// No constituent traded on both this date and the prior one (a gap) — carry the level
			// forward flat rather than guessing a move.
		}
		out.push({ date, open: level, high: level, low: level, close: level, volume: 0 });
		prevCloses = currCloses;
	}

	return out;
}

/** Timeframes offered on a sector's constituent drill-down page — one shared control drives
 *  both which slice of each company's price history is charted and which window's % return
 *  is read as "the" growth number for that view. */
export const TIMEFRAMES = ['1W', '1M', '3M', '6M', '1Y'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const TIMEFRAME_WINDOWS: Record<Timeframe, number> = {
	'1W': WINDOWS.w1,
	'1M': WINDOWS.m1,
	'3M': WINDOWS.m3,
	'6M': WINDOWS.m6,
	'1Y': WINDOWS.y1
};

/** Slices a company's closing-price series down to the trading days a given timeframe covers,
 *  for charting — the full series (up to ~400 calendar days) is fetched once and re-sliced
 *  client-side per timeframe rather than re-fetched. */
export function sliceForTimeframe(closes: number[], timeframe: Timeframe): number[] {
	const tradingDays = TIMEFRAME_WINDOWS[timeframe];
	return closes.slice(-(tradingDays + 1));
}

export interface ConstituentGrowth {
	return1w: number | null;
	return1m: number | null;
	return3m: number | null;
	return6m: number | null;
	return1y: number | null;
}

/** All fixed-window returns for one company's constituent panel — shown together regardless of
 *  the selected chart timeframe, same dense "show every period at once" convention as the
 *  sector card stats row. */
export function computeConstituentGrowth(closes: number[]): ConstituentGrowth {
	return {
		return1w: returnOverWindow(closes, WINDOWS.w1),
		return1m: returnOverWindow(closes, WINDOWS.m1),
		return3m: returnOverWindow(closes, WINDOWS.m3),
		return6m: returnOverWindow(closes, WINDOWS.m6),
		return1y: returnOverWindow(closes, WINDOWS.y1)
	};
}
