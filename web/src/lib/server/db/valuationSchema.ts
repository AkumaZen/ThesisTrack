import {
	bigint,
	boolean,
	date,
	numeric,
	doublePrecision,
	integer,
	jsonb,
	pgSchema,
	primaryKey,
	uniqueIndex,
	timestamp,
	serial,
	text
} from 'drizzle-orm/pg-core';
import { users } from './schema';

// Everything the valuation tools (watchlist, company valuation, sector rotation,
// breakout scanner, alerts) store lives in its own Postgres schema so it can
// never collide with the thesis tables. People are the shared `public.users`
// (see schema.ts) - the valuation tables reference them by id, and record
// authors by `users.display_name`. Owned by drizzle/0010_merge_valuation.sql.
export const valuation = pgSchema('valuation');
const pgTable = valuation.table;

export const companyCache = pgTable('company_cache', {
	symbol: text('symbol').primaryKey(),
	basis: text('basis').notNull(), // 'consolidated' | 'standalone' | 'standalone_only'
	data: jsonb('data').notNull(),
	fetchedAt: bigint('fetched_at', { mode: 'number' }).notNull()
});

export const sparklineCache = pgTable('sparkline_cache', {
	symbol: text('symbol').primaryKey(),
	closes: jsonb('closes').notNull().$type<number[]>(),
	fetchedAt: bigint('fetched_at', { mode: 'number' }).notNull()
});

// Longer-range (~400 calendar day) full OHLCV candles per symbol — shared by both the sector
// rotation overview (needs date-aligned closes to build each basket's equal-weighted index)
// and the per-sector constituent drill-down page (needs a full year for its 1Y timeframe).
// Separate from sparklineCache (90 days, tuned for the watchlist) so this page's longer window
// doesn't force a longer TTL/range onto the watchlist's sparkline. Sector-level results (% by
// window, signal) are cheap pure-math over these cached candles and are recomputed on demand
// rather than cached themselves — one less cache layer to keep in sync.
export const companyGrowthSeriesCache = pgTable('company_growth_series_cache', {
	symbol: text('symbol').primaryKey(),
	candles: jsonb('candles').notNull(),
	fetchedAt: bigint('fetched_at', { mode: 'number' }).notNull()
});

// Same idea as companyGrowthSeriesCache but for the Nifty 50 benchmark index itself (fetched by
// index token, not equity symbol, via a different Angel One call) — every sector's relative
// strength is computed against this one series, so it's cached once rather than once per sector.
export const benchmarkSeriesCache = pgTable('benchmark_series_cache', {
	id: text('id').primaryKey(),
	candles: jsonb('candles').notNull(),
	fetchedAt: bigint('fetched_at', { mode: 'number' }).notNull()
});

// Same shape as benchmarkSeriesCache, for the Nifty 500 index — the Stage 2 Breakout Scanner's
// Mansfield RS benchmark (separate from benchmarkSeriesCache/Nifty 50, which sector rotation
// uses for its own relative-strength read).
export const nifty500SeriesCache = pgTable('nifty500_series_cache', {
	id: text('id').primaryKey(),
	candles: jsonb('candles').notNull(),
	fetchedAt: bigint('fetched_at', { mode: 'number' }).notNull()
});

// A user's saved/imported per-company valuation model. Previously lived entirely in browser
// localStorage (keyed `valdash:<SYMBOL>`) — that meant clearing site data, switching browsers/
// profiles, or opening a different browser origin silently wiped every saved valuation with no
// way back. Moved here so it's durable and shared across whatever browser hits this dev server.
export const savedValuations = pgTable('saved_valuations', {
	symbol: text('symbol').primaryKey(),
	name: text('name').notNull(),
	lastUpdated: bigint('last_updated', { mode: 'number' }).notNull(),
	assumptions: jsonb('assumptions').notNull(),
	shares: doublePrecision('shares').notNull(),
	activeMethod: text('active_method'),
	activeScenario: text('active_scenario'),
	// Optimistic concurrency: every save bumps `version`; a client that supplies the version it
	// loaded is refused (409) when someone else saved in between. `updatedBy` is the display name
	// of the signed-in user who made the latest save.
	version: integer('version').notNull().default(1),
	updatedBy: text('updated_by')
});

