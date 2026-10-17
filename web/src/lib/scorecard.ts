// Scorecard maths. Pure: no database, no network, no clock (today is passed in), so every rule is
// testable. Prices are STORED closes only. Headline numbers use CLOSED theses; open ones get a
// paper return at the latest stored close and are reported separately.
import { closeOnOrBefore, returnPct } from './entryPrice.js';

export type Series = { dates: string[]; closes: number[] };

export interface ScorecardInput {
	id: number;
	companyId: string;
	companyName: string;
	sector: string;
	owner: string;
	conviction: number | null;
	outcome: string; // 'open' | 'played_out' | 'invalidated' | 'exited_early'
	entryDate: string | null;
	entryPrice: number | null;
	needsPrice: boolean;
	entryPriceSource: string | null;
	exitDate: string | null;
	/** Price of the last logged sell decision, if any. */
	sellPrice: number | null;
	/** Latest stored close of the company. */
	current: { date: string; price: number } | null;
	/** Stored closes, used to price an exit that has no logged sell. */
	series: Series | null;
	/** A kill-severity trigger fired for this thesis. */
	killFired: boolean;
	lesson: string | null;
}

export type Exclusion = 'no_entry_price' | 'no_data' | 'no_exit_price' | 'no_current_price' | 'no_dates';

export interface ScorecardRow {
	id: number;
	companyId: string;
	companyName: string;
	sector: string;
	owner: string;
	conviction: number | null;
	outcome: string;
	closed: boolean;
	entryDate: string | null;
	entryPrice: number | null;
	/** Exit price for closed theses, latest stored close for open ones. */
	endPrice: number | null;
	endDate: string | null;
	endSource: 'sell_decision' | 'stored_close' | 'latest_close' | null;
	returnPct: number | null;
	niftyPct: number | null;
	/** Percentage points above (+) or below (-) the Nifty 50 over the same window. */
	vsNifty: number | null;
	holdDays: number | null;
	excluded: Exclusion | null;
	killFired: boolean;
	/** Return if held to the latest stored close (kill-trigger estimate). */
	returnIfHeld: number | null;
}

export const isClosed = (outcome: string) => outcome !== 'open';

export function daysBetween(from: string, to: string): number | null {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
	return Math.round((b - a) / 86_400_000);
}

/** Nifty 50 change between two dates (each at its last stored session on/before it). Null when
 *  the stored history does not reach back to the start. */
export function niftyReturn(nifty: Series | null, from: string, to: string): number | null {
	if (!nifty) return null;
	const a = closeOnOrBefore(nifty.dates, nifty.closes, from);
	const b = closeOnOrBefore(nifty.dates, nifty.closes, to);
	if (!a || !b || b.date < a.date) return null;
	return returnPct(a.price, b.price);
}

