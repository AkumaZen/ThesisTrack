/**
 * Preset scans for the scanner page, the watchlist and the company page. Pure functions only:
 * `computePresetMetrics` turns closed daily candles into a handful of numbers (stored on the
 * stage scan result), and `passesPreset` / `matchedPresets` turn those numbers into a yes or no
 * per preset. Nothing here reads a database or the network.
 */
import type { Candle, Stage } from './stageScan';

export type PresetId =
	| 'stage2'
	| 'near-high'
	| 'volume-surge'
	| 'relative-strength'
	| 'fresh-breakout'
	| 'growth-stage2';

// ---- Named thresholds ----

/** Trading days in a 52-week window. */
const WEEKS_52_SESSIONS = 252;
/** A 52-week high needs most of a year of history to mean anything. */
export const MIN_SESSIONS_52W = 200;
/** "Near the 52-week high": the close is at most this far (%) below it. */
export const NEAR_HIGH_PCT = 5;
/** Volume surge: latest volume vs the average of the 50 sessions before it. */
export const VOLUME_AVG_SESSIONS = 50;
export const VOLUME_SURGE_RATIO = 2;
/** Return windows in trading days: about 3 and 6 months. */
export const RETURN_3M_SESSIONS = 63;
export const RETURN_6M_SESSIONS = 126;
/** Relative strength vs Nifty 500: beat it by at least this many points over BOTH windows. */
export const RS_EXCESS_POINTS = 5;
/** Relative strength by rank inside our universe (no index stored): top fifth on BOTH windows. */
export const RS_UNIVERSE_PERCENTILE = 80;
/** A fresh breakout closed above the prior 50-day high within the last 3 sessions (age 0 to 2). */
export const BREAKOUT_HIGH_SESSIONS = 50;
export const FRESH_BREAKOUT_SESSIONS = 2;
/** Growth: latest quarter vs the same quarter a year earlier, both sales and net profit. */
export const GROWTH_MIN_YOY_PCT = 15;

export interface PresetMetrics {
	/** Closed sessions the numbers came from. */
	sessions: number;
	close: number;
	prevClose: number | null;
	/** Highest intraday high of the last 252 sessions (fewer if that is all there is). */
	high52: number | null;
	volume: number;
	/** Average volume of the 50 sessions before the latest; null with fewer than 51 sessions. */
	avgVolume50: number | null;
	/** Sessions since the close last cleared the prior 50-day high, within the fresh window; else null. */
	breakoutAge: number | null;
	breakoutLevel: number | null;
	/** Price change in % over about 3 and 6 months; null with too little history. */
	ret3m: number | null;
	ret6m: number | null;
	/** The Nifty 500 over the same windows; null when no index series is stored. */
	bench3m: number | null;
	bench6m: number | null;
}

function pctChange(series: number[], sessions: number): number | null {
	const n = series.length;
	if (n <= sessions) return null;
	const then = series[n - 1 - sessions];
	const now = series[n - 1];
	if (!(then > 0) || !Number.isFinite(now)) return null;
	return (now / then - 1) * 100;
}

/** `candles` are CLOSED days in date order (no forming bar). Null when there are none. */
export function computePresetMetrics(candles: Candle[], indexCloses: number[] | null): PresetMetrics | null {
	const n = candles.length;
	if (n === 0) return null;
	const closes = candles.map((c) => c.close);
	const last = candles[n - 1];

	const high52 = Math.max(...candles.slice(-WEEKS_52_SESSIONS).map((c) => c.high));

	let avgVolume50: number | null = null;
	if (n > VOLUME_AVG_SESSIONS) {
		const prior = candles.slice(n - 1 - VOLUME_AVG_SESSIONS, n - 1);
		avgVolume50 = prior.reduce((s, c) => s + (c.volume || 0), 0) / VOLUME_AVG_SESSIONS;
	}

	let breakoutAge: number | null = null;
	let breakoutLevel: number | null = null;
	for (let age = 0; age <= FRESH_BREAKOUT_SESSIONS; age++) {
		const i = n - 1 - age;
		if (i < BREAKOUT_HIGH_SESSIONS) break;
		const level = Math.max(...candles.slice(i - BREAKOUT_HIGH_SESSIONS, i).map((c) => c.high));
		if (candles[i].close > level) {
			breakoutAge = age;
			breakoutLevel = level;
			break;
		}
	}

	return {
		sessions: n,
		close: last.close,
		prevClose: n > 1 ? candles[n - 2].close : null,
		high52: Number.isFinite(high52) ? high52 : null,
		volume: last.volume || 0,
		avgVolume50,
		breakoutAge,
		breakoutLevel,
		ret3m: pctChange(closes, RETURN_3M_SESSIONS),
		ret6m: pctChange(closes, RETURN_6M_SESSIONS),
		bench3m: indexCloses ? pctChange(indexCloses, RETURN_3M_SESSIONS) : null,
		bench6m: indexCloses ? pctChange(indexCloses, RETURN_6M_SESSIONS) : null
	};
}

