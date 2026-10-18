import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { stageScanCache, savedScans, scanSnapshots } from '$lib/server/db/valuationSchema';
import { users } from '$lib/server/db/schema';
import { hasCurrentPresets } from '../presetScans';
import { combineLiveOverlay, resultParamsKey, scanParamsKey, type LiveQuote, type StructuralResult } from '../stageScan';
import { evaluateScan, parseScanConfig, type SavedScanConfig, type ScanInputs } from '../savedScans';
import type { ScanEntry } from '../scannerFilters';
import { getAnalysisSettings } from './analysisSettingsStore';
import { readFundamentalMetrics } from './fundamentalStore';
import { readLongRange } from './longRangeStore';
import { listActiveUniverse, type UniverseCompany } from './mcapUniverseStore';
import { readQuarterlyGrowth } from './presetStore';
import { getSymbolNames, listAllBaskets } from './sectorStore';

export interface SavedScan {
	id: string;
	ownerId: number;
	ownerName: string;
	name: string;
	config: SavedScanConfig;
	notify: boolean;
	createdAt: Date;
}

type Row = typeof savedScans.$inferSelect & { ownerName: string };

function toScan(r: Row): SavedScan | null {
	const config = parseScanConfig(r.config);
	// A config no longer valid (a preset removed in a later release) cannot be run; skip it rather than guess.
	return config ? { id: r.id, ownerId: r.ownerId, ownerName: r.ownerName, name: r.name, config, notify: r.notify, createdAt: r.createdAt } : null;
}

const selectScans = () =>
	db
		.select({
			id: savedScans.id,
			ownerId: savedScans.ownerId,
			name: savedScans.name,
			config: savedScans.config,
			notify: savedScans.notify,
			createdAt: savedScans.createdAt,
			updatedAt: savedScans.updatedAt,
			ownerName: users.displayName
		})
		.from(savedScans)
		.innerJoin(users, eq(users.id, savedScans.ownerId));

export async function listScans(ownerId: number): Promise<SavedScan[]> {
	const rows = await selectScans().where(eq(savedScans.ownerId, ownerId)).orderBy(asc(savedScans.createdAt));
	return rows.map(toScan).filter((s): s is SavedScan => s != null);
}

export async function listAllScans(): Promise<SavedScan[]> {
	const rows = await selectScans().orderBy(asc(savedScans.createdAt));
	return rows.map(toScan).filter((s): s is SavedScan => s != null);
}

export async function getScan(id: string): Promise<SavedScan | null> {
	const [row] = await selectScans().where(eq(savedScans.id, id));
	return row ? toScan(row) : null;
}

export async function countScans(ownerId: number): Promise<number> {
	return (await db.select({ id: savedScans.id }).from(savedScans).where(eq(savedScans.ownerId, ownerId))).length;
}

export async function createScan(ownerId: number, name: string, config: SavedScanConfig, notify: boolean): Promise<string> {
	const [row] = await db.insert(savedScans).values({ ownerId, name, config, notify }).returning({ id: savedScans.id });
	return row.id;
}

/** Changes the name and/or the alert switch of the owner's own scan. False when it is not theirs. */
export async function updateScan(id: string, ownerId: number, patch: { name?: string; notify?: boolean }): Promise<boolean> {
	const rows = await db
		.update(savedScans)
		.set({ ...patch, updatedAt: new Date() })
		.where(and(eq(savedScans.id, id), eq(savedScans.ownerId, ownerId)))
		.returning({ id: savedScans.id });
	return rows.length > 0;
}

export async function deleteScan(id: string, ownerId: number): Promise<boolean> {
	const rows = await db
		.delete(savedScans)
		.where(and(eq(savedScans.id, id), eq(savedScans.ownerId, ownerId)))
		.returning({ id: savedScans.id });
	return rows.length > 0;
}

// ---- Evaluating a scan against the stored scan results ----

export interface ScanContext {
	entries: ScanEntry[];
	inputs: ScanInputs;
	/** The newest session date among the stored scan results: what a snapshot is dated. */
	dataDate: string | null;
}

/** The scanner's stored results (no recompute, no Angel One) with the numbers its presets need. Results
 *  saved under other settings, or before the preset numbers existed, are left out like the scanner does. */
