/**
 * Saved scans: the scanner's filters kept under a name, evaluated against the stored scan results, and
 * compared between days. Pure: the loader supplies the scan entries and the stored fundamentals.
 */
import { MCAP_BANDS } from './mcapUniverse.js';
import {
	PRESETS,
	matchedPresets,
	percentileRanks,
	type PresetId,
	type PresetInput,
	type QuarterlyGrowth
} from './presetScans';
import type { FundamentalMetrics } from './fundamentals';
import { currentHigh5y } from './longRange';
import { matchesFilters, SIGNALS, UNCLASSIFIED, type ScanEntry, type SignalKey } from './scannerFilters';
import type { Stage } from './stageScan';

const STAGE_IDS: Stage[] = [
	'Confirmed Stage 2 Breakout',
	'Near Stage 2 Breakout',
	'Stage 2 Advancing',
	'Stage 1 Base',
	'Stage 3',
	'Stage 4',
	'Not classified / insufficient data'
];

export const MAX_SCAN_NAME = 60;
/** A person's saved scans are capped so the daily job stays within the function time limit. */
export const MAX_SCANS_PER_USER = 20;

export interface SavedScanConfig {
	stage: Stage | 'all';
	/** A sector basket label, UNCLASSIFIED, or '' for every sector. */
	sector: string;
	/** A market cap band key or 'all'. */
	band: string;
	signal: SignalKey;
	query: string;
	preset: PresetId | 'all';
}

export const DEFAULT_SCAN_CONFIG: SavedScanConfig = {
	stage: 'all',
	sector: '',
	band: 'all',
	signal: 'all',
	query: '',
	preset: 'all'
};

/** Validates untrusted JSON into a config, or null when any field is not a known value. */
export function parseScanConfig(value: unknown): SavedScanConfig | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	const str = (x: unknown, max: number) => (typeof x === 'string' && x.length <= max ? x : null);
	const stage = v.stage === 'all' || STAGE_IDS.includes(v.stage as Stage) ? (v.stage as SavedScanConfig['stage']) : null;
	const sector = str(v.sector, 120);
	const query = str(v.query, 80);
	const band = v.band === 'all' || MCAP_BANDS.some((b: { key: string }) => b.key === v.band) ? (v.band as string) : null;
	const signal = SIGNALS.some((s) => s.key === v.signal) ? (v.signal as SignalKey) : null;
	const preset = v.preset === 'all' || PRESETS.some((p) => p.id === v.preset) ? (v.preset as SavedScanConfig['preset']) : null;
	if (stage === null || sector === null || query === null || band === null || signal === null || preset === null) return null;
	return { stage, sector, band, signal, query, preset };
}

/** A scan name made safe to store: trimmed, no control characters, at most MAX_SCAN_NAME long; null when empty. */
export function cleanScanName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const name = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SCAN_NAME);
	return name || null;
}

/** The filters in plain words, for the saved-scan list. */
export function describeScanConfig(c: SavedScanConfig): string[] {
	const parts: string[] = [];
	if (c.preset !== 'all') parts.push(PRESETS.find((p) => p.id === c.preset)?.label ?? c.preset);
	if (c.stage !== 'all') parts.push(c.stage);
	if (c.signal !== 'all') parts.push(SIGNALS.find((s) => s.key === c.signal)?.label ?? c.signal);
	if (c.sector) parts.push(c.sector === UNCLASSIFIED ? 'Unclassified sector' : c.sector);
	if (c.band !== 'all') parts.push((MCAP_BANDS as { key: string; label: string }[]).find((b) => b.key === c.band)?.label ?? c.band);
	if (c.query.trim()) parts.push(`"${c.query.trim()}"`);
	return parts.length ? parts : ['Everything scanned'];
}

/** Stored numbers a scan needs besides the scan results themselves. */
export interface ScanInputs {
	growth: Record<string, QuarterlyGrowth | undefined>;
	fundamentals: Record<string, FundamentalMetrics | undefined>;
	/** Stored 5-year highs by symbol. */
	high5y: Record<string, number | undefined>;
}

/** The symbols a config matches, sorted. Mirrors the scanner page: the same filters, the same preset test,
 *  and the same universe-rank fallback for relative strength. */
export function evaluateScan(config: SavedScanConfig, entries: ScanEntry[], inputs: ScanInputs): string[] {
	const rank3m = percentileRanks(new Map(entries.map((x) => [x.symbol, x.r.presets?.ret3m ?? null])));
	const rank6m = percentileRanks(new Map(entries.map((x) => [x.symbol, x.r.presets?.ret6m ?? null])));
	const out: string[] = [];
	for (const x of entries) {
		if (!matchesFilters(x, { stage: config.stage, sector: config.sector, band: config.band, signal: config.signal, query: config.query })) continue;
		if (config.preset !== 'all') {
			const a = rank3m.get(x.symbol);
			const b = rank6m.get(x.symbol);
			const input: PresetInput = {
				stage: x.r.stage,
				metrics: x.r.presets,
				growth: inputs.growth[x.symbol] ?? null,
				fundamentals: inputs.fundamentals[x.symbol] ?? null,
				high5y: x.symbol in inputs.high5y ? currentHigh5y(inputs.high5y[x.symbol], x.r.presets?.high52) : null,
				universeRank: a != null && b != null ? { r3m: a, r6m: b } : null
			};
			if (!matchedPresets(input).includes(config.preset)) continue;
		}
		out.push(x.symbol);
	}
	return out.sort();
}

export interface SnapshotDiff {
	added: string[];
	removed: string[];
	unchanged: number;
}

/** What entered and left a scan between two snapshots (`previous` null: nothing to compare against, so nothing is "new"). */
export function diffSnapshots(previous: string[] | null, current: string[]): SnapshotDiff {
	if (!previous) return { added: [], removed: [], unchanged: current.length };
	const before = new Set(previous);
	const now = new Set(current);
	const added = current.filter((s) => !before.has(s));
	const removed = previous.filter((s) => !now.has(s));
	return { added, removed, unchanged: current.length - added.length };
}

/** The scanner address that applies a saved scan. */
export const scanOpenHref = (id: string) => `/valuation/stage-scanner?scan=${encodeURIComponent(id)}`;
export const scanShareHref = (id: string) => `/valuation/scans/shared/${encodeURIComponent(id)}`;

export const isScanId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
