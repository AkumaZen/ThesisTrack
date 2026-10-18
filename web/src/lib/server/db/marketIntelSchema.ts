import {
	bigint,
	boolean,
	date,
	integer,
	numeric,
	primaryKey,
	serial,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './schema';
import { valuation } from './valuationSchema';

// Market-wide intel and personal alert rules (drizzle/0024 to 0028). Kept in its own file so the
// shared valuation schema stays untouched; the SQL migrations are the source of truth.
const pgTable = valuation.table;

export const announcementKeywords = pgTable(
	'announcement_keywords',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		keyword: text('keyword').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('announcement_keywords_user_keyword').on(t.userId, sql`lower(${t.keyword})`)]
);

export const insiderTrades = pgTable('insider_trades', {
	id: serial('id').primaryKey(),
	dedupeKey: text('dedupe_key').notNull().unique(),
	nseSymbol: text('nse_symbol').notNull(),
	companyName: text('company_name').notNull(),
	personName: text('person_name').notNull(),
	personCategory: text('person_category').notNull(),
	securityType: text('security_type').notNull().default(''),
	txnType: text('txn_type').notNull(),
	mode: text('mode').notNull().default(''),
	quantity: bigint('quantity', { mode: 'number' }).notNull().default(0),
	value: numeric('value', { mode: 'number' }).notNull().default(0),
	beforeShares: bigint('before_shares', { mode: 'number' }),
	beforePct: numeric('before_pct', { mode: 'number' }),
	afterShares: bigint('after_shares', { mode: 'number' }),
	afterPct: numeric('after_pct', { mode: 'number' }),
	fromDate: date('from_date', { mode: 'string' }),
	toDate: date('to_date', { mode: 'string' }),
	broadcastAt: timestamp('broadcast_at', { withTimezone: true }).notNull(),
	sourceUrl: text('source_url'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const sastDisclosures = pgTable('sast_disclosures', {
	id: serial('id').primaryKey(),
	dedupeKey: text('dedupe_key').notNull().unique(),
	nseSymbol: text('nse_symbol').notNull(),
	companyName: text('company_name').notNull(),
	acquirerName: text('acquirer_name').notNull(),
	action: text('action').notNull(),
	securityType: text('security_type').notNull().default(''),
	mode: text('mode').notNull().default(''),
	regulation: text('regulation').notNull().default(''),
	isPromoter: boolean('is_promoter').notNull().default(false),
	sharesAcquired: bigint('shares_acquired', { mode: 'number' }),
	sharesSold: bigint('shares_sold', { mode: 'number' }),
	sharesAfter: bigint('shares_after', { mode: 'number' }),
	pctAcquired: numeric('pct_acquired', { mode: 'number' }),
	pctSold: numeric('pct_sold', { mode: 'number' }),
	pctAfter: numeric('pct_after', { mode: 'number' }),
	periodText: text('period_text').notNull().default(''),
	disclosedAt: timestamp('disclosed_at', { withTimezone: true }).notNull(),
	sourceUrl: text('source_url'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const corporateActions = pgTable('corporate_actions', {
	id: serial('id').primaryKey(),
	dedupeKey: text('dedupe_key').notNull().unique(),
	nseSymbol: text('nse_symbol').notNull(),
	companyName: text('company_name').notNull(),
	isin: text('isin'),
	kind: text('kind').notNull(),
	subject: text('subject').notNull(),
	amount: numeric('amount', { mode: 'number' }),
	ratio: text('ratio'),
	faceValue: numeric('face_value', { mode: 'number' }),
	exDate: date('ex_date', { mode: 'string' }).notNull(),
	recordDate: date('record_date', { mode: 'string' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const priceAlertRules = pgTable('price_alert_rules', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	nseSymbol: text('nse_symbol').notNull(),
	companyName: text('company_name').notNull(),
	kind: text('kind').notNull(),
	threshold: numeric('threshold', { mode: 'number' }).notNull(),
	basePrice: numeric('base_price', { mode: 'number' }),
	active: boolean('active').notNull().default(true),
	triggeredAt: timestamp('triggered_at', { withTimezone: true }),
	triggeredPrice: numeric('triggered_price', { mode: 'number' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const holdingAlertSettings = pgTable('holding_alert_settings', {
	userId: integer('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	promoterPp: numeric('promoter_pp', { mode: 'number' }),
	fiiPp: numeric('fii_pp', { mode: 'number' }),
	diiPp: numeric('dii_pp', { mode: 'number' }),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const holdingAlertDeliveries = pgTable(
	'holding_alert_deliveries',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		nseSymbol: text('nse_symbol').notNull(),
		period: text('period').notNull(),
		sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.nseSymbol, t.period] })]
);

export const watchlistSections = pgTable(
	'watchlist_sections',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		position: integer('position').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('watchlist_sections_user_name').on(t.userId, sql`lower(${t.name})`)]
);

export const watchlistSectionItems = pgTable(
	'watchlist_section_items',
	{
		sectionId: integer('section_id')
			.notNull()
			.references(() => watchlistSections.id, { onDelete: 'cascade' }),
		nseSymbol: text('nse_symbol').notNull(),
		companyName: text('company_name').notNull(),
		flagColor: text('flag_color'),
		flagLabel: text('flag_label'),
		addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.sectionId, t.nseSymbol] })]
);
