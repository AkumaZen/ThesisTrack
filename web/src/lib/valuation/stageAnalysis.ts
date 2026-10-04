export interface Candle {
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface StageCriterion {
	label: string;
	pass: boolean;
	detail: string;
}

export interface StageAnalysisResult {
	stage: 'Stage 2 (Uptrend)' | 'Not in Stage 2' | 'Insufficient Data';
	score: number;
	totalCriteria: number;
	criteria: StageCriterion[];
	price: number;
	sma50: number | null;
	sma150: number | null;
	sma200: number | null;
	week52High: number;
	week52Low: number;
	pctFromHigh: number;
	pctAboveLow: number;
	breakoutSignal: boolean;
	breakoutDetail: string;
	dataPoints: number;
}

function sma(values: number[], period: number, endIndexExclusive: number): number | null {
	if (endIndexExclusive < period) return null;
	const slice = values.slice(endIndexExclusive - period, endIndexExclusive);
	return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * A rule-based approximation of Stan Weinstein's Stage Analysis, refined with Mark
 * Minervini's "Trend Template" criteria (daily 50/150/200-day MAs standing in for
 * Weinstein's original 10/30-week MAs — the standard daily-chart adaptation). Every
 * criterion cites the exact numbers behind it rather than asserting a verdict, since this
 * is a heuristic reading of price action, not a guarantee.
 */
export function computeStageAnalysis(
	candles: Candle[],
	niftyCandles: Candle[] | null
): StageAnalysisResult {
	const closes = candles.map((c) => c.close);
	const n = closes.length;
	const price = closes[n - 1];

	const sma50 = sma(closes, 50, n);
	const sma150 = sma(closes, 150, n);
	const sma200 = sma(closes, 200, n);
	const sma200Prior = sma(closes, 200, Math.max(0, n - 20));

	const lookback = candles.slice(-252);
	const week52High = Math.max(...lookback.map((c) => c.high));
	const week52Low = Math.min(...lookback.map((c) => c.low));
	const pctFromHigh = ((price - week52High) / week52High) * 100;
	const pctAboveLow = ((price - week52Low) / week52Low) * 100;

	const vol50 = candles.slice(-51, -1).map((c) => c.volume);
	const avgVol50 = vol50.length > 0 ? vol50.reduce((a, b) => a + b, 0) / vol50.length : null;
	const latestVolume = candles[n - 1]?.volume ?? 0;
	const volumeRatio = avgVol50 && avgVol50 > 0 ? latestVolume / avgVol50 : null;

	const last50High = candles.slice(-51, -1).length
		? Math.max(...candles.slice(-51, -1).map((c) => c.high))
		: -Infinity;
	const isNewHigh = price > last50High;

	const criteria: StageCriterion[] = [];

	criteria.push({
		label: 'Price above 150-day and 200-day moving averages',
		pass: sma150 != null && sma200 != null && price > sma150 && price > sma200,
		detail:
			sma150 != null && sma200 != null
				? `CMP ₹${price.toFixed(1)} vs 150-day MA ₹${sma150.toFixed(1)}, 200-day MA ₹${sma200.toFixed(1)}`
				: 'Not enough history for a 200-day average yet.'
	});

	criteria.push({
		label: '150-day MA above 200-day MA',
		pass: sma150 != null && sma200 != null && sma150 > sma200,
		detail:
			sma150 != null && sma200 != null
				? `150-day MA ₹${sma150.toFixed(1)} vs 200-day MA ₹${sma200.toFixed(1)}`
				: 'Not enough history.'
	});

	criteria.push({
		label: '200-day MA trending up',
		pass: sma200 != null && sma200Prior != null && sma200 > sma200Prior,
		detail:
			sma200 != null && sma200Prior != null
				? `200-day MA ₹${sma200.toFixed(1)} now vs ₹${sma200Prior.toFixed(1)} about a month ago`
				: 'Not enough history for a trend read on the 200-day average.'
	});

	criteria.push({
		label: 'Moving averages stacked 50 > 150 > 200 (proper uptrend order)',
		pass: sma50 != null && sma150 != null && sma200 != null && sma50 > sma150 && sma150 > sma200,
		detail:
			sma50 != null && sma150 != null && sma200 != null
				? `50-day ₹${sma50.toFixed(1)} / 150-day ₹${sma150.toFixed(1)} / 200-day ₹${sma200.toFixed(1)}`
				: 'Not enough history.'
	});

	criteria.push({
		label: 'At least 25% above 52-week low',
		pass: pctAboveLow >= 25,
		detail: `CMP is ${pctAboveLow.toFixed(1)}% above the 52-week low of ₹${week52Low.toFixed(1)}`
	});

	criteria.push({
		label: 'Within 25% of 52-week high',
		pass: pctFromHigh >= -25,
		detail: `CMP is ${Math.abs(pctFromHigh).toFixed(1)}% below the 52-week high of ₹${week52High.toFixed(1)}`
	});

	if (niftyCandles && niftyCandles.length > 20) {
		const niftyCloses = niftyCandles.map((c) => c.close);
		const rsWindow = Math.min(63, n - 1, niftyCloses.length - 1);
		const stockReturn = (price / closes[n - 1 - rsWindow] - 1) * 100;
		const niftyReturn =
			(niftyCloses[niftyCloses.length - 1] / niftyCloses[niftyCloses.length - 1 - rsWindow] - 1) *
			100;
		const rs = stockReturn - niftyReturn;
		criteria.push({
			label: 'Outperforming Nifty 50 over ~3 months',
			pass: rs > 0,
			detail: `Stock ${stockReturn >= 0 ? '+' : ''}${stockReturn.toFixed(1)}% vs Nifty ${niftyReturn >= 0 ? '+' : ''}${niftyReturn.toFixed(1)}% (relative strength ${rs >= 0 ? '+' : ''}${rs.toFixed(1)}pp)`
		});
	}

	const passed = criteria.filter((c) => c.pass).length;
	const lowConfidence = n < 200;
	const stage: StageAnalysisResult['stage'] = lowConfidence
		? 'Insufficient Data'
		: passed >= criteria.length - 1
			? 'Stage 2 (Uptrend)'
			: 'Not in Stage 2';

	const breakoutDetail = isNewHigh
		? volumeRatio != null && volumeRatio >= 1.5
			? `Closed at a new 50-day high on ${volumeRatio.toFixed(1)}x average volume — a textbook breakout day.`
			: `New 50-day high, but volume was only ${volumeRatio != null ? volumeRatio.toFixed(1) + 'x' : 'not available vs'} average — breakout lacks volume confirmation.`
		: 'No new 50-day high on the latest close.';

	return {
		stage,
		score: passed,
		totalCriteria: criteria.length,
		criteria,
		price,
		sma50,
		sma150,
		sma200,
		week52High,
		week52Low,
		pctFromHigh,
		pctAboveLow,
		breakoutSignal: isNewHigh && volumeRatio != null && volumeRatio >= 1.5,
		breakoutDetail,
		dataPoints: n
	};
}
