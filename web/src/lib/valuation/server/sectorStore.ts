import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { appMeta, sectorBaskets, sectorMajors, symbolNameCache, userSectors } from '$lib/server/db/valuationSchema';
import {
	CUSTOM_SECTORS,
	MAJOR_SECTORS,
	type CustomSector,
	type MajorSector
} from './customSectors';
import { SYMBOL_NAMES } from '../symbolNames';
import { KEY_RE, SYMBOL_RE, normalizeSymbol, uniqueKey } from '../sectorEdit';

/** An expected, user-facing failure (bad input, name collision, missing row) — the API layer
 *  turns it into a 4xx with this message; anything else stays a 500. */
export class SectorEditError extends Error {
	constructor(
		public status: 400 | 404 | 409,
		message: string
	) {
		super(message);
	}
}

// ---------------------------------------------------------------------------------------------
// Seeding: the hand-curated taxonomy in customSectors.ts (plus any legacy user_sectors imports)
// is copied into Postgres exactly once, the first time the tables are found empty. From then on
// the DB is the only source of truth and customSectors.ts is just seed data.
// ---------------------------------------------------------------------------------------------

let seeding: Promise<void> | null = null;

function ensureSeeded(): Promise<void> {
	seeding ??= seed().catch((e) => {
		seeding = null; // let the next call retry rather than caching a failure forever
		throw e;
	});
	return seeding;
}

// Once seeded, the flag stays: an admin who deletes every sector must not see the built-in
// taxonomy come back on the next restart just because the tables are empty.
const SEEDED_FLAG = 'sector_seeded';

async function markSeeded(): Promise<void> {
	await db.insert(appMeta).values({ key: SEEDED_FLAG, value: '1' }).onConflictDoNothing();
}

async function seed(): Promise<void> {
	const [seeded] = await db.select().from(appMeta).where(eq(appMeta.key, SEEDED_FLAG));
	if (seeded) return;

	const [majorCount, basketCount] = await Promise.all([
		db.select({ n: sql<number>`count(*)::int` }).from(sectorMajors),
		db.select({ n: sql<number>`count(*)::int` }).from(sectorBaskets)
	]);
	if (majorCount[0].n > 0 || basketCount[0].n > 0) {
		await markSeeded();
		return;
	}

	const legacy = await db.select().from(userSectors).orderBy(asc(userSectors.createdAt));

	const baskets = new Map<string, CustomSector>();
	for (const s of CUSTOM_SECTORS) baskets.set(s.key, s);
	const majors: MajorSector[] = [...MAJOR_SECTORS];
	for (const row of legacy) {
		const subs = row.subsectors as { key: string; label: string; symbols: string[] }[];
		for (const s of subs) if (!baskets.has(s.key)) baskets.set(s.key, s);
		majors.push({ key: row.key, label: row.label, subsectorKeys: subs.map((s) => s.key) });
	}

	await db.transaction(async (tx) => {
		await tx
			.insert(sectorBaskets)
			.values(
				[...baskets.values()].map((s) => ({ key: s.key, label: s.label, symbols: s.symbols }))
			)
			.onConflictDoNothing();
		await tx
			.insert(sectorMajors)
			.values(
				majors.map((m, i) => ({
					key: m.key,
					label: m.label,
					position: i,
					subsectorKeys: m.subsectorKeys
				}))
			)
			.onConflictDoNothing();
		await tx.insert(appMeta).values({ key: SEEDED_FLAG, value: '1' }).onConflictDoNothing();
	});
	console.log(`[sector-store] seeded ${majors.length} major sectors, ${baskets.size} baskets`);
}

// ---------------------------------------------------------------------------------------------
// Reads — every route/API/scheduler resolves sectors through these.
// ---------------------------------------------------------------------------------------------

export async function listAllMajorSectors(): Promise<MajorSector[]> {
	await ensureSeeded();
	const rows = await db.select().from(sectorMajors).orderBy(asc(sectorMajors.position));
	return rows.map((r) => ({ key: r.key, label: r.label, subsectorKeys: r.subsectorKeys }));
}

export async function listAllBaskets(): Promise<CustomSector[]> {
	await ensureSeeded();
	const rows = await db.select().from(sectorBaskets).orderBy(asc(sectorBaskets.label));
	return rows.map((r) => ({ key: r.key, label: r.label, symbols: r.symbols }));
}

export async function findAnyMajorSector(key: string): Promise<MajorSector | null> {
	await ensureSeeded();
	const [r] = await db.select().from(sectorMajors).where(eq(sectorMajors.key, key));
	return r ? { key: r.key, label: r.label, subsectorKeys: r.subsectorKeys } : null;
}

