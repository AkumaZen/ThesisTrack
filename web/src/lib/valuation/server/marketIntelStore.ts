import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '$lib/server/db';
import { announcements, companyCache, companyGrowthSeriesCache, mcapUniverse } from '$lib/server/db/valuationSchema';
import {
	announcementKeywords,
	corporateActions,
	holdingAlertDeliveries,
	holdingAlertSettings,
	insiderTrades,
	priceAlertRules,
	sastDisclosures,
	watchlistSectionItems,
	watchlistSections
} from '$lib/server/db/marketIntelSchema';
import type { ParsedAnnouncement } from '../announcements';
import type { ParsedAction } from '../corporateActions';
import { INSIDER_PAGE_SIZE, txnTypesFor, type InsiderFilters, type ParsedInsiderTrade, type ParsedSast } from '../insiderTrades';
import { FEED_PAGE_SIZE, STOPWORD_LIST, likeContains, pickTrending, type FeedFilters, type WordCount } from '../announcementScans';
import { DEFAULT_HOLDING_SETTINGS, type HoldingAlertSettings, type NewPriceAlert } from '../alertRules';
import { classifyAnnouncement } from '../announcementTags';
import type { Flag } from '../watchlistSections';

const DAY_MS = 86_400_000;
/** Inserts go in slices so one statement never nears Postgres' parameter limit. */
const CHUNK = 400;

async function inChunks<T>(rows: T[], insert: (slice: T[]) => Promise<number>): Promise<number> {
	let n = 0;
	for (let i = 0; i < rows.length; i += CHUNK) n += await insert(rows.slice(i, i + CHUNK));
	return n;
}

/** Start of an IST calendar day (YYYY-MM-DD) as an instant. */
export const istStart = (day: string): Date => new Date(`${day}T00:00:00+05:30`);
const istNextStart = (day: string): Date => new Date(istStart(day).getTime() + DAY_MS);

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');
/** A ticker prefix or part of a company name. */
const companyMatch = (symbolCol: AnyPgColumn, nameCol: AnyPgColumn, term: string): SQL =>
	or(ilike(symbolCol, escapeLike(term.toUpperCase()) + '%'), ilike(nameCol, likeContains(term)))!;

// ---- market-wide announcement feed ----

/** Stores announcements not seen before; returns how many were new. */
export const saveFeedAnnouncements = (rows: ParsedAnnouncement[]): Promise<number> =>
	inChunks(rows, async (slice) => {
		const inserted = await db
			.insert(announcements)
			.values(
				slice.map((r) => ({
					dedupeKey: r.dedupeKey,
					nseSymbol: r.nseSymbol,
					companyName: r.companyName,
					subject: r.subject,
					details: r.details,
					announcedAt: r.announcedAt,
					pdfUrl: r.pdfUrl,
					tag: classifyAnnouncement(r.subject, r.details)
				}))
			)
			.onConflictDoNothing({ target: announcements.dedupeKey })
			.returning({ id: announcements.id });
		return inserted.length;
	});

/** Feed rows are not summarised or notified, so old ones of companies nobody tracks can go. */
export async function pruneFeed(now: Date, keepDays = 120): Promise<number> {
	const cutoff = new Date(now.getTime() - keepDays * DAY_MS);
	const gone = await db.execute(sql`
		delete from valuation.announcements a
		where a.announced_at < ${cutoff.toISOString()}::timestamptz
		  and a.summary is null
		  and not exists (select 1 from valuation.tracked_companies t where t.nse_symbol = a.nse_symbol)
		returning 1`);
	return gone.length;
}

const likeAny = (cols: SQL[], term: string): SQL => {
	const pattern = likeContains(term);
	return or(...cols.map((c) => sql`${c} ilike ${pattern}`))!;
};

