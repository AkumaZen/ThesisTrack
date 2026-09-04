// Drizzle schema mirroring app/models.py (SQLAlchemy). The schema itself is
// owned by raw-SQL migrations under web/drizzle/ (ported from the Alembic
// migrations) - this file describes that already-created schema for the
// query layer, same relationship the Python models.py had to its migrations.
import {
	bigint,
	bigserial,
	boolean,
	check,
	date,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
	serial,
	smallint,
	text,
	timestamp,
	unique,
	varchar
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const operatingModelEnum = pgEnum('operating_model', [
	'factory',
	'subscription',
	'money_lending',
	'retail_stores',
	'services'
]);
export const thesisStatusEnum = pgEnum('thesis_status', ['on_track', 'watch_closely', 'broken']);
export const verdictSourceEnum = pgEnum('verdict_source', ['manual', 'rule_engine', 'ai_proposed']);
export const thesisOutcomeEnum = pgEnum('thesis_outcome', [
	'open',
	'played_out',
	'invalidated',
	'exited_early',
	'superseded'
]);
export const metricUnitEnum = pgEnum('metric_unit', [
	'pct',
	'days',
	'ratio',
	'currency',
	'count',
	'currency_per_unit'
]);
export const triggerSeverityEnum = pgEnum('trigger_severity', ['warn', 'kill']);
export const proposalStateEnum = pgEnum('proposal_state', [
	'pending',
	'accepted',
	'rejected',
	'superseded'
]);
export const userRoleEnum = pgEnum('user_role', ['read_write', 'read_only']);

export const broadIndustries = pgTable('broad_industries', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 100 }).notNull().unique(),
	isActive: boolean('is_active').notNull().default(true)
});

export const specificNiches = pgTable(
	'specific_niches',
	{
		id: serial('id').primaryKey(),
		broadIndustryId: integer('broad_industry_id')
			.notNull()
			.references(() => broadIndustries.id),
		name: varchar('name', { length: 120 }).notNull(),
		isActive: boolean('is_active').notNull().default(true)
	},
	(t) => [unique().on(t.broadIndustryId, t.name)]
);

export const metricDefinitions = pgTable('metric_definitions', {
	metricKey: varchar('metric_key', { length: 60 }).primaryKey(),
	label: varchar('label', { length: 120 }).notNull(),
	operatingModel: operatingModelEnum('operating_model'),
	unit: metricUnitEnum('unit').notNull(),
	higherIsBetter: boolean('higher_is_better'),
	decimals: smallint('decimals').notNull().default(1),
	isCore: boolean('is_core').notNull().default(false),
	helpText: text('help_text'),
	sortOrder: smallint('sort_order').notNull().default(100)
});