// One row per scanned symbol, two independently-timestamped payloads: `structural` (50/200-DMA,
// base/resistance, breakout history, volume tiers, Mansfield RS — computed from closed candles
// only, cheap to recompute, only actually recomputed when the underlying candle series' latest
// date changes) and `live` (today's LTP + volume-so-far overlay, refreshed on the ~10-minute
// cadence via stageScanScheduler.ts). `stage` is denormalized out of `structural` so the client
// can sort/filter by it without unpacking JSON per row.
export const stageScanCache = pgTable('stage_scan_cache', {
	symbol: text('symbol').primaryKey(),
	structural: jsonb('structural').notNull(),
	structuralSourceDate: text('structural_source_date').notNull(),
	structuralComputedAt: bigint('structural_computed_at', { mode: 'number' }).notNull(),
	live: jsonb('live'),
	liveFetchedAt: bigint('live_fetched_at', { mode: 'number' }),
	stage: text('stage').notNull(),
	updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
});

// Editable sector taxonomy. Seeded once from the hand-curated CUSTOM_SECTORS/MAJOR_SECTORS in
// customSectors.ts (plus any legacy user_sectors rows), after which these three tables are the
// single source of truth — the in-app Sector Manager edits them directly. A basket (subsector)
// may belong to more than one major sector, so membership lives as an ordered key array on the
// major rather than a single foreign key on the basket.
export const sectorMajors = pgTable('sector_majors', {
	key: text('key').primaryKey(),
	label: text('label').notNull(),
	position: bigint('position', { mode: 'number' }).notNull(),
	subsectorKeys: jsonb('subsector_keys').notNull().$type<string[]>()
});

export const sectorBaskets = pgTable('sector_baskets', {
	key: text('key').primaryKey(),
	label: text('label').notNull(),
	symbols: jsonb('symbols').notNull().$type<string[]>()
});

// Verified company names for symbols added through the Sector Manager (the static SYMBOL_NAMES
// map only covers the originally hand-verified symbols). Written at verification time, so a
// name is always the real Screener.in name, never a guess.
export const symbolNameCache = pgTable('symbol_name_cache', {
	symbol: text('symbol').primaryKey(),
	name: text('name').notNull()
});

// Legacy: a user-defined major sector, imported via the Sector Rotation page's "Import Sector" JSON
// upload — same idea as CUSTOM_SECTORS/MAJOR_SECTORS in customSectors.ts, but added at runtime
// instead of hand-curated at build time. `subsectors` holds the whole Subsector -> Company
// layer inline as one jsonb blob (an array of {key, label, symbols}) rather than normalizing
// into a separate table: a user sector is always read/written as one unit (one import, one
// delete), so there's no case where a caller needs to query a subsector independently of its
// parent — splitting it out would only add a join for no real benefit.
export const userSectors = pgTable('user_sectors', {
	key: text('key').primaryKey(),
	label: text('label').notNull(),
	subsectors: jsonb('subsectors').notNull(),
	createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

// In-app alert feed. Alerts are raised once for the whole team; whether each person has read one,
// which types they want and what they muted are per user (alert_reads, alert_user_prefs below).
// `type` is one of price_fair_value | sector_rotation | near_breakout (see lib/alerts.ts);
// `subjectKey` is what muting matches on (symbol:TCS, sector:<key>, basket:<key>).
export const alerts = pgTable('alerts', {
	id: serial('id').primaryKey(),
	type: text('type').notNull(),
	subjectKey: text('subject_key').notNull(),
	subjectLabel: text('subject_label').notNull(),
	message: text('message').notNull(),
	href: text('href'),
	createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

// One row = that user has read that alert. Deleting either side removes the row.
export const alertReads = pgTable(
	'alert_reads',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		alertId: integer('alert_id')
			.notNull()
			.references(() => alerts.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.userId, t.alertId] })]
);

// Each user's own alert choices: `enabled` -> { price_fair_value: bool, ... } (a missing type
// means on) and `muted` -> string[] of subject keys. Hidden alerts are simply not shown to that
// user, so switching a type back on or unmuting reveals what was raised meanwhile.
export const alertUserPrefs = pgTable('alert_user_prefs', {
	userId: integer('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	enabled: jsonb('enabled').notNull().$type<Record<string, boolean>>(),
	muted: jsonb('muted').notNull().$type<string[]>()
});

// Strength & Volume alert rules, shared by the team. `config` is the same StrengthConfig the filter
// panel uses (lib/valuation/strength.ts) so a rule evaluates exactly what the filter showed.
// level + parentKey say what is watched: all sectors, the subsectors of one sector, the companies
// of one subsector, or one company (parentKey = symbol). Per-subject state lives in alert_state.
export const strengthRules = pgTable('strength_rules', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	level: text('level').notNull().$type<'sectors' | 'subsectors' | 'companies' | 'company'>(),
	parentKey: text('parent_key'),
	config: jsonb('config').notNull(),
	repeat: jsonb('repeat').notNull(),
	enabled: boolean('enabled').notNull().default(true),
	createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
	createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

// Each person's last-used Strength & Volume filter per view level, restored when they come back.
export const strengthFilterPrefs = pgTable(
	'strength_filter_prefs',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		level: text('level').notNull().$type<'sectors' | 'subsectors' | 'companies' | 'company'>(),
		/** The place within the level: the sector, subsector or company key ('' for every sector). */
		scope: text('scope').notNull().default(''),
		config: jsonb('config').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.level, t.scope] })]
);