function feedWhere(f: FeedFilters): SQL | undefined {
	const text = [sql`${announcements.subject}`, sql`${announcements.details}`];
	const parts: (SQL | undefined)[] = [];
	if (f.company) parts.push(companyMatch(announcements.nseSymbol, announcements.companyName, f.company));
	if (f.tag) parts.push(eq(announcements.tag, f.tag));
	if (f.from) parts.push(gte(announcements.announcedAt, istStart(f.from)));
	if (f.to) parts.push(lt(announcements.announcedAt, istNextStart(f.to)));
	if (f.scan) parts.push(or(...f.scan.terms.map((t) => likeAny(text, t))));
	if (f.keyword) parts.push(likeAny(text, f.keyword));
	return parts.length ? and(...parts) : undefined;
}

export interface FeedItem {
	id: number;
	nseSymbol: string;
	companyName: string;
	subject: string;
	details: string;
	summary: string | null;
	pdfUrl: string | null;
	announcedAt: string;
	tag: string | null;
}

export async function listFeed(f: FeedFilters): Promise<{ items: FeedItem[]; hasMore: boolean }> {
	const rows = await db
		.select({
			id: announcements.id,
			nseSymbol: announcements.nseSymbol,
			companyName: announcements.companyName,
			subject: announcements.subject,
			details: announcements.details,
			summary: announcements.summary,
			pdfUrl: announcements.pdfUrl,
			announcedAt: announcements.announcedAt,
			tag: announcements.tag
		})
		.from(announcements)
		.where(feedWhere(f))
		.orderBy(desc(announcements.announcedAt), desc(announcements.id))
		.limit(FEED_PAGE_SIZE + 1)
		.offset((f.page - 1) * FEED_PAGE_SIZE);
	return {
		items: rows.slice(0, FEED_PAGE_SIZE).map((r) => ({ ...r, announcedAt: r.announcedAt.toISOString() })),
		hasMore: rows.length > FEED_PAGE_SIZE
	};
}

export async function feedCoverage(): Promise<{ total: number; earliest: string | null; latest: string | null }> {
	const [row] = await db
		.select({
			total: sql<number>`count(*)::int`,
			earliest: sql<string | null>`min(${announcements.announcedAt})`,
			latest: sql<string | null>`max(${announcements.announcedAt})`
		})
		.from(announcements);
	const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
	return { total: row.total, earliest: iso(row.earliest), latest: iso(row.latest) };
}

/** Words of the last week's filings with the week before's counts alongside, most used first. */
export async function trendingWords(now: Date, limit = 20) {
	const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
	const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS).toISOString();
	const stopwords = sql.join(STOPWORD_LIST.map((w) => sql`${w}`), sql`, `);
	const rows = await db.execute(sql`
		select word,
		       (count(*) filter (where announced_at >= ${weekAgo}::timestamptz))::int as current,
		       (count(*) filter (where announced_at < ${weekAgo}::timestamptz))::int as previous
		from (
			select distinct id, announced_at, unnest(regexp_split_to_array(lower(subject || ' ' || details), '[^a-z-]+')) as word
			from valuation.announcements
			where announced_at >= ${twoWeeksAgo}::timestamptz
		) w
		where length(word) >= 4 and word ~ '^[a-z][a-z-]*$' and word not in (${stopwords})
		group by word
		having count(*) filter (where announced_at >= ${weekAgo}::timestamptz) >= 3
		order by current desc
		limit 400`);
	return pickTrending([...rows] as unknown as WordCount[], limit);
}

// ---- saved keywords ----

export const listKeywords = (userId: number) =>
	db
		.select({ id: announcementKeywords.id, keyword: announcementKeywords.keyword })
		.from(announcementKeywords)
		.where(eq(announcementKeywords.userId, userId))
		.orderBy(asc(announcementKeywords.createdAt));

export async function addKeyword(userId: number, keyword: string): Promise<boolean> {
	const inserted = await db.insert(announcementKeywords).values({ userId, keyword }).onConflictDoNothing().returning({ id: announcementKeywords.id });
	return inserted.length > 0;
}

export async function countKeywords(userId: number): Promise<number> {
	const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(announcementKeywords).where(eq(announcementKeywords.userId, userId));
	return row.n;
}

export async function removeKeyword(userId: number, id: number) {
	await db.delete(announcementKeywords).where(and(eq(announcementKeywords.userId, userId), eq(announcementKeywords.id, id)));
}

// ---- insider trading and SAST ----