export async function findAnyCustomSector(key: string): Promise<CustomSector | null> {
	await ensureSeeded();
	const [r] = await db.select().from(sectorBaskets).where(eq(sectorBaskets.key, key));
	return r ? { key: r.key, label: r.label, symbols: r.symbols } : null;
}

/** Every unique symbol across all baskets — the universe the background schedulers keep warm. */
export async function listAllSymbols(): Promise<string[]> {
	const baskets = await listAllBaskets();
	return Array.from(new Set(baskets.flatMap((b) => b.symbols))).sort();
}

/** Real company names: the original hand-verified static map plus names captured at
 *  verification time for symbols added through the Sector Manager. */
export async function getSymbolNames(symbols: string[]): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	const missing: string[] = [];
	for (const s of symbols) {
		const known = SYMBOL_NAMES[s];
		if (known) out[s] = known;
		else missing.push(s);
	}
	if (missing.length > 0) {
		const rows = await db
			.select()
			.from(symbolNameCache)
			.where(inArray(symbolNameCache.symbol, missing));
		for (const r of rows) out[r.symbol] = r.name;
	}
	return out;
}

export async function rememberSymbolName(symbol: string, name: string): Promise<void> {
	await db
		.insert(symbolNameCache)
		.values({ symbol, name })
		.onConflictDoUpdate({ target: symbolNameCache.symbol, set: { name } });
}

/** Snapshot for the Sector Manager page: whole taxonomy plus names for every symbol. */
export async function getTaxonomySnapshot() {
	const [majors, baskets] = await Promise.all([listAllMajorSectors(), listAllBaskets()]);
	const names = await getSymbolNames(Array.from(new Set(baskets.flatMap((b) => b.symbols))));
	return { majors, baskets, names };
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

function cleanLabel(raw: unknown, what: string): string {
	if (typeof raw !== 'string' || raw.trim().length === 0) {
		throw new SectorEditError(400, `${what} name can't be empty.`);
	}
	const label = raw.trim();
	if (label.length > 80) throw new SectorEditError(400, `${what} name is too long (max 80).`);
	return label;
}

function cleanSymbol(raw: unknown): string {
	const symbol = typeof raw === 'string' ? normalizeSymbol(raw) : '';
	if (!SYMBOL_RE.test(symbol)) {
		throw new SectorEditError(400, `"${String(raw)}" isn't a valid NSE symbol shape.`);
	}
	return symbol;
}

/** Keys are derived from labels by reading every existing key first, so two simultaneous creates
 *  with the same label would both pick the same key and one would fail on the primary key. A
 *  transaction-scoped advisory lock makes the second one wait and then see the first one's key. */
async function lockKeySpace(tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }) {
	await tx.execute(sql`select pg_advisory_xact_lock(7001)`);
}

export async function createMajor(rawLabel: unknown): Promise<MajorSector> {
	await ensureSeeded();
	const label = cleanLabel(rawLabel, 'Sector');
	return db.transaction(async (tx) => {
		await lockKeySpace(tx);
		const rows = await tx.select().from(sectorMajors);
		const key = uniqueKey(
			label,
			rows.map((r) => r.key)
		);
		const position = rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
		await tx.insert(sectorMajors).values({ key, label, position, subsectorKeys: [] });
		return { key, label, subsectorKeys: [] };
	});
}

export async function renameMajor(key: string, rawLabel: unknown): Promise<void> {
	await ensureSeeded();
	const label = cleanLabel(rawLabel, 'Sector');
	const res = await db
		.update(sectorMajors)
		.set({ label })
		.where(eq(sectorMajors.key, key))
		.returning();
	if (res.length === 0) throw new SectorEditError(404, `Unknown sector "${key}".`);
}

/** Removes the major sector only. Its baskets survive (they may belong to other majors, and
 *  the manager lists any left unassigned so nothing silently disappears). */
export async function deleteMajor(key: string): Promise<void> {
	await ensureSeeded();
	const res = await db.delete(sectorMajors).where(eq(sectorMajors.key, key)).returning();
	if (res.length === 0) throw new SectorEditError(404, `Unknown sector "${key}".`);
}

/** Creates a basket seeded with already-verified symbols and attaches it to `majorKey`. */
export async function createBasket(
	rawLabel: unknown,
	majorKey: string | null,
	rawSymbols: unknown[]
): Promise<CustomSector> {
	await ensureSeeded();
	const label = cleanLabel(rawLabel, 'Basket');
	const symbols = Array.from(new Set(rawSymbols.map(cleanSymbol)));
	if (symbols.length === 0) {
		throw new SectorEditError(400, 'A basket needs at least one company.');
	}
	return db.transaction(async (tx) => {
		await lockKeySpace(tx);
		const existing = await tx.select({ key: sectorBaskets.key }).from(sectorBaskets);
		const key = uniqueKey(
			label,
			existing.map((r) => r.key)
		);
		await tx.insert(sectorBaskets).values({ key, label, symbols });
		if (majorKey) {
			const [major] = await tx
				.select()
				.from(sectorMajors)
				.where(eq(sectorMajors.key, majorKey))
				.for('update');
			if (!major) throw new SectorEditError(404, `Unknown sector "${majorKey}".`);
			await tx
				.update(sectorMajors)
				.set({ subsectorKeys: [...major.subsectorKeys, key] })
				.where(eq(sectorMajors.key, majorKey));
		}
		return { key, label, symbols };
	});
}

