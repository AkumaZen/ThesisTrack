// Strength & Volume signals - pure maths, no I/O. The Strength & Volume filter panel and the saved
// alert rules both call evaluateStrength(), so what a filter shows and what an alert fires on can
// never disagree.
//
// Everything is measured on COMPLETE daily sessions aligned to the Nifty 50 calendar. These are
// price and trading-activity readings, not business growth and not a forecast.
//
// A signal that cannot be computed (short history, stale or missing data) is reported as
// 'unavailable' with the reason and never counts as a match.

/** Fewest baseline readings a z-score is computed from. A short-history stock (a recent listing)
 *  may have fewer than the full baseline; between this and the full length it is still evaluated
 *  and the note says the baseline is short. */
export const MIN_SAMPLES_FOR_Z = 20;
/** Floor on the baseline spread (in percentage points) so a near-flat history cannot turn a tiny
 *  move into a huge z-score. */
export const MIN_SIGMA_PTS = 0.25;
/** Share of a window's sessions that must carry usable data for a constituent to be counted. */
const MIN_WINDOW_COVERAGE = 0.8;
/** Breadth over fewer stocks than this is just one or two yes/no answers, not participation. */
export const MIN_SPREADING_STOCKS = 3;

export interface StrengthConfig {
	/** Measurement period in sessions for sudden strength: 1 daily, 5 weekly, 21 monthly, or custom. */
	periodDays: number;
	/** Sessions of history that define "normal" for sudden strength. The measured window is excluded. */
	baselineDays: number;
	/** How the enabled PRICE signals combine. Volume confirmation is separate (below). */
	match: 'any' | 'all';
	sudden: {
		enabled: boolean;
		mode: 'adaptive' | 'explicit';
		/** Adaptive: how many robust standard deviations above the baseline median. */
		z: number;
		/** Adaptive: the m-day relative strength must also be at least this many points. */
		minRsPct: number;
		/** Explicit: the m-day relative strength must be at least this many points. */
		explicitRsPct: number;
	};
	gradual: {
		enabled: boolean;
		days: number;
		/** Sessions (out of `days`) where the subject beat Nifty. */
		minImprovingSessions: number;
		/** Total relative gain over the window, in percent. */
		minGainPct: number;
		/** The biggest single day may account for at most this share of the gain. */
		maxSingleDayShare: number;
	};
	spreading: {
		enabled: boolean;
		days: number;
		minBreadthPct: number;
		minChangePts: number;
	};
	volume: {
		/** Optional: when on alongside a price signal it must also hold; on its own it is a signal. */
		enabled: boolean;
		days: number;
		baselineDays: number;
		minRatio: number;
	};
}

export const DEFAULT_STRENGTH_CONFIG: StrengthConfig = {
	periodDays: 5,
	baselineDays: 126,
	match: 'any',
	sudden: { enabled: false, mode: 'adaptive', z: 2, minRsPct: 1, explicitRsPct: 5 },
	gradual: {
		enabled: false,
		days: 10,
		minImprovingSessions: 6,
		minGainPct: 1,
		maxSingleDayShare: 0.5
	},
	spreading: { enabled: false, days: 10, minBreadthPct: 60, minChangePts: 10 },
	volume: { enabled: false, days: 5, baselineDays: 20, minRatio: 1.5 }
};

export const PERIOD_PRESETS = [
	{ label: 'Daily', days: 1 },
	{ label: 'Weekly', days: 5 },
	{ label: 'Monthly', days: 21 }
] as const;