export const saveInsiderTrades = (rows: ParsedInsiderTrade[]): Promise<number> =>
	inChunks(rows, async (slice) => {
		const inserted = await db.insert(insiderTrades).values(slice).onConflictDoNothing({ target: insiderTrades.dedupeKey }).returning({ id: insiderTrades.id });
		return inserted.length;
	});

export const saveSastDisclosures = (rows: ParsedSast[]): Promise<number> =>
	inChunks(rows, async (slice) => {
		const inserted = await db.insert(sastDisclosures).values(slice).onConflictDoNothing({ target: sastDisclosures.dedupeKey }).returning({ id: sastDisclosures.id });
		return inserted.length;
	});

function insiderWhere(f: InsiderFilters): SQL | undefined {
	const parts: (SQL | undefined)[] = [];
	if (f.company) parts.push(companyMatch(insiderTrades.nseSymbol, insiderTrades.companyName, f.company));
	if (f.person) parts.push(ilike(insiderTrades.personName, likeContains(f.person)));
	if (f.category) parts.push(eq(insiderTrades.personCategory, f.category));
	if (f.side) parts.push(inArray(insiderTrades.txnType, txnTypesFor(f.side)));
	if (f.minValue) parts.push(gte(insiderTrades.value, f.minValue));
	if (f.from) parts.push(gte(insiderTrades.broadcastAt, istStart(f.from)));
	if (f.to) parts.push(lt(insiderTrades.broadcastAt, istNextStart(f.to)));
	return parts.length ? and(...parts) : undefined;
}

export type InsiderRow = Omit<typeof insiderTrades.$inferSelect, 'broadcastAt' | 'createdAt' | 'dedupeKey'> & { broadcastAt: string };

export async function listInsiderTrades(f: InsiderFilters): Promise<{ items: InsiderRow[]; hasMore: boolean }> {
	const rows = await db
		.select()
		.from(insiderTrades)
		.where(insiderWhere(f))
		.orderBy(desc(insiderTrades.broadcastAt), desc(insiderTrades.id))
		.limit(INSIDER_PAGE_SIZE + 1)
		.offset((f.page - 1) * INSIDER_PAGE_SIZE);
	return {
		items: rows.slice(0, INSIDER_PAGE_SIZE).map(({ dedupeKey: _k, createdAt: _c, broadcastAt, ...r }) => ({ ...r, broadcastAt: broadcastAt.toISOString() })),
		hasMore: rows.length > INSIDER_PAGE_SIZE
	};
}

export type SastRow = Omit<typeof sastDisclosures.$inferSelect, 'disclosedAt' | 'createdAt' | 'dedupeKey'> & { disclosedAt: string };

export async function listSast(f: InsiderFilters): Promise<{ items: SastRow[]; hasMore: boolean }> {
	const parts: (SQL | undefined)[] = [];
	if (f.company) parts.push(companyMatch(sastDisclosures.nseSymbol, sastDisclosures.companyName, f.company));
	if (f.person) parts.push(ilike(sastDisclosures.acquirerName, likeContains(f.person)));
	if (f.category === 'Promoters') parts.push(eq(sastDisclosures.isPromoter, true));
	if (f.side === 'buy') parts.push(ilike(sastDisclosures.action, 'acq%'));
	if (f.side === 'sell') parts.push(or(ilike(sastDisclosures.action, 'dis%'), ilike(sastDisclosures.action, 'sale%'), ilike(sastDisclosures.action, 'sell%')));
	if (f.from) parts.push(gte(sastDisclosures.disclosedAt, istStart(f.from)));
	if (f.to) parts.push(lt(sastDisclosures.disclosedAt, istNextStart(f.to)));
	const rows = await db
		.select()
		.from(sastDisclosures)
		.where(parts.length ? and(...parts) : undefined)
		.orderBy(desc(sastDisclosures.disclosedAt), desc(sastDisclosures.id))
		.limit(INSIDER_PAGE_SIZE + 1)
		.offset((f.page - 1) * INSIDER_PAGE_SIZE);
	return {
		items: rows.slice(0, INSIDER_PAGE_SIZE).map(({ dedupeKey: _k, createdAt: _c, disclosedAt, ...r }) => ({ ...r, disclosedAt: disclosedAt.toISOString() })),
		hasMore: rows.length > INSIDER_PAGE_SIZE
	};
}

