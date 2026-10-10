import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { masterTrackerCompanies as companies, masterTrackerResearch as research, masterTrackerPreviews as previews } from '$lib/server/db/valuationSchema';
import type { Preview, Research, TrackerCompany } from '../masterTracker';
import { trackerMocksEnabled } from './masterTrackerMock';
import { getSavedValuationRow, saveSavedValuationRow, resetMockSavedValuations } from './savedValuationsStore';
import { trackerWatchlistRecord } from '../trackerWatchlist';

const mock = { companies: new Map<string, TrackerCompany>(), research: new Map<string, Research>(), previews: new Map<string, Preview>() };
export function resetMockTracker() { if (!trackerMocksEnabled()) throw new Error('Test mode is disabled'); Object.values(mock).forEach((m) => m.clear()); resetMockSavedValuations(); }
export class TrackerConflict extends Error { constructor() { super('This company changed. Reload and review the latest version before saving.'); } }
export async function listTrackerCompanies(): Promise<TrackerCompany[]> {
	if (trackerMocksEnabled()) return structuredClone([...mock.companies.values()]);
	return (await db.select().from(companies)).map((row) => row.state as TrackerCompany);
}
export async function getTrackerCompany(symbol: string): Promise<TrackerCompany | null> {
	if (trackerMocksEnabled()) return structuredClone(mock.companies.get(symbol) ?? null);
	const [row] = await db.select().from(companies).where(eq(companies.symbol, symbol)); return row?.state as TrackerCompany ?? null;
}
export async function createTrackerCompany(company: TrackerCompany) {
	if (trackerMocksEnabled()) { if (mock.companies.has(company.symbol)) throw new TrackerConflict(); mock.companies.set(company.symbol, structuredClone(company)); return; }
	const rows = await db.insert(companies).values({ symbol: company.symbol, state: company, version: company.version }).onConflictDoNothing().returning();
	if (!rows.length) throw new TrackerConflict();
}
export async function updateTrackerCompany(company: TrackerCompany, baseVersion: number, preview?: Preview, syncValuation = false) {
	const existing = syncValuation ? await getSavedValuationRow(company.symbol) : null;
	const watchlistBody = syncValuation && company.valuation ? { ...trackerWatchlistRecord(company, company.valuation, existing), baseVersion: preview?.watchlistBaseVersion ?? existing?.version ?? 0 } : null;
	const saveWatchlist = async (tx?: Parameters<typeof saveSavedValuationRow>[3]) => {
		if (watchlistBody && !(await saveSavedValuationRow(company.symbol, watchlistBody, company.updatedBy, tx)).ok) throw new TrackerConflict();
	};
	if (trackerMocksEnabled()) {
		if (mock.companies.get(company.symbol)?.version !== baseVersion || (preview && !mock.previews.has(preview.id))) throw new TrackerConflict();
		await saveWatchlist();
		mock.companies.set(company.symbol, structuredClone(company)); if (preview) mock.previews.delete(preview.id); return;
	}
	await db.transaction(async (tx) => {
		if (preview) {
			const removed = await tx.delete(previews).where(and(eq(previews.id, preview.id), eq(previews.userId, preview.userId))).returning();
			if (!removed.length) throw new TrackerConflict();
		}
		const changed = await tx.update(companies).set({ state: company, version: company.version }).where(and(eq(companies.symbol, company.symbol), eq(companies.version, baseVersion))).returning();
		if (!changed.length) throw new TrackerConflict();
		await saveWatchlist(tx);
	});
}
export async function getTrackerResearch(key: string): Promise<Research | null> {
	if (trackerMocksEnabled()) return structuredClone(mock.research.get(key) ?? null);
	const [row] = await db.select().from(research).where(eq(research.key, key)); return row?.data as Research ?? null;
}
export async function saveTrackerResearch(key: string, symbol: string, data: Research) {
	if (trackerMocksEnabled()) { mock.research.set(key, structuredClone(data)); return; }
	await db.insert(research).values({ key, symbol, data }).onConflictDoUpdate({ target: research.key, set: { data } });
}
export async function saveTrackerPreview(data: Preview) {
	if (trackerMocksEnabled()) { for (const [id, p] of mock.previews) if (p.userId === data.userId && p.symbol === data.symbol) mock.previews.delete(id); mock.previews.set(data.id, structuredClone(data)); return; }
	await db.transaction(async (tx) => {
		await tx.delete(previews).where(and(eq(previews.symbol, data.symbol), eq(previews.userId, data.userId)));
		await tx.insert(previews).values({ id: data.id, symbol: data.symbol, userId: data.userId, data });
	});
}
export async function getTrackerPreview(id: string, userId: number): Promise<Preview | null> {
	if (trackerMocksEnabled()) { const p = mock.previews.get(id); return p?.userId === userId ? structuredClone(p) : null; }
	const [row] = await db.select().from(previews).where(and(eq(previews.id, id), eq(previews.userId, userId))); return row?.data as Preview ?? null;
}
export async function listTrackerPreviews(userId: number): Promise<Preview[]> {
	if (trackerMocksEnabled()) return structuredClone([...mock.previews.values()].filter((p) => p.userId === userId));
	return (await db.select().from(previews).where(eq(previews.userId, userId))).map((r) => r.data as Preview);
}
export async function discardTrackerPreview(id: string, userId: number) {
	if (trackerMocksEnabled()) { if (mock.previews.get(id)?.userId === userId) mock.previews.delete(id); return; }
	await db.delete(previews).where(and(eq(previews.id, id), eq(previews.userId, userId)));
}
