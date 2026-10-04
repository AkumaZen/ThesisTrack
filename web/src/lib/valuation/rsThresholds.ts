// Weekly / monthly relative-strength thresholds for sector alerts. Pure - no I/O.
//
// Besides the Rotating In/Out flip (a multi-window momentum read), a sector alert also fires
// when its relative strength vs Nifty crosses a clear level on a SHORT window: the last week
// (5 trading days) or the last month (21). Defaults: +/-2% for a week and +/-5% for a month -
// a sector beating (or lagging) Nifty by that much in so short a time is a real move, while
// smaller wobble is ordinary noise. The admin can change both on the Alerts page.

export interface RsThresholds {
	/** |1W RS vs Nifty| in percentage points that counts as a strong/weak week. */
	weeklyPct: number;
	/** |1M RS vs Nifty| in percentage points that counts as a strong/weak month. */
	monthlyPct: number;
}

export const DEFAULT_RS_THRESHOLDS: RsThresholds = { weeklyPct: 2, monthlyPct: 5 };

export const RS_THRESHOLD_LIMITS = { min: 0.5, max: 50 };

export type RsBand = 'strong' | 'weak' | 'neutral';
export type RsWindow = 'weekly' | 'monthly';

/** Which side of the +/- threshold the relative strength is on ('neutral' = in between). */
export function rsBand(rs: number, thresholdPct: number): RsBand {
	if (rs >= thresholdPct) return 'strong';
	if (rs <= -thresholdPct) return 'weak';
	return 'neutral';
}

/** Alerts when a window's band moves INTO strong or weak from a different band; a return to
 *  neutral just updates state. A first sighting (no usable previous state) seeds silently. */
export function detectRsBand(
	prev: string | null,
	band: RsBand
): { next: RsBand; entered: 'strong' | 'weak' | null } {
	if (prev !== 'strong' && prev !== 'weak' && prev !== 'neutral') {
		return { next: band, entered: null };
	}
	if (prev === band || band === 'neutral') return { next: band, entered: null };
	return { next: band, entered: band };
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export function rsThresholdMessage(
	label: string,
	level: 'sector' | 'basket',
	window: RsWindow,
	entered: 'strong' | 'weak',
	rs: number,
	thresholdPct: number
): string {
	const side = entered === 'strong' ? `above +${thresholdPct}%` : `below -${thresholdPct}%`;
	return `${label} ${level}: ${window} relative strength vs Nifty is ${signed(rs)}, ${side}.`;
}

/** Validates admin input; returns an error message or the cleaned (rounded) partial values. */
export function parseThresholds(
	raw: unknown
): { error: string } | { value: Partial<RsThresholds> } {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return { error: '"thresholds" must be an object.' };
	}
	const out: Partial<RsThresholds> = {};
	for (const key of ['weeklyPct', 'monthlyPct'] as const) {
		const v = (raw as Record<string, unknown>)[key];
		if (v === undefined) continue;
		if (typeof v !== 'number' || !Number.isFinite(v))
			return { error: `"${key}" must be a number.` };
		if (v < RS_THRESHOLD_LIMITS.min || v > RS_THRESHOLD_LIMITS.max) {
			return {
				error: `"${key}" must be between ${RS_THRESHOLD_LIMITS.min} and ${RS_THRESHOLD_LIMITS.max} percentage points.`
			};
		}
		out[key] = Math.round(v * 100) / 100;
	}
	if (Object.keys(out).length === 0) return { error: 'Provide weeklyPct and/or monthlyPct.' };
	return { value: out };
}