// Tiny key/value flags for one-off facts about the database itself (e.g. "sector_seeded").
export const appMeta = pgTable('app_meta', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

// The last observed state per watched thing (`fv:TCS` -> below | at_or_above, `sector:major:<key>`
// -> Rotating In, `stage:TCS` -> a stage name). Comparing against this is what turns a reading
// into a crossing/flip, and what stops the same condition alerting on every check.
export const alertState = pgTable('alert_state', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
});

// Small key/value settings: `enabled` -> { price_fair_value: bool, ... } and `muted` -> string[].
export const alertSettings = pgTable('alert_settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull()
});

// History of each company's saved valuation (migrations/0002). An autosave by the same person
// within a short window updates their latest row, so one editing session is one version.
// 'delete' rows keep the removed content, which is what makes deleting recoverable.
export const valuationVersions = pgTable('valuation_versions', {
	id: serial('id').primaryKey(),
	symbol: text('symbol').notNull(),
	version: integer('version').notNull(),
	action: text('action').notNull().$type<'save' | 'delete' | 'restore'>(),
	snapshot: jsonb('snapshot').notNull(),
	savedBy: text('saved_by').notNull(),
	startedAt: bigint('started_at', { mode: 'number' }).notNull(),
	savedAt: bigint('saved_at', { mode: 'number' }).notNull()
});

// The team activity feed: one line per thing a teammate did. `refId` points at the row the entry
// describes (e.g. a valuation_versions id) so a continuing edit session updates its own entry.
export const activityLog = pgTable('activity_log', {
	id: serial('id').primaryKey(),
	at: bigint('at', { mode: 'number' }).notNull(),
	actor: text('actor').notNull(),
	kind: text('kind').notNull(),
	symbol: text('symbol'),
	summary: text('summary').notNull(),
	refId: integer('ref_id')
});

// Theses, research notes and valuation discussion per company (migrations/0003). The newest
// non-deleted 'thesis' is the current thesis; older ones are its history.
export const companyNotes = pgTable('company_notes', {
	id: serial('id').primaryKey(),
	symbol: text('symbol').notNull(),
	kind: text('kind').notNull().$type<'thesis' | 'note' | 'comment'>(),
	body: text('body').notNull(),
	author: text('author').notNull(),
	createdAt: bigint('created_at', { mode: 'number' }).notNull(),
	editedAt: bigint('edited_at', { mode: 'number' }),
	deletedAt: bigint('deleted_at', { mode: 'number' })
});

// Review status of a company's valuation; `atVersion` is the valuation version it refers to.
export const valuationStatus = pgTable('valuation_status', {
	symbol: text('symbol').primaryKey(),
	status: text('status').notNull().$type<'draft' | 'review_needed' | 'approved'>(),
	atVersion: integer('at_version'),
	setBy: text('set_by').notNull(),
	setAt: bigint('set_at', { mode: 'number' }).notNull()
});