export const companies = pgTable('companies', {
	companyId: varchar('company_id', { length: 50 }).primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	broadIndustryId: integer('broad_industry_id')
		.notNull()
		.references(() => broadIndustries.id),
	specificNicheId: integer('specific_niche_id')
		.notNull()
		.references(() => specificNiches.id),
	operatingModel: operatingModelEnum('operating_model').notNull(),
	currency: varchar('currency', { length: 3 }).notNull().default('INR'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const thesisScenarios = pgTable(
	'thesis_scenarios',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		companyId: varchar('company_id', { length: 50 })
			.notNull()
			.references(() => companies.companyId, { onDelete: 'cascade' }),
		owner: varchar('owner', { length: 80 }).notNull(),
		label: varchar('label', { length: 120 }).notNull().default('Thesis'),
		status: thesisStatusEnum('status').notNull().default('on_track'),
		statusSource: verdictSourceEnum('status_source').notNull().default('manual'),
		outcome: thesisOutcomeEnum('outcome').notNull().default('open'),
		conviction: smallint('conviction'),
		entryDate: date('entry_date'),
		exitDate: date('exit_date'),
		lastReviewed: date('last_reviewed').notNull(),
		// FK to thesis_versions.version_id added in the migration (circular with
		// thesis_versions.scenario_id) - omitted here, enforced at the DB level.
		currentVersionId: bigint('current_version_id', { mode: 'number' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique().on(t.companyId, t.owner),
		check('conviction_range', sql`${t.conviction} BETWEEN 1 AND 5`)
	]
);

export const thesisVersions = pgTable(
	'thesis_versions',
	{
		versionId: bigserial('version_id', { mode: 'number' }).primaryKey(),
		companyId: varchar('company_id', { length: 50 })
			.notNull()
			.references(() => companies.companyId, { onDelete: 'cascade' }),
		scenarioId: bigint('scenario_id', { mode: 'number' })
			.notNull()
			.references(() => thesisScenarios.id, { onDelete: 'cascade' }),
		versionNo: integer('version_no').notNull(),
		thesisData: jsonb('thesis_data').notNull(),
		changeNote: text('change_note'),
		authoredBy: varchar('authored_by', { length: 80 }).notNull(),
		authoredAt: timestamp('authored_at', { withTimezone: true }).notNull().defaultNow()
		// search_tsv (generated tsvector column) is DB-owned, not modeled here -
		// the app never reads/writes it directly.
	},
	(t) => [unique().on(t.scenarioId, t.versionNo)]
);

export const observations = pgTable(
	'observations',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		companyId: varchar('company_id', { length: 50 })
			.notNull()
			.references(() => companies.companyId, { onDelete: 'cascade' }),
		period: varchar('period', { length: 10 }).notNull(),
		periodEnd: date('period_end').notNull(),
		metricKey: varchar('metric_key', { length: 60 })
			.notNull()
			.references(() => metricDefinitions.metricKey),
		numericValue: numeric('numeric_value', { precision: 20, scale: 4 }),
		textValue: text('text_value'),
		sourceType: varchar('source_type', { length: 40 }),
		sourceUrl: text('source_url'),
		note: text('note'),
		ingestedBy: varchar('ingested_by', { length: 80 }).notNull(),
		ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique().on(t.companyId, t.period, t.metricKey)]
);

export const killTriggers = pgTable('kill_triggers', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	versionId: bigint('version_id', { mode: 'number' })
		.notNull()
		.references(() => thesisVersions.versionId, { onDelete: 'cascade' }),
	label: text('label').notNull(),
	metricKey: varchar('metric_key', { length: 60 }).references(() => metricDefinitions.metricKey),
	operator: varchar('operator', { length: 4 }),
	threshold: numeric('threshold', { precision: 20, scale: 4 }),
	severity: triggerSeverityEnum('severity').notNull().default('kill'),
	action: text('action').notNull(),
	gracePeriods: smallint('grace_periods').notNull().default(1),
	manualCheck: boolean('manual_check').notNull().default(false)
});

export const triggerEvaluations = pgTable(
	'trigger_evaluations',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		triggerId: bigint('trigger_id', { mode: 'number' })
			.notNull()
			.references(() => killTriggers.id, { onDelete: 'cascade' }),
		period: varchar('period', { length: 10 }).notNull(),
		observedValue: numeric('observed_value', { precision: 20, scale: 4 }),
		breached: boolean('breached').notNull(),
		fired: boolean('fired').notNull(),
		evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique().on(t.triggerId, t.period)]
);

export const healthChecks = pgTable(
	'health_checks',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		companyId: varchar('company_id', { length: 50 })
			.notNull()
			.references(() => companies.companyId, { onDelete: 'cascade' }),
		scenarioId: bigint('scenario_id', { mode: 'number' })
			.notNull()
			.references(() => thesisScenarios.id, { onDelete: 'cascade' }),
		versionId: bigint('version_id', { mode: 'number' })
			.notNull()
			.references(() => thesisVersions.versionId),
		period: varchar('period', { length: 10 }).notNull(),
		verdict: thesisStatusEnum('verdict').notNull(),
		source: verdictSourceEnum('source').notNull(),
		note: text('note').notNull(),
		reasoningChain: jsonb('reasoning_chain'),
		evidence: jsonb('evidence'),
		humanConfirmed: boolean('human_confirmed').notNull().default(false),
		modelName: varchar('model_name', { length: 80 }),
		author: varchar('author', { length: 80 }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique().on(t.companyId, t.period)]
);

export const positionDecisions = pgTable('position_decisions', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	companyId: varchar('company_id', { length: 50 })
		.notNull()
		.references(() => companies.companyId, { onDelete: 'cascade' }),
	scenarioId: bigint('scenario_id', { mode: 'number' })
		.notNull()
		.references(() => thesisScenarios.id, { onDelete: 'cascade' }),
	versionId: bigint('version_id', { mode: 'number' }).references(() => thesisVersions.versionId),
	action: varchar('action', { length: 4 }).notNull(),
	price: numeric('price').notNull(),
	quantity: numeric('quantity'),
	decidedOn: date('decided_on').notNull(),
	rationale: text('rationale').notNull(),
	actor: varchar('actor', { length: 80 }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const priceObservations = pgTable(
	'price_observations',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		companyId: varchar('company_id', { length: 50 })
			.notNull()
			.references(() => companies.companyId, { onDelete: 'cascade' }),
		observedOn: date('observed_on').notNull(),
		price: numeric('price').notNull(),
		source: varchar('source', { length: 20 }).notNull().default('manual'),
		actor: varchar('actor', { length: 80 }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique().on(t.companyId, t.observedOn)]
);

export const statusProposals = pgTable('status_proposals', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	companyId: varchar('company_id', { length: 50 })
		.notNull()
		.references(() => companies.companyId, { onDelete: 'cascade' }),
	scenarioId: bigint('scenario_id', { mode: 'number' })
		.notNull()
		.references(() => thesisScenarios.id, { onDelete: 'cascade' }),
	period: varchar('period', { length: 10 }),
	proposedStatus: thesisStatusEnum('proposed_status').notNull(),
	source: verdictSourceEnum('source').notNull(),
	rationale: text('rationale').notNull(),
	evidence: jsonb('evidence'),
	state: proposalStateEnum('state').notNull().default('pending'),
	modelName: varchar('model_name', { length: 80 }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	resolvedBy: varchar('resolved_by', { length: 80 }),
	resolvedAt: timestamp('resolved_at', { withTimezone: true }),
	resolutionNote: text('resolution_note')
});

export const users = pgTable('users', {
	id: serial('id').primaryKey(),
	email: varchar('email', { length: 255 }).notNull().unique(),
	passwordHash: varchar('password_hash', { length: 255 }).notNull(),
	role: userRoleEnum('role').notNull().default('read_write'),
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastLoginAt: timestamp('last_login_at', { withTimezone: true })
});

export const trainingSplits = pgTable('training_splits', {
	companyId: varchar('company_id', { length: 50 })
		.primaryKey()
		.references(() => companies.companyId, { onDelete: 'cascade' }),
	split: varchar('split', { length: 10 }).notNull(),
	assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow()
});

export const guidanceNotes = pgTable(
	'guidance_notes',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		companyId: varchar('company_id', { length: 50 })
			.notNull()
			.references(() => companies.companyId, { onDelete: 'cascade' }),
		blockKey: varchar('block_key', { length: 40 }).notNull(),
		note: text('note').notNull(),
		status: varchar('status', { length: 10 }).notNull().default('open'),
		createdBy: varchar('created_by', { length: 80 }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		resolvedBy: varchar('resolved_by', { length: 80 }),
		resolvedAt: timestamp('resolved_at', { withTimezone: true })
	},
	(t) => [check('status_check', sql`${t.status} IN ('open', 'resolved')`)]
);

export const customTables = pgTable('custom_tables', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	companyId: varchar('company_id', { length: 50 })
		.notNull()
		.references(() => companies.companyId, { onDelete: 'cascade' }),
	name: varchar('name', { length: 120 }).notNull(),
	columns: jsonb('columns').notNull().default([]),
	section: varchar('section', { length: 50 }),
	createdBy: varchar('created_by', { length: 80 }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const customTableRows = pgTable('custom_table_rows', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	tableId: bigint('table_id', { mode: 'number' })
		.notNull()
		.references(() => customTables.id, { onDelete: 'cascade' }),
	rowData: jsonb('row_data').notNull().default({}),
	rowOrder: integer('row_order').notNull().default(0),
	createdBy: varchar('created_by', { length: 80 }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const sectors = pgTable('sectors', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	name: varchar('name', { length: 100 }).notNull().unique(),
	description: text('description'),
	// Nullable - a sector can span multiple operating models (e.g. a
	// "Precision Components" sector may hold both factory and services cos).
	operatingModel: operatingModelEnum('operating_model'),
	createdBy: varchar('created_by', { length: 80 }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const sectorCompanies = pgTable(
	'sector_companies',
	{
		sectorId: bigint('sector_id', { mode: 'number' })
			.notNull()
			.references(() => sectors.id, { onDelete: 'cascade' }),
		companyId: varchar('company_id', { length: 50 })
			.notNull()
			.references(() => companies.companyId, { onDelete: 'cascade' }),
		addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.sectorId, t.companyId] })]
);

export const statusEvents = pgTable('status_events', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	companyId: varchar('company_id', { length: 50 })
		.notNull()
		.references(() => companies.companyId, { onDelete: 'cascade' }),
	scenarioId: bigint('scenario_id', { mode: 'number' })
		.notNull()
		.references(() => thesisScenarios.id, { onDelete: 'cascade' }),
	fromStatus: thesisStatusEnum('from_status'),
	toStatus: thesisStatusEnum('to_status').notNull(),
	source: verdictSourceEnum('source').notNull(),
	proposalId: bigint('proposal_id', { mode: 'number' }).references(() => statusProposals.id),
	rationale: text('rationale').notNull(),
	override: boolean('override').notNull().default(false),
	actor: varchar('actor', { length: 80 }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
