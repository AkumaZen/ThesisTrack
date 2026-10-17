// Scorecard part A: the buy price recorded on a thesis. Reads STORED prices only (never Angel One
// for a price; the instrument list is a public file used just to tell "no price source" from
// "not stored yet"). Rules live in $lib/entryPrice.js so they can be tested without a database.
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { thesisScenarios } from '../db/schema';
import { readCachedCloses } from '$lib/valuation/server/companyGrowthSeries';
import { angelListings } from '$lib/valuation/server/angelone';
import { closeOnOrBefore, latestClose, resolveEntryPrice } from '$lib/entryPrice.js';

export class EntryPriceError extends Error {}

/** Today in India (the market's calendar), as YYYY-MM-DD. */
export function todayIst(now = new Date()): string {
	return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function priceSymbol(c: { nseTicker?: string | null; bseTicker?: string | null }): string | null {
	return (c.nseTicker || c.bseTicker || null)?.toUpperCase() ?? null;
}

export interface StoredLookup {
	symbol: string | null;
	stored: { date: string; price: number } | null;
	/** false = Angel One has no listing (no price source); null = unknown. */
	listed: boolean | null;
	latest: { date: string; price: number } | null;
}

/** What is stored for the company on/before `date`, plus whether a price source exists at all. */
export async function lookupStored(
	c: { nseTicker?: string | null; bseTicker?: string | null },
	date: string,
	checkListing = true
): Promise<StoredLookup> {
	const symbol = priceSymbol(c);
	if (!symbol) return { symbol, stored: null, listed: false, latest: null };
	const series = (await readCachedCloses([symbol])).get(symbol);
	const stored = series ? closeOnOrBefore(series.dates, series.closes, date) : null;
	const latest = series ? latestClose(series.dates, series.closes) : null;
	let listed: boolean | null = latest ? true : null;
	if (!latest && checkListing) listed = (await angelListings([symbol]).catch(() => null))?.get(symbol) ?? null;
	return { symbol, stored, listed, latest };
}

export interface EntryInput {
	entry_price?: number;
	entry_date?: string;
}

export interface ResolvedEntry {
	price: number | null;
	date: string | null;
	source: 'manual' | 'auto' | 'no_data';
}

export function validateEntryDate(date: string, today = todayIst()): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return 'entry_date must be a real date (YYYY-MM-DD)';
	if (date > today) return 'entry_date cannot be in the future';
	return null;
}

/** Applies the fallback chain for a new/amended thesis. Throws EntryPriceError (a 422) when a
 *  listed company has neither a typed price nor a stored close. */
export async function resolveForCompany(
	c: { nseTicker?: string | null; bseTicker?: string | null },
	input: EntryInput
): Promise<ResolvedEntry> {
	const date = input.entry_date ?? todayIst();
	const bad = validateEntryDate(date);
	if (bad) throw new EntryPriceError(bad);
	const look = input.entry_price != null ? null : await lookupStored(c, date);
	const r = resolveEntryPrice({
		manual: input.entry_price ?? null,
		date,
		stored: look?.stored ?? null,
		listed: look?.listed ?? null
	});
	if (!r.ok) throw new EntryPriceError(r.error);
	return { price: r.price, date: r.priceDate ?? date, source: r.source as ResolvedEntry['source'] };
}

/** Column values for thesis_scenarios from a resolved entry. */
export function entryColumns(e: ResolvedEntry) {
	return {
		entryPrice: e.price != null ? String(e.price) : null,
		entryDate: e.date,
		entryPriceSource: e.source,
		needsPrice: false
	};
}

/** Columns for a thesis created without an entry price (internal callers): flagged for backfill. */
export const NEEDS_PRICE_COLUMNS = { entryPrice: null, entryPriceSource: null, needsPrice: true } as const;

/** Amend: a typed price or a date re-resolves the entry (null = leave it alone). Call BEFORE
 *  writing anything so a missing price rejects the whole amendment. */
export async function resolveAmendEntry(
	company: { nseTicker?: string | null; bseTicker?: string | null },
	input: EntryInput
): Promise<ResolvedEntry | null> {
	if (input.entry_price == null && input.entry_date == null) return null;
	return resolveForCompany(company, input);
}

export async function saveEntry(companyId: string, owner: string, entry: ResolvedEntry) {
	await db
		.update(thesisScenarios)
		.set({ ...entryColumns(entry), updatedAt: new Date() })
		.where(and(eq(thesisScenarios.companyId, companyId), eq(thesisScenarios.owner, owner)));
}
