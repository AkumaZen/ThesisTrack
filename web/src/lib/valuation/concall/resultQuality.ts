// Result quality of a quarter: was the year-on-year growth ahead of, in line with or behind the
// company's own recent trend? Rule based, computed from the stored quarterly results (no LLM).
//
// For sales, operating profit and net profit: growth = YoY % of the quarter, trend = mean YoY of
// the three quarters before it (needs at least two). A metric beats the trend when growth is at
// least BAND_PP points above it, misses when at least BAND_PP below, otherwise it is in line.
// Overall: net score (beats minus misses) >= 2 is a beat, <= -2 a miss, else in line. At least
// two metrics must be measurable, or the quarter is "n/a".

import { NET_PROFIT, OPERATING_PROFIT, SALES, series, shiftMonths, type Table } from './financials';

export const BAND_PP = 5;
export type Verdict = 'beat' | 'in-line' | 'miss';

export interface QualityMetric {
	name: 'Sales' | 'Operating profit' | 'Net profit';
	yoy: number | null;
	trend: number | null;
	delta: number | null;
	verdict: Verdict | null;
}

export interface ResultQuality {
	quarter: string;
	verdict: Verdict | 'n/a';
	metrics: QualityMetric[];
	/** Operating margin of the quarter and its change versus the same quarter a year earlier, in points. */
	opm: number | null;
	opmChange: number | null;
}

const growth = (now: number | undefined, before: number | undefined): number | null =>
	now == null || before == null || before <= 0 ? null : ((now - before) / before) * 100;

export function resultQuality(quarterly: Table | undefined, quarter: string): ResultQuality {
	const data = {
		Sales: series(quarterly, ...SALES),
		'Operating profit': series(quarterly, ...OPERATING_PROFIT),
		'Net profit': series(quarterly, ...NET_PROFIT)
	} as const;
	const yoyAt = (name: keyof typeof data, date: string) => growth(data[name].get(date), data[name].get(shiftMonths(date, -12)));
	const metrics: QualityMetric[] = (Object.keys(data) as (keyof typeof data)[]).map((name) => {
		const yoy = yoyAt(name, quarter);
		const prior = [3, 6, 9].map((m) => yoyAt(name, shiftMonths(quarter, -m))).filter((v): v is number => v != null);
		const trend = prior.length >= 2 ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
		const delta = yoy != null && trend != null ? yoy - trend : null;
		const verdict: Verdict | null = delta == null ? null : delta >= BAND_PP ? 'beat' : delta <= -BAND_PP ? 'miss' : 'in-line';
		return { name, yoy, trend, delta, verdict };
	});
	const measured = metrics.filter((m) => m.verdict);
	const score = measured.reduce((n, m) => n + (m.verdict === 'beat' ? 1 : m.verdict === 'miss' ? -1 : 0), 0);
	const verdict: ResultQuality['verdict'] = measured.length < 2 ? 'n/a' : score >= 2 ? 'beat' : score <= -2 ? 'miss' : 'in-line';
	const sales = data.Sales, op = data['Operating profit'];
	const margin = (date: string) => (sales.get(date) && op.has(date) ? (op.get(date)! / sales.get(date)!) * 100 : null);
	const opm = margin(quarter), before = margin(shiftMonths(quarter, -12));
	return { quarter, verdict, metrics, opm, opmChange: opm != null && before != null ? opm - before : null };
}

/** Quality for every reported quarter that has a year-ago column, newest first. */
export function allResultQuality(quarterly: Table | undefined): ResultQuality[] {
	const dates = (quarterly?.dates.filter((d): d is string => !!d) ?? []).sort().reverse();
	return dates.filter((d) => dates.includes(shiftMonths(d, -12))).map((d) => resultQuality(quarterly, d));
}
