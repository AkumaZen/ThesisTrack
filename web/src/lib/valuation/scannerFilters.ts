import type { Stage, StageScanResult } from './stageScan';
import { mcapBand } from './mcapUniverse.js';

// How the breakout scanner's filters combine. Pure, so the page stays thin and the rules are tested.

/** The sector filter's value for companies that sit in no sector basket. */
export const UNCLASSIFIED = 'Unclassified';

/** Breakout type: signals the scan already produces (stage, last confirmed breakout, live price
 *  above resistance, volume), not new rules. */
export const SIGNALS = [
	{ key: 'all', label: 'Any breakout signal' },
	{ key: 'confirmed', label: 'Confirmed breakout (close)' },
	{ key: 'on_record', label: 'Has a confirmed breakout on record' },
	{ key: 'above_today', label: 'Above resistance today, awaiting close' },
	{ key: 'vol_breakout', label: 'Breakout-level volume' },
	{ key: 'vol_building', label: 'Volume building' }
] as const;
export type SignalKey = (typeof SIGNALS)[number]['key'];

export function signalMatches(r: StageScanResult, signal: SignalKey): boolean {
	switch (signal) {
		case 'all':
			return true;
		case 'confirmed':
			return r.stage === 'Confirmed Stage 2 Breakout';
		case 'on_record':
			return r.breakout != null;
		case 'above_today':
			return r.intradayAboveResistance && r.stage !== 'Confirmed Stage 2 Breakout';
		case 'vol_breakout':
			return r.volumeTier === 'Breakout-confirmation';
		case 'vol_building':
			return r.volumeSurgeWarning;
	}
}

export interface ScanEntry {
	symbol: string;
	name: string;
	/** Sector baskets the company sits in; empty means Unclassified. */
	baskets: string[];
	/** Six-month average market cap in Rs crore, null when the company is not on the list. */
	mcapCr: number | null;
	r: StageScanResult;
}

export interface ScanFilters {
	stage: Stage | 'all';
	/** A basket label, UNCLASSIFIED, or '' for every sector. */
	sector: string;
	/** A market cap band key (lib/valuation/mcapUniverse.js), or 'all'. */
	band: string;
	signal: SignalKey;
	query: string;
}

/** Every filter must hold (they narrow one another). */
export function matchesFilters(e: ScanEntry, f: ScanFilters): boolean {
	if (f.stage !== 'all' && e.r.stage !== f.stage) return false;
	if (f.sector) {
		const inSector = f.sector === UNCLASSIFIED ? e.baskets.length === 0 : e.baskets.includes(f.sector);
		if (!inSector) return false;
	}
	if (f.band !== 'all' && mcapBand(e.mcapCr) !== f.band) return false;
	if (!signalMatches(e.r, f.signal)) return false;
	const q = f.query.trim().toLowerCase();
	return !q || e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q);
}

/** The sector options: every basket label, and Unclassified when some company has none. */
export function sectorOptions(baskets: string[], hasUnclassified: boolean): string[] {
	const labels = [...new Set(baskets)].sort((a, b) => a.localeCompare(b));
	return hasUnclassified ? [...labels, UNCLASSIFIED] : labels;
}