export async function loadScanContext(): Promise<ScanContext> {
	const [baskets, rows, settings, listed, growth, fundamentals, longRange] = await Promise.all([
		listAllBaskets(),
		db.select().from(stageScanCache),
		getAnalysisSettings(),
		listActiveUniverse().catch((): UniverseCompany[] => []),
		readQuarterlyGrowth().catch(() => new Map()),
		readFundamentalMetrics().catch(() => new Map()),
		readLongRange().catch(() => new Map())
	]);
	const basketsBySymbol = new Map<string, string[]>();
	for (const b of baskets) for (const s of b.symbols) basketsBySymbol.set(s, [...(basketsBySymbol.get(s) ?? []), b.label]);
	const mcap = new Map<string, number>();
	const names: Record<string, string> = {};
	for (const c of listed) {
		if (!c.symbol) continue;
		mcap.set(c.symbol, c.marketCapCr);
		names[c.symbol] = c.name;
	}
	Object.assign(names, await getSymbolNames([...basketsBySymbol.keys()]));

	const key = scanParamsKey(settings.scan);
	const entries: ScanEntry[] = [];
	let dataDate: string | null = null;
	for (const r of rows) {
		const structural = r.structural as StructuralResult;
		if (resultParamsKey(structural) !== key || !hasCurrentPresets(structural)) continue;
		if (!basketsBySymbol.has(r.symbol) && !mcap.has(r.symbol)) continue; // no longer in the universe
		if (!dataDate || r.structuralSourceDate > dataDate) dataDate = r.structuralSourceDate;
		entries.push({
			symbol: r.symbol,
			name: names[r.symbol] ?? r.symbol,
			baskets: basketsBySymbol.get(r.symbol) ?? [],
			mcapCr: mcap.get(r.symbol) ?? null,
			r: combineLiveOverlay(structural, (r.live as LiveQuote | null) ?? null)
		});
	}
	return {
		entries,
		inputs: {
			growth: Object.fromEntries(growth),
			fundamentals: Object.fromEntries(fundamentals),
			high5y: Object.fromEntries([...longRange].map(([symbol, v]) => [symbol, v.high5y]))
		},
		dataDate
	};
}

export const evaluateInContext = (config: SavedScanConfig, ctx: ScanContext): string[] => evaluateScan(config, ctx.entries, ctx.inputs);

// ---- Snapshots ----

/** Stores (or replaces) the matches of a scan for one date. */
export async function saveSnapshot(scanId: string, snapDate: string, symbols: string[]): Promise<void> {
	await db
		.insert(scanSnapshots)
		.values({ scanId, snapDate, symbols })
		.onConflictDoUpdate({ target: [scanSnapshots.scanId, scanSnapshots.snapDate], set: { symbols } });
}

/** Snapshot dates of a scan, newest first. */
export async function listSnapshotDates(scanId: string, limit = 60): Promise<string[]> {
	const rows = await db
		.select({ d: scanSnapshots.snapDate })
		.from(scanSnapshots)
		.where(eq(scanSnapshots.scanId, scanId))
		.orderBy(desc(scanSnapshots.snapDate))
		.limit(limit);
	return rows.map((r) => r.d);
}

export async function getSnapshot(scanId: string, snapDate: string): Promise<string[] | null> {
	const [row] = await db
		.select({ symbols: scanSnapshots.symbols })
		.from(scanSnapshots)
		.where(and(eq(scanSnapshots.scanId, scanId), eq(scanSnapshots.snapDate, snapDate)));
	return row ? row.symbols : null;
}

/** The newest snapshot strictly before a date, or null. */
export async function snapshotBefore(scanId: string, snapDate: string): Promise<{ date: string; symbols: string[] } | null> {
	const [row] = await db
		.select({ d: scanSnapshots.snapDate, symbols: scanSnapshots.symbols })
		.from(scanSnapshots)
		.where(and(eq(scanSnapshots.scanId, scanId), lt(scanSnapshots.snapDate, snapDate)))
		.orderBy(desc(scanSnapshots.snapDate))
		.limit(1);
	return row ? { date: row.d, symbols: row.symbols } : null;
}
