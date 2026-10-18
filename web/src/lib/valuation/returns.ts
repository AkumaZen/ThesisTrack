/**
 * Returns benchmark: stocks and indices rebased to 100 at the start of a period, and the return over
 * each period. Pure functions over stored closes; nothing here reads a database or the network.
 */

export const PERIODS = ['1M', '3M', '6M', '1Y', '3Y'] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_MONTHS: Record<Period, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36 };

/** A series whose first point is later than the period start by more than this many days does not
 *  cover the period (a stock listed after it), and is left out rather than rebased from a later date. */
export const START_TOLERANCE_DAYS = 7;
/** The stored daily series (about 400 days) serves periods up to this many months; 3Y uses the weekly series. */
export const DAILY_MAX_MONTHS = 12;

export interface ClosePoint {
	date: string; // YYYY-MM-DD
	close: number;
}

const toMs = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
const DAY_MS = 86_400_000;

/** The calendar date one period before `asOf` (clamped to the target month's last day). */
export function periodStart(asOf: string, period: Period): string {
	const d = new Date(`${asOf}T00:00:00Z`);
	const day = d.getUTCDate();
	d.setUTCDate(1);
	d.setUTCMonth(d.getUTCMonth() - PERIOD_MONTHS[period]);
	const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
	d.setUTCDate(Math.min(day, last));
	return d.toISOString().slice(0, 10);
}

/** Closes from the base point to the end, where the base is the last point on or before `start`. Null when
 *  the series does not reach back to the period start. */
export function windowFrom(points: ClosePoint[], start: string): ClosePoint[] | null {
	if (points.length < 2) return null;
	let base = -1;
	for (let i = 0; i < points.length; i++) {
		if (points[i].date <= start) base = i;
		else break;
	}
	if (base === -1) {
		// No point on or before the start: accept a first point only slightly after it.
		if ((toMs(points[0].date) - toMs(start)) / DAY_MS > START_TOLERANCE_DAYS) return null;
		base = 0;
	}
	const window = points.slice(base);
	return window.length >= 2 && window[0].close > 0 ? window : null;
}

/** The window rebased so the base point is 100. */
export function rebase(points: ClosePoint[], start: string): ClosePoint[] | null {
	const w = windowFrom(points, start);
	if (!w) return null;
	const base = w[0].close;
	return w.map((p) => ({ date: p.date, close: (p.close / base) * 100 }));
}

/** Percent return over the window, or null when the series does not cover it. */
export function periodReturnPct(points: ClosePoint[], start: string): number | null {
	const w = windowFrom(points, start);
	return w ? (w[w.length - 1].close / w[0].close - 1) * 100 : null;
}

/** Which stored series serves a period: the daily one up to a year, the weekly one beyond. */
export function seriesFor(period: Period, daily: ClosePoint[] | null, weekly: ClosePoint[] | null): ClosePoint[] | null {
	return PERIOD_MONTHS[period] <= DAILY_MAX_MONTHS ? daily : weekly;
}

export interface ReturnItem {
	key: string;
	label: string;
	kind: 'stock' | 'index';
	daily: ClosePoint[] | null;
	weekly: ClosePoint[] | null;
}

export interface ReturnRow {
	key: string;
	label: string;
	kind: 'stock' | 'index';
	returns: Record<Period, number | null>;
	/** Excess over the benchmark row, per period, when a benchmark is given. */
	excess: Record<Period, number | null> | null;
}

const emptyByPeriod = (): Record<Period, number | null> => ({ '1M': null, '3M': null, '6M': null, '1Y': null, '3Y': null });

/** The latest date across the items (the "as of" every period is counted back from). */
export function latestDate(items: ReturnItem[]): string | null {
	let latest: string | null = null;
	for (const it of items)
		for (const s of [it.daily, it.weekly]) {
			const d = s?.[s.length - 1]?.date;
			if (d && (!latest || d > latest)) latest = d;
		}
	return latest;
}

export function returnRows(items: ReturnItem[], benchmarkKey: string | null): ReturnRow[] {
	const asOf = latestDate(items);
	if (!asOf) return [];
	const rows: ReturnRow[] = items.map((it) => {
		const returns = emptyByPeriod();
		for (const p of PERIODS) {
			const s = seriesFor(p, it.daily, it.weekly);
			returns[p] = s ? periodReturnPct(s, periodStart(asOf, p)) : null;
		}
		return { key: it.key, label: it.label, kind: it.kind, returns, excess: null };
	});
	const bench = rows.find((r) => r.key === benchmarkKey);
	if (!bench) return rows;
	for (const r of rows) {
		const ex = emptyByPeriod();
		for (const p of PERIODS) {
			const a = r.returns[p];
			const b = bench.returns[p];
			ex[p] = a != null && b != null ? a - b : null;
		}
		r.excess = ex;
	}
	return rows;
}

export interface ChartLine {
	key: string;
	label: string;
	kind: 'stock' | 'index';
	points: ClosePoint[]; // rebased to 100
}

/** Lines for the chart over one period; items that do not cover the period are listed in `skipped`. */
export function chartLines(items: ReturnItem[], period: Period): { lines: ChartLine[]; skipped: string[]; start: string | null } {
	const asOf = latestDate(items);
	if (!asOf) return { lines: [], skipped: items.map((i) => i.label), start: null };
	const start = periodStart(asOf, period);
	const lines: ChartLine[] = [];
	const skipped: string[] = [];
	for (const it of items) {
		const s = seriesFor(period, it.daily, it.weekly);
		const pts = s ? rebase(s, start) : null;
		if (pts) lines.push({ key: it.key, label: it.label, kind: it.kind, points: pts });
		else skipped.push(it.label);
	}
	return { lines, skipped, start };
}

/** Weekly closes (the last close of each Monday-to-Sunday week) of the candles from `since` on, for the 3Y series. */
export function weeklySeries(candles: { date: string; close: number }[], since: string): ClosePoint[] {
	const out: ClosePoint[] = [];
	let weekKey = '';
	for (const c of candles) {
		const date = c.date.slice(0, 10);
		if (date < since) continue;
		const d = new Date(`${date}T00:00:00Z`);
		const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
		if (monday === weekKey) out[out.length - 1] = { date, close: c.close };
		else {
			weekKey = monday;
			out.push({ date, close: c.close });
		}
	}
	return out;
}
