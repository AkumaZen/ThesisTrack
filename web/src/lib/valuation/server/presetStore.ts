import { inArray, not, sql, like } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { companyCache, stageScanCache } from '$lib/server/db/valuationSchema';
import {
	hasCurrentPresets,
	matchedPresets,
	quarterlyGrowth,
	type PresetId,
	type QuarterRow,
	type QuarterlyGrowth
} from '../presetScans';
import type { Stage, StructuralResult } from '../stageScan';
import { getStageScanResult } from './stageScanEngine';
import { readFundamentalMetrics } from './fundamentalStore';
import { readLongRange } from './longRangeStore';
import { currentHigh5y } from '../longRange';

/** Latest-quarter growth for every company whose Screener results are stored. Reads only the
 *  `quarters` part of each stored record. Companies nobody has opened yet have no stored results
 *  and are simply absent: the growth preset cannot be judged for them. */
export async function readQuarterlyGrowth(symbols?: string[]): Promise<Map<string, QuarterlyGrowth>> {
	const rows = await db
		.select({ symbol: companyCache.symbol, quarters: sql<QuarterRow[] | null>`${companyCache.data}->'quarters'` })
		.from(companyCache)
		// Compare-page statements are stored under STMT: keys; they are not company results.
		.where(
			symbols
				? inArray(companyCache.symbol, symbols.map((s) => s.toUpperCase()))
				: not(like(companyCache.symbol, 'STMT:%'))
		);
	const out = new Map<string, QuarterlyGrowth>();
	for (const r of rows) {
		const g = quarterlyGrowth(r.quarters);
		if (g) out.set(r.symbol, g);
	}
	return out;
}

/** The presets each symbol passes now, from the stored scan results (no recompute, no Angel One).
 *  A symbol with no stored scan result is absent. Relative strength is judged against the stored
 *  Nifty 500 only; the universe-rank fallback needs the whole scanned list, so it is left to the
 *  scanner page. */
export async function presetMatchesFor(symbols: string[]): Promise<Record<string, PresetId[]>> {
	const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
	if (wanted.length === 0) return {};
	const [rows, growth, fundamentals, longRange] = await Promise.all([
		db
			.select({ symbol: stageScanCache.symbol, structural: stageScanCache.structural })
			.from(stageScanCache)
			.where(inArray(stageScanCache.symbol, wanted)),
		readQuarterlyGrowth(wanted),
		// Stored statements and 5-year highs feed the fundamental and 5-year-high presets; absent ones just cannot match.
		readFundamentalMetrics(wanted).catch(() => new Map()),
		readLongRange().catch(() => new Map())
	]);
	const out: Record<string, PresetId[]> = {};
	for (const r of rows) {
		const s = r.structural as StructuralResult;
		if (!hasCurrentPresets(s)) continue; // saved before the preset or technical numbers existed
		out[r.symbol] = matchedPresets({
			stage: s.stage as Stage,
			metrics: s.presets,
			growth: growth.get(r.symbol) ?? null,
			fundamentals: fundamentals.get(r.symbol) ?? null,
			high5y: longRange.has(r.symbol) ? currentHigh5y(longRange.get(r.symbol)!.high5y, s.presets?.high52) : null
		});
	}
	return out;
}

/** Scan Match for one company page: the stored result when there is one, else one computed now
 *  from the stored prices (no live quote). Null when the company has no stored prices to scan. */
export async function scanMatchFor(symbol: string): Promise<PresetId[] | null> {
	const key = symbol.toUpperCase();
	const stored = (await presetMatchesFor([key]))[key];
	if (stored) return stored;
	const result = await getStageScanResult(key, { allowLive: false });
	if (!result) return null;
	return matchedPresets({
		stage: result.stage,
		metrics: result.presets,
		growth: (await readQuarterlyGrowth([key])).get(key) ?? null,
		fundamentals: (await readFundamentalMetrics([key]).catch(() => new Map())).get(key) ?? null
	});
}