const clampNum = (v: unknown, min: number, max: number, fallback: number): number => {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
	Math.round(clampNum(v, min, max, fallback));
const asObj = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Turns anything (a stored document, a query string) into a valid config: unknown fields are
 *  dropped, numbers are clamped to sane ranges, missing fields take the defaults. */
export function parseStrengthConfig(raw: unknown): StrengthConfig {
	const d = DEFAULT_STRENGTH_CONFIG;
	const r = asObj(raw);
	const s = asObj(r.sudden);
	const g = asObj(r.gradual);
	const p = asObj(r.spreading);
	const v = asObj(r.volume);
	const gradualDays = clampInt(g.days, 3, 60, d.gradual.days);
	return {
		periodDays: clampInt(r.periodDays, 1, 63, d.periodDays),
		baselineDays: clampInt(r.baselineDays, 30, 252, d.baselineDays),
		match: r.match === 'all' ? 'all' : 'any',
		sudden: {
			enabled: s.enabled === true,
			mode: s.mode === 'explicit' ? 'explicit' : 'adaptive',
			z: clampNum(s.z, 0.5, 6, d.sudden.z),
			minRsPct: clampNum(s.minRsPct, 0, 50, d.sudden.minRsPct),
			explicitRsPct: clampNum(s.explicitRsPct, 0.1, 100, d.sudden.explicitRsPct)
		},
		gradual: {
			enabled: g.enabled === true,
			days: gradualDays,
			minImprovingSessions: clampInt(
				g.minImprovingSessions,
				1,
				gradualDays,
				Math.min(d.gradual.minImprovingSessions, gradualDays)
			),
			minGainPct: clampNum(g.minGainPct, 0, 50, d.gradual.minGainPct),
			maxSingleDayShare: clampNum(g.maxSingleDayShare, 0.1, 1, d.gradual.maxSingleDayShare)
		},
		spreading: {
			enabled: p.enabled === true,
			days: clampInt(p.days, 3, 63, d.spreading.days),
			minBreadthPct: clampNum(p.minBreadthPct, 10, 100, d.spreading.minBreadthPct),
			minChangePts: clampNum(p.minChangePts, 0, 100, d.spreading.minChangePts)
		},
		volume: {
			enabled: v.enabled === true,
			days: clampInt(v.days, 1, 63, d.volume.days),
			baselineDays: clampInt(v.baselineDays, 5, 126, d.volume.baselineDays),
			minRatio: clampNum(v.minRatio, 1, 20, d.volume.minRatio)
		}
	};
}

/** Whether a config filters anything at all (at least one signal switched on). */
export function isStrengthActive(c: StrengthConfig, kind: SubjectKind = 'group'): boolean {
	return (
		c.sudden.enabled ||
		c.gradual.enabled ||
		(kind === 'group' && c.spreading.enabled) ||
		c.volume.enabled
	);
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export type SubjectKind = 'group' | 'company';

/** One stock's closes and volumes aligned to the benchmark calendar; null = no usable bar. */
export interface Member {
	closes: (number | null)[];
	volumes: (number | null)[];
}

export interface StrengthInput {
	/** Ascending session dates (YYYY-MM-DD), complete sessions only. */
	calendar: string[];
	/** Nifty 50 closes on that calendar. */
	benchmark: (number | null)[];
	/** The subject's price level on that calendar: an index for a group, the close for a company. */
	price: (number | null)[];
	/** Group: its constituent stocks. Company: just itself (used for volume). */
	members: Member[];
	kind: SubjectKind;
}

export interface StockCandle {
	date: string;
	close: number;
	volume: number;
}

/** Aligns candles to the calendar. A session with no candle, or a non-positive close, is null;
 *  a zero volume is treated as missing, not as "no trading". */
export function alignMember(candles: StockCandle[], calendar: string[]): Member {
	const byDate = new Map(candles.map((c) => [c.date.slice(0, 10), c]));
	const closes: (number | null)[] = [];
	const volumes: (number | null)[] = [];
	for (const date of calendar) {
		const c = byDate.get(date);
		closes.push(c && c.close > 0 ? c.close : null);
		volumes.push(c && c.volume > 0 ? c.volume : null);
	}
	return { closes, volumes };
}

/** The latest session date whose bar is final. The exchange closes at 15:30 IST; bars from today
 *  are only trusted from 16:00 IST, so a half-finished day never reaches a signal. */
export function lastCompleteSessionDate(now: Date = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Kolkata',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(now);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	const today = `${get('year')}-${get('month')}-${get('day')}`;
	const minutes = Number(get('hour')) * 60 + Number(get('minute'));
	if (minutes >= 16 * 60) return today;
	const y = new Date(`${today}T00:00:00Z`);
	y.setUTCDate(y.getUTCDate() - 1);
	return y.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export interface SignalResult {
	status: 'off' | 'unavailable' | 'ok';
	matched: boolean;
	/** One line for the UI and the alert: why it matched, or why it is unavailable. */
	detail: string;
	metrics: Record<string, number>;
}

export interface StrengthEvaluation {
	/** False when no signal is switched on - nothing is filtered. */
	active: boolean;
	matched: boolean;
	asOf: string | null;
	signals: {
		sudden: SignalResult;
		gradual: SignalResult;
		spreading: SignalResult;
		volume: SignalResult;
	};
	/** The explanations of the signals that matched, in reading order. */
	reasons: string[];
	/** Switched-on signals that could not be computed, with why. */
	unavailable: string[];
}

const off = (): SignalResult => ({ status: 'off', matched: false, detail: '', metrics: {} });
const unavailable = (detail: string): SignalResult => ({
	status: 'unavailable',
	matched: false,
	detail,
	metrics: {}
});

const sgn = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;

// ---------------------------------------------------------------------------------------------
// Maths helpers
// ---------------------------------------------------------------------------------------------

function pctReturn(series: (number | null)[], t: number, k: number): number | null {
	if (t - k < 0) return null;
	const a = series[t - k];
	const b = series[t];
	if (a == null || b == null || a <= 0) return null;
	return (b / a - 1) * 100;
}

/** Relative strength over k sessions ending at t: subject return minus Nifty return, in points. */
function rsAt(
	price: (number | null)[],
	bench: (number | null)[],
	t: number,
	k: number
): number | null {
	const p = pctReturn(price, t, k);
	const b = pctReturn(bench, t, k);
	return p != null && b != null ? p - b : null;
}

function median(values: number[]): number {
	const s = [...values].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number {
	return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Why a subject's price series cannot be used, in words: never fetched, behind the market, or
 *  too short. Used for every "unavailable" reason so it says what is actually wrong. */
function priceGap(input: StrengthInput): string {
	const { calendar, price } = input;
	const n = calendar.length;
	let last = -1;
	let bars = 0;
	for (let i = 0; i < n; i++) {
		if (price[i] != null) {
			bars++;
			last = i;
		}
	}
	if (bars === 0)
		return input.kind === 'company'
			? "No price history is stored for this symbol (it may not be on Angel One's equity list, or has not been fetched yet)."
			: 'No price history is stored for any constituent yet.';
	if (last < n - 1)
		return `Latest price is from ${calendar[last]}, ${n - 1 - last} session${n - 1 - last === 1 ? '' : 's'} behind the market (stale data).`;
	return `Only ${bars} sessions of price history so far (recent listing or gaps).`;
}

// ---------------------------------------------------------------------------------------------
// Sudden strength
// ---------------------------------------------------------------------------------------------

/** The m-day relative strength measured at the latest session, compared with how that same
 *  m-day figure has varied over the baseline. The baseline holds only windows that ended at or
 *  before t-m, so the window being judged never feeds its own yardstick. */
export function suddenStrength(input: StrengthInput, c: StrengthConfig): SignalResult {
	const n = input.calendar.length;
	const t = n - 1;
	const m = c.periodDays;
	const L = c.baselineDays;
	const need = L + 2 * m;
	if (n < need)
		return unavailable(`Needs ${need} sessions of history for a ${L}-session baseline, has ${n}.`);

	const current = rsAt(input.price, input.benchmark, t, m);
	if (current == null) return unavailable(priceGap(input));

	if (c.sudden.mode === 'explicit') {
		const matched = current >= c.sudden.explicitRsPct;
		return {
			status: 'ok',
			matched,
			detail: `${m}-session relative strength ${sgn(current)} pts vs Nifty (needs ${sgn(c.sudden.explicitRsPct)}).`,
			metrics: { rs: current }
		};
	}

	const samples: number[] = [];
	for (let s = t - m - L + 1; s <= t - m; s++) {
		const v = rsAt(input.price, input.benchmark, s, m);
		if (v != null) samples.push(v);
	}
	if (samples.length < MIN_SAMPLES_FOR_Z)
		return unavailable(
			`${priceGap(input)} Needs at least ${MIN_SAMPLES_FOR_Z} baseline readings, has ${samples.length}.`
		);
	const short = samples.length < Math.floor(L * 0.8);

	const med = median(samples);
	const mad = median(samples.map((v) => Math.abs(v - med)));
	const sigma = Math.max(1.4826 * mad, MIN_SIGMA_PTS);
	const z = (current - med) / sigma;
	const matched = z >= c.sudden.z && current >= c.sudden.minRsPct;
	return {
		status: 'ok',
		matched,
		detail: `${m}-session relative strength ${sgn(current)} pts vs Nifty (usual ${sgn(med)}, z-score ${z.toFixed(1)}; needs ${c.sudden.z.toFixed(1)} and at least ${sgn(c.sudden.minRsPct)} pts).${short ? ` Short history: baseline uses ${samples.length} readings, not ${L}.` : ''}`,
		metrics: { rs: current, z, baselineMedian: med, sigma, samples: samples.length }
	};
}

// ---------------------------------------------------------------------------------------------
// Gradual strengthening
// ---------------------------------------------------------------------------------------------

/** Relative performance building across sessions: the subject-to-Nifty ratio rose over the
 *  window, on enough individual sessions, without one day doing most of the work. */
export function gradualStrength(input: StrengthInput, c: StrengthConfig): SignalResult {
	const n = input.calendar.length;
	const t = n - 1;
	const D = c.gradual.days;
	if (n < D + 1) return unavailable(`Needs ${D + 1} sessions of history, has ${n}.`);

	const rl: number[] = [];
	for (let i = t - D; i <= t; i++) {
		const p = input.price[i];
		const b = input.benchmark[i];
		if (p == null || b == null || p <= 0 || b <= 0) return unavailable(priceGap(input));
		rl.push(Math.log(p / b));
	}
	const steps = rl.slice(1).map((v, i) => v - rl[i]);
	const gain = (rl[D] - rl[0]) * 100;
	const improving = steps.filter((s) => s > 0).length;
	const biggest = Math.max(...steps) * 100;
	const share = gain > 0 ? biggest / gain : 1;

	const matched =
		gain >= c.gradual.minGainPct &&
		improving >= c.gradual.minImprovingSessions &&
		share <= c.gradual.maxSingleDayShare;
	return {
		status: 'ok',
		matched,
		detail: `Beat Nifty on ${improving} of ${D} sessions, relative gain ${sgn(gain)}%, best single day ${gain > 0 ? Math.round(share * 100) : 100}% of it (needs ${c.gradual.minImprovingSessions} sessions, ${sgn(c.gradual.minGainPct)}% gain, no day over ${Math.round(c.gradual.maxSingleDayShare * 100)}%).`,
		metrics: { gain, improving, share }
	};
}

// ---------------------------------------------------------------------------------------------
// Strength spreading (groups only)
// ---------------------------------------------------------------------------------------------

/** Share of constituents beating Nifty over `days` sessions, now and `days` sessions earlier.
 *  Only stocks with data at all three points are counted, in both snapshots, so the change
 *  compares like with like. */
export function spreadingStrength(input: StrengthInput, c: StrengthConfig): SignalResult {
	const n = input.calendar.length;
	const t = n - 1;
	const D = c.spreading.days;
	const total = input.members.length;
	if (total === 0) return unavailable('No constituents have price history stored.');
	if (total < MIN_SPREADING_STOCKS)
		return unavailable(
			`Spreading needs at least ${MIN_SPREADING_STOCKS} stocks, this has ${total}.`
		);
	if (n < 2 * D + 1) return unavailable(`Needs ${2 * D + 1} sessions of history, has ${n}.`);

	let valid = 0;
	let beatNow = 0;
	let beatThen = 0;
	for (const m of input.members) {
		const now = rsAt(m.closes, input.benchmark, t, D);
		const then = rsAt(m.closes, input.benchmark, t - D, D);
		if (now == null || then == null) continue;
		valid++;
		if (now > 0) beatNow++;
		if (then > 0) beatThen++;
	}
	const needed = Math.min(total, Math.max(MIN_SPREADING_STOCKS, Math.ceil(0.7 * total)));
	if (valid < needed)
		return unavailable(`Only ${valid} of ${total} constituents have full data, needs ${needed}.`);

	const breadth = (beatNow / valid) * 100;
	const before = (beatThen / valid) * 100;
	const change = breadth - before;
	const matched = breadth >= c.spreading.minBreadthPct && change >= c.spreading.minChangePts;
	return {
		status: 'ok',
		matched,
		detail: `${beatNow} of ${valid} stocks beat Nifty over ${D} sessions (${breadth.toFixed(0)}%, ${sgn(change, 0)} pts from ${before.toFixed(0)}% ${D} sessions ago). Needs ${c.spreading.minBreadthPct}% and ${sgn(c.spreading.minChangePts, 0)} pts. ${valid} of ${total} counted.`,
		metrics: { breadth, before, change, valid, total }
	};
}

// ---------------------------------------------------------------------------------------------
// Volume confirmation
// ---------------------------------------------------------------------------------------------

function windowMean(values: (number | null)[], from: number, to: number): number | null {
	const got: number[] = [];
	for (let i = from; i <= to; i++) {
		const v = values[i];
		if (v != null) got.push(v);
	}
	const len = to - from + 1;
	return got.length >= Math.ceil(len * MIN_WINDOW_COVERAGE) ? mean(got) : null;
}

/** Average daily volume over the last `days` sessions divided by the average over the
 *  `baselineDays` sessions before that window (the window itself is excluded). Each stock is
 *  normalised against its own history first, then a group takes the MEDIAN across its stocks,
 *  so one stock's spike or a big share count cannot dominate. Volume only confirms strength
 *  when the subject also outperformed Nifty over the same window. */
export function volumeConfirmation(input: StrengthInput, c: StrengthConfig): SignalResult {
	const n = input.calendar.length;
	const t = n - 1;
	const D = c.volume.days;
	const B = c.volume.baselineDays;
	const total = input.members.length;
	if (total === 0) return unavailable('No volume history is stored for this symbol.');
	if (n < D + B) return unavailable(`Needs ${D + B} sessions of history, has ${n}.`);

	const ratios: number[] = [];
	for (const m of input.members) {
		const recent = windowMean(m.volumes, t - D + 1, t);
		const base = windowMean(m.volumes, t - D - B + 1, t - D);
		if (recent != null && base != null && base > 0) ratios.push(recent / base);
	}
	const needed = Math.min(total, Math.max(3, Math.ceil(0.6 * total)));
	if (ratios.length < needed)
		return unavailable(`Only ${ratios.length} of ${total} stocks have enough volume history.`);

	const ratio = median(ratios);
	const rs = rsAt(input.price, input.benchmark, t, D);
	if (rs == null) return unavailable(priceGap(input));

	const high = ratio >= c.volume.minRatio;
	const matched = high && rs > 0;
	const scope = input.kind === 'group' ? `median of ${ratios.length} of ${total} stocks, ` : '';
	const tail = matched
		? 'with price outperforming Nifty, so it confirms strength'
		: high
			? 'but price lagged Nifty, so it is high-volume weakness, not confirmation'
			: `below the ${c.volume.minRatio.toFixed(1)}x needed`;
	return {
		status: 'ok',
		matched,
		detail: `Volume ${ratio.toFixed(1)}x its previous ${B}-session average (${scope}${D}-session window), ${tail}.`,
		metrics: { ratio, rs, counted: ratios.length, total }
	};
}

// ---------------------------------------------------------------------------------------------
// Combining
// ---------------------------------------------------------------------------------------------

export function evaluateStrength(input: StrengthInput, config: StrengthConfig): StrengthEvaluation {
	const c = config;
	const asOf = input.calendar.length ? input.calendar[input.calendar.length - 1] : null;
	const isGroup = input.kind === 'group';
	const signals = {
		sudden: c.sudden.enabled ? suddenStrength(input, c) : off(),
		gradual: c.gradual.enabled ? gradualStrength(input, c) : off(),
		spreading: c.spreading.enabled && isGroup ? spreadingStrength(input, c) : off(),
		volume: c.volume.enabled ? volumeConfirmation(input, c) : off()
	};

	const priceNames = (['sudden', 'gradual', 'spreading'] as const).filter(
		(k) => signals[k].status !== 'off'
	);
	const active = priceNames.length > 0 || signals.volume.status !== 'off';

	const labels = {
		sudden: 'Suddenly strengthening',
		gradual: 'Gradually strengthening',
		spreading: 'Strength spreading',
		volume: 'Volume'
	} as const;

	let matched = true;
	if (active) {
		const priceHits = priceNames.map((k) => signals[k].matched);
		const priceOk =
			priceNames.length === 0 ? null : c.match === 'all' ? priceHits.every(Boolean) : priceHits.some(Boolean);
		const volOn = signals.volume.status !== 'off';
		matched =
			priceOk === null ? signals.volume.matched : volOn ? priceOk && signals.volume.matched : priceOk;
	}

	const reasons: string[] = [];
	const unavail: string[] = [];
	for (const k of ['sudden', 'gradual', 'spreading', 'volume'] as const) {
		const s = signals[k];
		if (s.status === 'unavailable') unavail.push(`${labels[k]}: ${s.detail}`);
		else if (s.status === 'ok' && s.matched) reasons.push(`${labels[k]}: ${s.detail}`);
	}
	return { active, matched, asOf, signals, reasons, unavailable: unavail };
}

// ---------------------------------------------------------------------------------------------
// Alert transitions
// ---------------------------------------------------------------------------------------------

export interface RepeatPolicy {
	/** once: alert the first time the condition is met, never again. rearm: alert on every entry. */
	mode: 'once' | 'rearm';
	/** Minimum completed sessions between two alerts for the same subject (rearm only). */
	cooldownSessions: number;
}

export const DEFAULT_REPEAT: RepeatPolicy = { mode: 'rearm', cooldownSessions: 5 };

export function parseRepeat(raw: unknown): RepeatPolicy {
	const r = asObj(raw);
	return {
		mode: r.mode === 'once' ? 'once' : 'rearm',
		cooldownSessions: clampInt(r.cooldownSessions, 0, 60, DEFAULT_REPEAT.cooldownSessions)
	};
}

/** What is remembered per (rule, subject) between checks. */
export interface StrengthRuleState {
	matched: boolean;
	/** Session date of the last alert, or null if it has never fired. */
	firedOn: string | null;
}

/** Fires on ENTRY into the condition. The first reading only seeds the state, so switching a rule
 *  on never floods the feed with everything already true. A condition that stays true, or an
 *  entry inside the cooldown, or any re-entry after a "once" alert, updates state without firing. */
export function detectStrengthEntry(
	prev: StrengthRuleState | null,
	matched: boolean,
	asOf: string,
	policy: RepeatPolicy,
	calendar: string[]
): { next: StrengthRuleState; fire: boolean } {
	if (prev == null) return { next: { matched, firedOn: null }, fire: false };
	if (!matched || prev.matched) return { next: { matched, firedOn: prev.firedOn }, fire: false };

	if (prev.firedOn != null) {
		if (policy.mode === 'once') return { next: { matched, firedOn: prev.firedOn }, fire: false };
		const from = calendar.indexOf(prev.firedOn);
		const to = calendar.indexOf(asOf);
		const since = from >= 0 && to >= 0 ? to - from : Infinity;
		if (since < policy.cooldownSessions)
			return { next: { matched, firedOn: prev.firedOn }, fire: false };
	}
	return { next: { matched, firedOn: asOf }, fire: true };
}

export function parseRuleState(raw: string | null | undefined): StrengthRuleState | null {
	if (!raw) return null;
	try {
		const o = asObj(JSON.parse(raw));
		if (typeof o.matched !== 'boolean') return null;
		return { matched: o.matched, firedOn: typeof o.firedOn === 'string' ? o.firedOn : null };
	} catch {
		return null;
	}
}

/** A short label for the active signals, for filter chips and alert titles. */
export function describeStrengthConfig(c: StrengthConfig, kind: SubjectKind = 'group'): string[] {
	const out: string[] = [];
	if (c.sudden.enabled)
		out.push(
			c.sudden.mode === 'adaptive'
				? `Sudden: ${c.periodDays}d, z ≥ ${c.sudden.z}`
				: `Sudden: ${c.periodDays}d RS ≥ ${c.sudden.explicitRsPct} pts`
		);
	if (c.gradual.enabled)
		out.push(`Gradual: ${c.gradual.minImprovingSessions} of ${c.gradual.days} sessions`);
	if (kind === 'group' && c.spreading.enabled)
		out.push(`Spreading: ≥ ${c.spreading.minBreadthPct}%, +${c.spreading.minChangePts} pts`);
	if (c.volume.enabled) out.push(`Volume ≥ ${c.volume.minRatio}x`);
	return out;
}

// ---------------------------------------------------------------------------------------------
// What the filter panel and the pages share
// ---------------------------------------------------------------------------------------------

export type StrengthLevel = 'sectors' | 'subsectors' | 'companies' | 'company';

export interface StrengthRow {
	key: string;
	label: string;
	href: string;
	evaluation: StrengthEvaluation;
}

export interface StrengthResult {
	asOf: string | null;
	calendar: string[];
	rows: StrengthRow[];
}

/** The panel's current answer for a page: which subjects match and why. */
export interface StrengthView {
	/** At least one signal is switched on. */
	active: boolean;
	/** A result for the current filter has arrived. */
	ready: boolean;
	error: string | null;
	asOf: string | null;
	byKey: Record<string, StrengthEvaluation>;
}

export const emptyStrengthView = (): StrengthView => ({
	active: false,
	ready: false,
	error: null,
	asOf: null,
	byKey: {}
});

/** Whether a page should hide this subject. Until a result arrives, or if the filter could not
 *  be evaluated, nothing is hidden. */
export const passesStrength = (view: StrengthView, key: string): boolean =>
	!(view.active && view.ready && !view.error) || view.byKey[key]?.matched === true;