// Which analyst covers a company.
export const coverage = pgTable('coverage', {
	symbol: text('symbol').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	assignedBy: text('assigned_by').notNull(),
	assignedAt: bigint('assigned_at', { mode: 'number' }).notNull()
});

// Named watchlists (migrations/0004): team-curated subsets of the main watchlist.
export const watchlists = pgTable('watchlists', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	createdBy: text('created_by').notNull(),
	createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const watchlistMembers = pgTable(
	'watchlist_members',
	{
		watchlistId: integer('watchlist_id')
			.notNull()
			.references(() => watchlists.id, { onDelete: 'cascade' }),
		symbol: text('symbol').notNull(),
		addedBy: text('added_by').notNull(),
		addedAt: bigint('added_at', { mode: 'number' }).notNull()
	},
	(t) => [primaryKey({ columns: [t.watchlistId, t.symbol] })]
);

// Per-user preferences as one validated JSON document (see lib/prefs.ts for the shape).
export const userPrefs = pgTable('user_prefs', {
	userId: integer('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	prefs: jsonb('prefs').notNull(),
	updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
});

// Named valuation templates shared by the team (see migrations/0005_valuation_templates.sql).
export const valuationTemplates = pgTable('valuation_templates', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	assumptions: jsonb('assumptions').notNull(),
	activeMethod: text('active_method').notNull(),
	createdBy: text('created_by').notNull(),
	createdAt: bigint('created_at', { mode: 'number' }).notNull(),
	updatedBy: text('updated_by').notNull(),
	updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
});

// Which template a new valuation starts from. scope: 'user:<id>' or 'basket:<key>'.
export const valuationTemplateDefaults = pgTable('valuation_template_defaults', {
	scope: text('scope').primaryKey(),
	templateId: integer('template_id')
		.notNull()
		.references(() => valuationTemplates.id, { onDelete: 'cascade' }),
	setBy: text('set_by').notNull(),
	setAt: bigint('set_at', { mode: 'number' }).notNull()
});

// Tracker membership is explicit. Research and review drafts are separate from accepted history.
export const masterTrackerCompanies = pgTable('master_tracker_companies', {
	symbol: text('symbol').primaryKey(), state: jsonb('state').notNull(), version: integer('version').notNull()
});
export const masterTrackerResearch = pgTable('master_tracker_research', {
	key: text('key').primaryKey(), symbol: text('symbol').notNull().references(() => masterTrackerCompanies.symbol, { onDelete: 'cascade' }), data: jsonb('data').notNull()
});
export const masterTrackerPreviews = pgTable('master_tracker_previews', {
	id: text('id').primaryKey(), symbol: text('symbol').notNull().references(() => masterTrackerCompanies.symbol, { onDelete: 'cascade' }), userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	data: jsonb('data').notNull()
});

// The breakout scanner's wider universe (migration 0020): AMFI companies with a six-month average
// market cap of Rs 500 Cr to Rs 20,000 Cr. Loaded by scripts/import-mcap-universe.mjs; `symbol` is
// the app ticker (null when Angel One has no price source). Rows missing from a newer file stay
// with active=false.
export const mcapUniverse = pgTable('mcap_universe', {
	isin: text('isin').primaryKey(),
	companyName: text('company_name').notNull(),
	nseSymbol: text('nse_symbol'),
	bseCode: text('bse_code'),
	marketCapCr: numeric('market_cap_cr', { precision: 14, scale: 2 }).notNull(),
	mcapAsOf: date('mcap_as_of', { mode: 'string' }).notNull(),
	listedOn: text('listed_on'),
	angelNseToken: text('angel_nse_token'),
	angelNseSymbol: text('angel_nse_symbol'),
	angelBseToken: text('angel_bse_token'),
	angelBseSymbol: text('angel_bse_symbol'),
	bseScripCode: text('bse_scrip_code'),
	priceExchange: text('price_exchange'),
	priceSourceStatus: text('price_source_status').notNull(),
	matchMethod: text('match_method'),
	symbol: text('symbol'),
	active: boolean('active').notNull().default(true),
	importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow()
});

// Announcement alerts (drizzle/0021_announcement_alerts.sql).
export const trackedCompanies = pgTable(
	'tracked_companies',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		nseSymbol: text('nse_symbol').notNull(),
		companyName: text('company_name').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('tracked_companies_user_symbol_uq').on(t.userId, t.nseSymbol)]
);