export async function renameBasket(key: string, rawLabel: unknown): Promise<void> {
	await ensureSeeded();
	const label = cleanLabel(rawLabel, 'Basket');
	const res = await db
		.update(sectorBaskets)
		.set({ label })
		.where(eq(sectorBaskets.key, key))
		.returning();
	if (res.length === 0) throw new SectorEditError(404, `Unknown basket "${key}".`);
}

async function mutateSymbols(key: string, fn: (symbols: string[]) => string[]): Promise<string[]> {
	await ensureSeeded();
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(sectorBaskets)
			.where(eq(sectorBaskets.key, key))
			.for('update');
		if (!row) throw new SectorEditError(404, `Unknown basket "${key}".`);
		const next = fn(row.symbols);
		await tx.update(sectorBaskets).set({ symbols: next }).where(eq(sectorBaskets.key, key));
		return next;
	});
}

/** The caller (API layer) is responsible for having verified `symbol` first. */
export function addSymbolToBasket(key: string, rawSymbol: unknown): Promise<string[]> {
	const symbol = cleanSymbol(rawSymbol);
	return mutateSymbols(key, (symbols) => {
		if (symbols.includes(symbol)) {
			throw new SectorEditError(409, `${symbol} is already in this basket.`);
		}
		return [...symbols, symbol];
	});
}

export function removeSymbolFromBasket(key: string, rawSymbol: unknown): Promise<string[]> {
	const symbol = cleanSymbol(rawSymbol);
	return mutateSymbols(key, (symbols) => {
		if (!symbols.includes(symbol)) {
			throw new SectorEditError(404, `${symbol} isn't in this basket.`);
		}
		if (symbols.length === 1) {
			throw new SectorEditError(
				400,
				'A basket needs at least one company - delete the basket instead.'
			);
		}
		return symbols.filter((s) => s !== symbol);
	});
}

/** Sets exactly which major sectors a basket belongs to (add, move, or share across several) in
 *  one transaction, so a "move" can never leave it in both places or in neither on a failure. */
export async function setBasketMajors(key: string, majorKeys: string[]): Promise<void> {
	await ensureSeeded();
	const wanted = new Set(majorKeys);
	await db.transaction(async (tx) => {
		const [basket] = await tx.select().from(sectorBaskets).where(eq(sectorBaskets.key, key));
		if (!basket) throw new SectorEditError(404, `Unknown basket "${key}".`);
		const majors = await tx.select().from(sectorMajors).for('update');
		const known = new Set(majors.map((m) => m.key));
		for (const k of wanted) {
			if (!known.has(k)) throw new SectorEditError(404, `Unknown sector "${k}".`);
		}
		for (const m of majors) {
			const has = m.subsectorKeys.includes(key);
			if (wanted.has(m.key) && !has) {
				await tx
					.update(sectorMajors)
					.set({ subsectorKeys: [...m.subsectorKeys, key] })
					.where(eq(sectorMajors.key, m.key));
			} else if (!wanted.has(m.key) && has) {
				await tx
					.update(sectorMajors)
					.set({ subsectorKeys: m.subsectorKeys.filter((k) => k !== key) })
					.where(eq(sectorMajors.key, m.key));
			}
		}
	});
}

/** Deletes the basket and drops it from every major sector that listed it. */
export async function deleteBasket(key: string): Promise<void> {
	await ensureSeeded();
	await db.transaction(async (tx) => {
		const majors = await tx.select().from(sectorMajors).for('update');
		for (const m of majors) {
			if (m.subsectorKeys.includes(key)) {
				await tx
					.update(sectorMajors)
					.set({ subsectorKeys: m.subsectorKeys.filter((k) => k !== key) })
					.where(eq(sectorMajors.key, m.key));
			}
		}
		const res = await tx.delete(sectorBaskets).where(eq(sectorBaskets.key, key)).returning();
		if (res.length === 0) throw new SectorEditError(404, `Unknown basket "${key}".`);
	});
}

// ---------------------------------------------------------------------------------------------
// JSON import (the Sector Rotation page's "Import sector" panel) — now writes into the same
// editable tables, so an imported sector can be renamed/edited/deleted like any other.
// ---------------------------------------------------------------------------------------------