/** Insider trades and SAST filings of one company, for its holding-change history. */
export async function companyHoldingFilings(symbol: string, limit = 100) {
	const [trades, sast] = await Promise.all([
		db.select().from(insiderTrades).where(eq(insiderTrades.nseSymbol, symbol)).orderBy(desc(insiderTrades.broadcastAt)).limit(limit),
		db.select().from(sastDisclosures).where(eq(sastDisclosures.nseSymbol, symbol)).orderBy(desc(sastDisclosures.disclosedAt)).limit(limit)
	]);
	return { trades, sast };
}

// ---- corporate actions ----

export const saveCorporateActions = (rows: ParsedAction[]): Promise<number> =>
	inChunks(rows, async (slice) => {
		const inserted = await db.insert(corporateActions).values(slice).onConflictDoNothing({ target: corporateActions.dedupeKey }).returning({ id: corporateActions.id });
		return inserted.length;
	});

export type ActionRow = Omit<typeof corporateActions.$inferSelect, 'createdAt' | 'dedupeKey'>;

const actionColumns = {
	id: corporateActions.id,
	nseSymbol: corporateActions.nseSymbol,
	companyName: corporateActions.companyName,
	isin: corporateActions.isin,
	kind: corporateActions.kind,
	subject: corporateActions.subject,
	amount: corporateActions.amount,
	ratio: corporateActions.ratio,
	faceValue: corporateActions.faceValue,
	exDate: corporateActions.exDate,
	recordDate: corporateActions.recordDate
};

export const listCompanyActions = (symbol: string, limit = 60): Promise<ActionRow[]> =>
	db.select(actionColumns).from(corporateActions).where(eq(corporateActions.nseSymbol, symbol)).orderBy(desc(corporateActions.exDate)).limit(limit);