// ---- Quarterly growth ----

export interface QuarterRow {
	label: string; // "Jun 2026"
	sales: number | null;
	netProfit: number | null;
}

export interface QuarterlyGrowth {
	label: string;
	salesYoY: number | null;
	profitYoY: number | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Jun 2026" -> a running month number, or null when the label is not that shape. */
export function monthIndex(label: string): number | null {
	const m = /^([A-Za-z]{3})\w*\s+(\d{4})$/.exec(label.trim());
	if (!m) return null;
	const month = MONTHS.indexOf(m[1].toLowerCase());
	return month < 0 ? null : Number(m[2]) * 12 + month;
}

export function growthPct(now: number | null, then: number | null): number | null {
	if (now == null || then == null || !(then > 0)) return null;
	return (now / then - 1) * 100;
}

/** Latest quarter against the same quarter a year before. Null when the series has no quarter
 *  exactly 12 months earlier (too short, or a gap in the labels). */
export function quarterlyGrowth(quarters: QuarterRow[] | null | undefined): QuarterlyGrowth | null {
	if (!quarters || quarters.length < 5) return null;
	const latest = quarters[quarters.length - 1];
	const yearAgo = quarters[quarters.length - 5];
	const a = monthIndex(latest.label);
	const b = monthIndex(yearAgo.label);
	if (a == null || b == null || a - b !== 12) return null;
	return {
		label: latest.label,
		salesYoY: growthPct(latest.sales, yearAgo.sales),
		profitYoY: growthPct(latest.netProfit, yearAgo.netProfit)
	};
}

// ---- Presets ----

export interface PresetDef {
	id: PresetId;
	label: string;
	description: string;
}

export const PRESETS: PresetDef[] = [
	{ id: 'stage2', label: 'Stage 2', description: 'Weinstein Stage 2: advancing, or a confirmed breakout.' },
	{
		id: 'near-high',
		label: 'Near 52-week high',
		description: `Close within ${NEAR_HIGH_PCT}% of the 52-week high (needs ${MIN_SESSIONS_52W}+ sessions).`
	},
	{
		id: 'volume-surge',
		label: 'Volume surge',
		description: `Latest volume at least ${VOLUME_SURGE_RATIO}x the average of the ${VOLUME_AVG_SESSIONS} sessions before it.`
	},
	{
		id: 'relative-strength',
		label: 'Relative strength',
		description: `Beats the Nifty 500 by ${RS_EXCESS_POINTS}+ points over 3 and 6 months. Without a stored index: top ${100 - RS_UNIVERSE_PERCENTILE}% of our universe on both.`
	},
	{
		id: 'fresh-breakout',
		label: 'Fresh breakout',
		description: `Closed above the prior ${BREAKOUT_HIGH_SESSIONS}-day high in the last ${FRESH_BREAKOUT_SESSIONS + 1} sessions and still above it.`
	},
	{
		id: 'growth-stage2',
		label: 'Growth + Stage 2',
		description: `Stage 2 with latest quarter sales and net profit both up ${GROWTH_MIN_YOY_PCT}%+ on a year earlier (needs stored quarterly results).`
	}
];

export const presetLabel = (id: PresetId) => PRESETS.find((p) => p.id === id)?.label ?? id;

export interface PresetInput {
	stage: Stage | null;
	metrics: PresetMetrics | null | undefined;
	growth?: QuarterlyGrowth | null;
	/** Percentile (0-100) of the 3 and 6 month returns inside the scanned universe. Only used
	 *  when metrics carry no index returns. */
	universeRank?: { r3m: number; r6m: number } | null;
}

export type RsBasis = 'nifty500' | 'universe';

export function rsBasis(m: PresetMetrics | null | undefined): RsBasis {
	return m && m.bench3m != null && m.bench6m != null ? 'nifty500' : 'universe';
}

const isStage2 = (s: Stage | null) => s === 'Stage 2 Advancing' || s === 'Confirmed Stage 2 Breakout';

export function passesPreset(id: PresetId, input: PresetInput): boolean {
	const m = input.metrics;
	switch (id) {
		case 'stage2':
			return isStage2(input.stage);
		case 'near-high': {
			if (!m || m.sessions < MIN_SESSIONS_52W || !m.high52 || !(m.high52 > 0)) return false;
			return ((m.high52 - m.close) / m.high52) * 100 <= NEAR_HIGH_PCT;
		}
		case 'volume-surge':
			return (
				!!m &&
				m.volume > 0 &&
				m.avgVolume50 != null &&
				m.avgVolume50 > 0 &&
				m.volume >= VOLUME_SURGE_RATIO * m.avgVolume50
			);
		case 'relative-strength': {
			if (!m || m.ret3m == null || m.ret6m == null) return false;
			if (rsBasis(m) === 'nifty500') {
				return (
					m.ret3m - (m.bench3m as number) >= RS_EXCESS_POINTS &&
					m.ret6m - (m.bench6m as number) >= RS_EXCESS_POINTS
				);
			}
			const r = input.universeRank;
			return !!r && r.r3m >= RS_UNIVERSE_PERCENTILE && r.r6m >= RS_UNIVERSE_PERCENTILE;
		}
		case 'fresh-breakout':
			return !!m && m.breakoutAge != null && m.breakoutLevel != null && m.close >= m.breakoutLevel;
		case 'growth-stage2': {
			const g = input.growth;
			return (
				isStage2(input.stage) &&
				!!g &&
				g.salesYoY != null &&
				g.profitYoY != null &&
				g.salesYoY >= GROWTH_MIN_YOY_PCT &&
				g.profitYoY >= GROWTH_MIN_YOY_PCT
			);
		}
	}
}

export function matchedPresets(input: PresetInput): PresetId[] {
	return PRESETS.map((p) => p.id).filter((id) => passesPreset(id, input));
}

/** Percentile rank (0-100) of each value among the non-null ones; ties share the lower rank. */
export function percentileRanks(values: Map<string, number | null>): Map<string, number> {
	const sorted = [...values.values()]
		.filter((v): v is number => v != null && Number.isFinite(v))
		.sort((a, b) => a - b);
	const out = new Map<string, number>();
	if (sorted.length === 0) return out;
	for (const [key, v] of values) {
		if (v == null || !Number.isFinite(v)) continue;
		let below = 0;
		while (below < sorted.length && sorted[below] < v) below++;
		out.set(key, sorted.length === 1 ? 100 : (below / (sorted.length - 1)) * 100);
	}
	return out;
}

const num = (n: number, d = 1) => n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const signedNum = (n: number, d = 1) => `${n > 0 ? '+' : ''}${num(n, d)}`;

/** One short line of evidence for a preset, for the scanner's detail column. Empty when the
 *  numbers it needs are missing. */
export function presetDetail(id: PresetId, input: PresetInput): string {
	const m = input.metrics;
	switch (id) {
		case 'stage2':
			return input.stage ?? '';
		case 'near-high':
			return m?.high52 && m.high52 > 0
				? `${num(((m.high52 - m.close) / m.high52) * 100)}% below 52W high ${num(m.high52, 2)}`
				: '';
		case 'volume-surge':
			return m && m.avgVolume50 && m.avgVolume50 > 0
				? `${num(m.volume / m.avgVolume50)}x the 50D average volume`
				: '';
		case 'relative-strength': {
			if (!m || m.ret3m == null || m.ret6m == null) return '';
			if (rsBasis(m) === 'nifty500') {
				return `vs Nifty 500: ${signedNum(m.ret3m - (m.bench3m as number))} pts 3M, ${signedNum(m.ret6m - (m.bench6m as number))} pts 6M`;
			}
			const r = input.universeRank;
			return r
				? `Universe rank (no index stored): ${num(r.r3m, 0)}th pct 3M, ${num(r.r6m, 0)}th pct 6M`
				: `Return ${signedNum(m.ret3m)}% 3M, ${signedNum(m.ret6m)}% 6M`;
		}
		case 'fresh-breakout':
			return m && m.breakoutAge != null && m.breakoutLevel != null
				? `${m.breakoutAge === 0 ? 'Latest close' : `${m.breakoutAge}d ago`} above 50D high ${num(m.breakoutLevel, 2)}`
				: '';
		case 'growth-stage2': {
			const g = input.growth;
			return g && g.salesYoY != null && g.profitYoY != null
				? `${g.label}: sales ${signedNum(g.salesYoY)}%, profit ${signedNum(g.profitYoY)}% YoY`
				: '';
		}
	}
}