export function buildRow(i: ScorecardInput, nifty: Series | null): ScorecardRow {
	const closed = isClosed(i.outcome);
	const row: ScorecardRow = {
		id: i.id,
		companyId: i.companyId,
		companyName: i.companyName,
		sector: i.sector,
		owner: i.owner,
		conviction: i.conviction,
		outcome: i.outcome,
		closed,
		entryDate: i.entryDate,
		entryPrice: i.entryPrice,
		endPrice: null,
		endDate: null,
		endSource: null,
		returnPct: null,
		niftyPct: null,
		vsNifty: null,
		holdDays: null,
		excluded: null,
		killFired: i.killFired,
		returnIfHeld: null
	};
	if (i.entryPrice == null) {
		row.excluded = i.entryPriceSource === 'no_data' ? 'no_data' : 'no_entry_price';
		return row;
	}
	if (i.needsPrice || !(i.entryPrice > 0)) {
		row.excluded = 'no_entry_price';
		return row;
	}
	if (!i.entryDate) {
		row.excluded = 'no_dates';
		return row;
	}
	if (closed) {
		if (!i.exitDate) {
			row.excluded = 'no_dates';
			return row;
		}
		if (i.sellPrice != null && i.sellPrice > 0) {
			row.endPrice = i.sellPrice;
			row.endDate = i.exitDate;
			row.endSource = 'sell_decision';
		} else {
			const c = i.series ? closeOnOrBefore(i.series.dates, i.series.closes, i.exitDate) : null;
			if (c) {
				row.endPrice = c.price;
				row.endDate = i.exitDate;
				row.endSource = 'stored_close';
			}
		}
		if (row.endPrice == null) {
			row.excluded = 'no_exit_price';
			return row;
		}
	} else {
		if (!i.current) {
			row.excluded = 'no_current_price';
			return row;
		}
		row.endPrice = i.current.price;
		row.endDate = i.current.date;
		row.endSource = 'latest_close';
	}
	row.returnPct = returnPct(i.entryPrice, row.endPrice);
	if (row.returnPct == null) {
		row.excluded = closed ? 'no_exit_price' : 'no_current_price';
		return row;
	}
	row.holdDays = daysBetween(i.entryDate, row.endDate!);
	row.niftyPct = niftyReturn(nifty, i.entryDate, row.endDate!);
	row.vsNifty = row.niftyPct != null ? row.returnPct - row.niftyPct : null;
	if (closed && i.current) row.returnIfHeld = returnPct(i.entryPrice, i.current.price);
	return row;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export interface Stats {
	count: number;
	wins: number;
	/** Percent of theses with a return above zero; null with no theses. */
	hitRate: number | null;
	avgReturn: number | null;
	avgVsNifty: number | null;
	avgHoldDays: number | null;
}

/** A thesis is a "win" when its return is above zero (a flat 0.0% is not a win). */
export function stats(rows: ScorecardRow[]): Stats {
	const priced = rows.filter((r) => r.returnPct != null);
	const wins = priced.filter((r) => r.returnPct! > 0).length;
	return {
		count: priced.length,
		wins,
		hitRate: priced.length ? (wins / priced.length) * 100 : null,
		avgReturn: avg(priced.map((r) => r.returnPct!)),
		avgVsNifty: avg(priced.filter((r) => r.vsNifty != null).map((r) => r.vsNifty!)),
		avgHoldDays: avg(priced.filter((r) => r.holdDays != null).map((r) => r.holdDays!))
	};
}

export function groupStats(rows: ScorecardRow[], key: (r: ScorecardRow) => string): { key: string; stats: Stats }[] {
	const groups = new Map<string, ScorecardRow[]>();
	for (const r of rows) {
		const k = key(r);
		const list = groups.get(k) ?? [];
		list.push(r);
		groups.set(k, list);
	}
	return [...groups].map(([k, rs]) => ({ key: k, stats: stats(rs) })).filter((g) => g.stats.count > 0);
}

export const convictionLabel = (c: number | null) => (c == null ? 'Not rated' : `Conviction ${c}`);

export interface Scorecard {
	rows: ScorecardRow[];
	headline: Stats;
	open: Stats;
	byAnalyst: { owner: string; closed: Stats; openCount: number }[];
	byConviction: { key: string; stats: Stats }[];
	bySector: { key: string; stats: Stats }[];
	killTriggers: { row: ScorecardRow; atExit: number; ifHeld: number; difference: number }[];
	best: ScorecardRow[];
	worst: ScorecardRow[];
	lessons: { id: number; companyId: string; companyName: string; owner: string; date: string | null; lesson: string }[];
	/** Theses left out of the return maths because they have no entry price. */
	withoutEntryPrice: { id: number; companyId: string; companyName: string; owner: string; reason: Exclusion }[];
	/** Priced theses missing an exit or current price (also left out). */
	withoutEndPrice: number;
}

export function computeScorecard(inputs: ScorecardInput[], nifty: Series | null): Scorecard {
	const rows = inputs.map((i) => buildRow(i, nifty));
	const closed = rows.filter((r) => r.closed && r.returnPct != null);
	const open = rows.filter((r) => !r.closed && r.returnPct != null);
	const owners = [...new Set(rows.map((r) => r.owner))].sort((a, b) => a.localeCompare(b));

	const byRet = [...closed].sort((a, b) => b.returnPct! - a.returnPct!);
	const best = byRet.slice(0, 3);
	// Never list the same call as both best and worst when there are fewer than six.
	const worst = byRet
		.slice(-3)
		.reverse()
		.filter((r) => !best.includes(r));
	const killTriggers = closed
		.filter((r) => (r.killFired || r.outcome === 'invalidated') && r.returnIfHeld != null)
		.map((r) => ({ row: r, atExit: r.returnPct!, ifHeld: r.returnIfHeld!, difference: r.returnPct! - r.returnIfHeld! }));

	return {
		rows,
		headline: stats(closed),
		open: stats(open),
		byAnalyst: owners.map((owner) => ({
			owner,
			closed: stats(closed.filter((r) => r.owner === owner)),
			openCount: open.filter((r) => r.owner === owner).length
		})),
		byConviction: groupStats(closed, (r) => convictionLabel(r.conviction)).sort((a, b) => a.key.localeCompare(b.key)),
		bySector: groupStats(closed, (r) => r.sector).sort((a, b) => b.stats.avgReturn! - a.stats.avgReturn!),
		killTriggers,
		best,
		worst,
		lessons: inputs
			.filter((i) => isClosed(i.outcome) && i.lesson?.trim())
			.sort((a, b) => (b.exitDate ?? '').localeCompare(a.exitDate ?? '') || b.id - a.id)
			.map((i) => ({
				id: i.id,
				companyId: i.companyId,
				companyName: i.companyName,
				owner: i.owner,
				date: i.exitDate,
				lesson: i.lesson!.trim()
			})),
		withoutEntryPrice: rows
			.filter((r) => r.excluded === 'no_entry_price' || r.excluded === 'no_data')
			.map((r) => ({ id: r.id, companyId: r.companyId, companyName: r.companyName, owner: r.owner, reason: r.excluded! })),
		withoutEndPrice: rows.filter(
			(r) => r.excluded === 'no_exit_price' || r.excluded === 'no_current_price' || r.excluded === 'no_dates'
		).length
	};
}