/** Actions going ex on or after `today`, soonest first. `kind` narrows to one type. */
export async function listUpcomingActions(today: string, kind: string | null, page: number, pageSize: number): Promise<{ items: ActionRow[]; hasMore: boolean }> {
	const rows = await db
		.select(actionColumns)
		.from(corporateActions)
		.where(and(gte(corporateActions.exDate, today), kind ? eq(corporateActions.kind, kind) : undefined))
		.orderBy(asc(corporateActions.exDate), asc(corporateActions.nseSymbol))
		.limit(pageSize + 1)
		.offset((page - 1) * pageSize);
	return { items: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

/** Latest stored close for each symbol (from the Angel One candles the refresh jobs keep). */
export async function lastStoredCloses(symbols: string[]): Promise<Map<string, number>> {
	if (!symbols.length) return new Map();
	const rows = await db
		.select({ symbol: companyGrowthSeriesCache.symbol, close: sql<string | null>`${companyGrowthSeriesCache.candles}->-1->>'close'` })
		.from(companyGrowthSeriesCache)
		.where(inArray(companyGrowthSeriesCache.symbol, symbols));
	const out = new Map<string, number>();
	for (const r of rows) {
		const n = Number(r.close);
		if (Number.isFinite(n) && n > 0) out.set(r.symbol, n);
	}
	return out;
}

/** Annual EPS from the cached Screener page, if the company has one. */
export async function annualEps(symbol: string): Promise<{ label: string; eps: number | null }[]> {
	const [row] = await db.select({ data: companyCache.data }).from(companyCache).where(eq(companyCache.symbol, symbol));
	const years = (row?.data as { years?: { label?: unknown; eps?: unknown }[] } | undefined)?.years;
	if (!Array.isArray(years)) return [];
	return years.map((y) => ({ label: String(y.label ?? ''), eps: typeof y.eps === 'number' ? y.eps : null }));
}

// ---- price alert rules ----

export type PriceRuleRow = typeof priceAlertRules.$inferSelect;

export const listPriceRules = (userId: number) =>
	db.select().from(priceAlertRules).where(eq(priceAlertRules.userId, userId)).orderBy(desc(priceAlertRules.active), desc(priceAlertRules.createdAt));

export async function countActivePriceRules(userId: number): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(priceAlertRules)
		.where(and(eq(priceAlertRules.userId, userId), eq(priceAlertRules.active, true)));
	return row.n;
}

export async function addPriceRule(userId: number, companyName: string, rule: NewPriceAlert): Promise<number> {
	const [row] = await db
		.insert(priceAlertRules)
		.values({ userId, nseSymbol: rule.nseSymbol, companyName, kind: rule.kind, threshold: rule.threshold, basePrice: rule.basePrice })
		.returning({ id: priceAlertRules.id });
	return row.id;
}

export async function removePriceRule(userId: number, id: number) {
	await db.delete(priceAlertRules).where(and(eq(priceAlertRules.userId, userId), eq(priceAlertRules.id, id)));
}

/** Turns a fired rule back on; percentage moves restart from the price given. */
export async function rearmPriceRule(userId: number, id: number, price: number | null) {
	await db
		.update(priceAlertRules)
		.set({ active: true, triggeredAt: null, triggeredPrice: null, basePrice: price == null ? sql`${priceAlertRules.basePrice}` : price })
		.where(and(eq(priceAlertRules.userId, userId), eq(priceAlertRules.id, id)));
}

export const listActivePriceRules = () => db.select().from(priceAlertRules).where(eq(priceAlertRules.active, true));

/** Marks a rule fired; false when another run already did (so the person is told once). */
export async function claimPriceRule(id: number, price: number, now: Date): Promise<boolean> {
	const claimed = await db
		.update(priceAlertRules)
		.set({ active: false, triggeredAt: now, triggeredPrice: price })
		.where(and(eq(priceAlertRules.id, id), eq(priceAlertRules.active, true)))
		.returning({ id: priceAlertRules.id });
	return claimed.length > 0;
}

// ---- shareholding change alerts ----

export async function getHoldingSettings(userId: number): Promise<HoldingAlertSettings> {
	const [row] = await db.select().from(holdingAlertSettings).where(eq(holdingAlertSettings.userId, userId));
	return row ? { promoterPp: row.promoterPp, fiiPp: row.fiiPp, diiPp: row.diiPp } : DEFAULT_HOLDING_SETTINGS;
}

export async function saveHoldingSettings(userId: number, s: HoldingAlertSettings) {
	const values = { ...s, updatedAt: new Date() };
	await db.insert(holdingAlertSettings).values({ userId, ...values }).onConflictDoUpdate({ target: holdingAlertSettings.userId, set: values });
}

/** Everyone with at least one threshold set. */
export async function listHoldingSettings() {
	const rows = await db.select().from(holdingAlertSettings);
	return rows.filter((r) => r.promoterPp != null || r.fiiPp != null || r.diiPp != null);
}

export async function claimHoldingDelivery(userId: number, nseSymbol: string, period: string): Promise<boolean> {
	const claimed = await db.insert(holdingAlertDeliveries).values({ userId, nseSymbol, period }).onConflictDoNothing().returning({ userId: holdingAlertDeliveries.userId });
	return claimed.length > 0;
}

// ---- watchlist sections ----

export interface SectionItem {
	nseSymbol: string;
	companyName: string;
	flagColor: string | null;
	flagLabel: string | null;
}
export interface SectionWithItems {
	id: number;
	name: string;
	items: SectionItem[];
}

export async function listSections(userId: number): Promise<SectionWithItems[]> {
	const sections = await db.select().from(watchlistSections).where(eq(watchlistSections.userId, userId)).orderBy(asc(watchlistSections.position), asc(watchlistSections.id));
	if (!sections.length) return [];
	const items = await db
		.select()
		.from(watchlistSectionItems)
		.where(inArray(watchlistSectionItems.sectionId, sections.map((s) => s.id)))
		.orderBy(asc(watchlistSectionItems.addedAt));
	return sections.map((s) => ({
		id: s.id,
		name: s.name,
		items: items.filter((i) => i.sectionId === s.id).map((i) => ({ nseSymbol: i.nseSymbol, companyName: i.companyName, flagColor: i.flagColor, flagLabel: i.flagLabel }))
	}));
}

export const countSections = async (userId: number): Promise<number> => {
	const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(watchlistSections).where(eq(watchlistSections.userId, userId));
	return row.n;
};

/** Returns the new id, or null when the person already has a section by that name. */
export async function createSection(userId: number, name: string): Promise<number | null> {
	const [last] = await db.select({ p: sql<number>`coalesce(max(${watchlistSections.position}), 0)::int` }).from(watchlistSections).where(eq(watchlistSections.userId, userId));
	const [row] = await db.insert(watchlistSections).values({ userId, name, position: last.p + 1 }).onConflictDoNothing().returning({ id: watchlistSections.id });
	return row?.id ?? null;
}

export async function ownsSection(userId: number, sectionId: number): Promise<boolean> {
	const [row] = await db.select({ id: watchlistSections.id }).from(watchlistSections).where(and(eq(watchlistSections.id, sectionId), eq(watchlistSections.userId, userId)));
	return !!row;
}

export async function renameSection(userId: number, sectionId: number, name: string): Promise<boolean> {
	try {
		const done = await db.update(watchlistSections).set({ name }).where(and(eq(watchlistSections.id, sectionId), eq(watchlistSections.userId, userId))).returning({ id: watchlistSections.id });
		return done.length > 0;
	} catch {
		return false; // the name is taken
	}
}

export async function deleteSection(userId: number, sectionId: number) {
	await db.delete(watchlistSections).where(and(eq(watchlistSections.id, sectionId), eq(watchlistSections.userId, userId)));
}

export async function countSectionItems(sectionId: number): Promise<number> {
	const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(watchlistSectionItems).where(eq(watchlistSectionItems.sectionId, sectionId));
	return row.n;
}

export async function addSectionItem(sectionId: number, nseSymbol: string, companyName: string) {
	await db.insert(watchlistSectionItems).values({ sectionId, nseSymbol, companyName }).onConflictDoNothing();
}

export async function removeSectionItem(sectionId: number, nseSymbol: string) {
	await db.delete(watchlistSectionItems).where(and(eq(watchlistSectionItems.sectionId, sectionId), eq(watchlistSectionItems.nseSymbol, nseSymbol)));
}

export async function setSectionFlag(sectionId: number, nseSymbol: string, flag: Flag) {
	await db
		.update(watchlistSectionItems)
		.set({ flagColor: flag.color, flagLabel: flag.label })
		.where(and(eq(watchlistSectionItems.sectionId, sectionId), eq(watchlistSectionItems.nseSymbol, nseSymbol)));
}

/** A company's flags across all of a person's sections (to show a flag next to it elsewhere). */
export async function flagsFor(userId: number, symbols: string[]): Promise<Map<string, { color: string | null; label: string | null; section: string }>> {
	if (!symbols.length) return new Map();
	const rows = await db
		.select({ symbol: watchlistSectionItems.nseSymbol, color: watchlistSectionItems.flagColor, label: watchlistSectionItems.flagLabel, section: watchlistSections.name })
		.from(watchlistSectionItems)
		.innerJoin(watchlistSections, eq(watchlistSections.id, watchlistSectionItems.sectionId))
		.where(
			and(
				eq(watchlistSections.userId, userId),
				inArray(watchlistSectionItems.nseSymbol, symbols),
				or(sql`${watchlistSectionItems.flagColor} is not null`, sql`${watchlistSectionItems.flagLabel} is not null`)
			)
		);
	return new Map(rows.map((r) => [r.symbol, { color: r.color, label: r.label, section: r.section }]));
}

// ---- company names ----

/** The company name as we already hold it (universe, filings), else the name the caller gave. */
export async function companyNameFor(symbol: string, given: unknown): Promise<string | null> {
	const [u] = await db.select({ name: mcapUniverse.companyName }).from(mcapUniverse).where(eq(mcapUniverse.nseSymbol, symbol)).limit(1);
	if (u) return u.name;
	const [a] = await db.select({ name: announcements.companyName }).from(announcements).where(eq(announcements.nseSymbol, symbol)).limit(1);
	if (a) return a.name;
	const name = typeof given === 'string' ? given.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
	return name || null;
}