export interface UserSectorSubsectorInput {
	key: string;
	label: string;
	symbols: string[];
}

export interface UserSectorInput {
	key: string;
	label: string;
	subsectors: UserSectorSubsectorInput[];
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === 'string' && v.trim().length > 0;
}

/** Validates a raw import payload against the existing key-space so a new import can never
 *  silently collide with or shadow another sector's basket. */
export async function validateUserSectorInput(
	raw: unknown
): Promise<{ input: UserSectorInput } | { error: string }> {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return { error: 'Payload must be a single JSON object.' };
	}
	const obj = raw as Record<string, unknown>;

	if (!isNonEmptyString(obj.key)) return { error: 'Missing or invalid "key" (expected a string).' };
	const key = obj.key.trim().toLowerCase();
	if (!KEY_RE.test(key)) {
		return {
			error: `"key" must be lowercase letters/numbers/underscores/hyphens, starting with a letter or number (got "${key}").`
		};
	}
	if (!isNonEmptyString(obj.label))
		return { error: 'Missing or invalid "label" (expected a string).' };

	if (!Array.isArray(obj.subsectors) || obj.subsectors.length === 0) {
		return { error: 'Missing or empty "subsectors" array — need at least one.' };
	}

	const [majors, baskets] = await Promise.all([listAllMajorSectors(), listAllBaskets()]);
	const existingMajorKeys = new Set(majors.map((m) => m.key));
	const existingSubsectorKeys = new Set(baskets.map((s) => s.key));

	if (existingMajorKeys.has(key)) {
		return { error: `Sector key "${key}" is already in use — pick a different one.` };
	}

	const subsectors: UserSectorSubsectorInput[] = [];
	const seenSubsectorKeys = new Set<string>();
	for (const [i, rawSub] of obj.subsectors.entries()) {
		if (typeof rawSub !== 'object' || rawSub === null || Array.isArray(rawSub)) {
			return { error: `subsectors[${i}] must be an object.` };
		}
		const s = rawSub as Record<string, unknown>;
		if (!isNonEmptyString(s.key)) return { error: `subsectors[${i}]: missing or invalid "key".` };
		const subKey = s.key.trim().toLowerCase();
		if (!KEY_RE.test(subKey)) {
			return {
				error: `subsectors[${i}].key must be lowercase letters/numbers/underscores/hyphens (got "${subKey}").`
			};
		}
		if (existingSubsectorKeys.has(subKey) || seenSubsectorKeys.has(subKey)) {
			return { error: `Subsector key "${subKey}" is already in use — pick a different one.` };
		}
		if (!isNonEmptyString(s.label))
			return { error: `subsectors[${i}]: missing or invalid "label".` };
		if (!Array.isArray(s.symbols) || s.symbols.length === 0) {
			return { error: `subsectors[${i}]: "symbols" must be a non-empty array of strings.` };
		}
		const symbols: string[] = [];
		const seenSymbols = new Set<string>();
		for (const sym of s.symbols) {
			if (!isNonEmptyString(sym)) {
				return { error: `subsectors[${i}]: every entry in "symbols" must be a non-empty string.` };
			}
			const upper = normalizeSymbol(sym);
			if (!seenSymbols.has(upper)) {
				seenSymbols.add(upper);
				symbols.push(upper);
			}
		}
		seenSubsectorKeys.add(subKey);
		subsectors.push({ key: subKey, label: s.label.trim(), symbols });
	}

	return { input: { key, label: obj.label.trim(), subsectors } };
}

export async function createUserSector(input: UserSectorInput): Promise<void> {
	await ensureSeeded();
	await db.transaction(async (tx) => {
		await lockKeySpace(tx);
		// Validation ran before this transaction; re-check under the lock so two identical imports
		// at once give one clean 409 rather than a primary-key failure.
		const [taken] = await tx
			.select({ key: sectorMajors.key })
			.from(sectorMajors)
			.where(eq(sectorMajors.key, input.key));
		const takenBaskets = await tx
			.select({ key: sectorBaskets.key })
			.from(sectorBaskets)
			.where(
				inArray(
					sectorBaskets.key,
					input.subsectors.map((s) => s.key)
				)
			);
		if (taken || takenBaskets.length > 0) {
			throw new SectorEditError(
				409,
				`Sector key "${input.key}" (or one of its subsectors) is already in use.`
			);
		}
		const rows = await tx.select({ position: sectorMajors.position }).from(sectorMajors);
		const position = rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
		await tx
			.insert(sectorBaskets)
			.values(input.subsectors.map((s) => ({ key: s.key, label: s.label, symbols: s.symbols })));
		await tx.insert(sectorMajors).values({
			key: input.key,
			label: input.label,
			position,
			subsectorKeys: input.subsectors.map((s) => s.key)
		});
	});
}