export const announcements = pgTable('announcements', {
	id: serial('id').primaryKey(),
	dedupeKey: text('dedupe_key').notNull().unique(),
	nseSymbol: text('nse_symbol').notNull(),
	companyName: text('company_name').notNull(),
	subject: text('subject').notNull(),
	details: text('details').notNull().default(''),
	announcedAt: timestamp('announced_at', { withTimezone: true }).notNull(),
	pdfUrl: text('pdf_url'),
	summary: text('summary'),
	summarisedAt: timestamp('summarised_at', { withTimezone: true }),
	summaryAttempts: integer('summary_attempts').notNull().default(0),
	tag: text('tag'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const announcementDeliveries = pgTable(
	'announcement_deliveries',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		announcementId: integer('announcement_id')
			.notNull()
			.references(() => announcements.id, { onDelete: 'cascade' }),
		sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.announcementId] })]
);

export const pushSubscriptions = pgTable('push_subscriptions', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	endpoint: text('endpoint').notNull().unique(),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
	lastFailureAt: timestamp('last_failure_at', { withTimezone: true })
});

// Results calendar, tags, notification settings (drizzle/0022_results_calendar_and_tags.sql).
export const symbolRefresh = pgTable(
	'symbol_refresh',
	{
		kind: text('kind').notNull(),
		symbol: text('symbol').notNull(),
		refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
		ok: boolean('ok').notNull().default(true)
	},
	(t) => [primaryKey({ columns: [t.kind, t.symbol] })]
);

export const boardMeetings = pgTable('board_meetings', {
	id: serial('id').primaryKey(),
	dedupeKey: text('dedupe_key').notNull().unique(),
	nseSymbol: text('nse_symbol').notNull(),
	companyName: text('company_name').notNull(),
	meetingDate: date('meeting_date', { mode: 'string' }).notNull(),
	purpose: text('purpose').notNull(),
	isResults: boolean('is_results').notNull().default(false),
	source: text('source').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const userNotificationSettings = pgTable('user_notification_settings', {
	userId: integer('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	onlyImportant: boolean('only_important').notNull().default(false),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// Deals and shareholding (drizzle/0023_deals_shareholding_telegram.sql).
export const marketDeals = pgTable('market_deals', {
	id: serial('id').primaryKey(),
	dedupeKey: text('dedupe_key').notNull().unique(),
	kind: text('kind').notNull(),
	nseSymbol: text('nse_symbol').notNull(),
	companyName: text('company_name').notNull(),
	dealDate: date('deal_date', { mode: 'string' }).notNull(),
	clientName: text('client_name').notNull(),
	side: text('side').notNull(),
	quantity: bigint('quantity', { mode: 'number' }).notNull(),
	price: numeric('price', { mode: 'number' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const dealDeliveries = pgTable(
	'deal_deliveries',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		dealId: integer('deal_id')
			.notNull()
			.references(() => marketDeals.id, { onDelete: 'cascade' }),
		sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.dealId] })]
);

export const shareholdingSnapshots = pgTable('shareholding_snapshots', {
	nseSymbol: text('nse_symbol').primaryKey(),
	period: text('period').notNull(),
	promoters: numeric('promoters', { mode: 'number' }),
	fiis: numeric('fiis', { mode: 'number' }),
	diis: numeric('diis', { mode: 'number' }),
	public: numeric('public', { mode: 'number' }),
	pledgedPct: numeric('pledged_pct', { mode: 'number' }),
	prevPeriod: text('prev_period'),
	prevPromoters: numeric('prev_promoters', { mode: 'number' }),
	prevFiis: numeric('prev_fiis', { mode: 'number' }),
	prevDiis: numeric('prev_diis', { mode: 'number' }),
	prevPublic: numeric('prev_public', { mode: 'number' }),
	fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow()
});
