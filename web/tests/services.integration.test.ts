// DB-backed integration coverage for the Phase 2 services against the real
// dev Postgres (docker-compose's `postgres` service, DATABASE_URL from
// web/.env) - mirrors what tests/test_*.py exercised against the Python
// services, ported 1:1 in behavior. Uses one throwaway company per run
// (unique id) and cleans up via cascade delete in afterAll.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { companies, killTriggers, specificNiches, thesisScenarios, thesisVersions } from '../src/lib/server/db/schema';
import { evaluateObservations } from '../src/lib/server/services/ruleEngine';
import { postObservations, UnknownMetricError } from '../src/lib/server/services/observations';
import { logDecision, listDecisions } from '../src/lib/server/services/decisions';
import { logPrice, computePerformance } from '../src/lib/server/services/pricePerformance';
import { submitHealthCheck, resolveProposal, OverrideRequiresNoteError } from '../src/lib/server/services/audit';
import { createTable, createRow, deleteTable } from '../src/lib/server/services/customTables';
import { createGuidance, resolveGuidance } from '../src/lib/server/services/guidance';
import { proposeNiche } from '../src/lib/server/services/taxonomy';
import { NotFoundError } from '../src/lib/server/services/scenarios';

const COMPANY_ID = `VITEST_${Date.now()}`;
const ACTOR = 'vitest-actor';
let versionId: number;
let scenarioId: number;

beforeAll(async () => {
	await db.insert(companies).values({
		companyId: COMPANY_ID,
		name: 'Vitest Co',
		broadIndustryId: 1,
		specificNicheId: (await db.query.specificNiches.findFirst({ where: (t, { eq }) => eq(t.broadIndustryId, 1) }))!.id,
		operatingModel: 'factory',
		currency: 'INR'
	});

	const [scenario] = await db
		.insert(thesisScenarios)
		.values({ companyId: COMPANY_ID, owner: ACTOR, lastReviewed: '2026-01-01' })
		.returning();
	scenarioId = scenario.id;

	const [version] = await db
		.insert(thesisVersions)
		.values({
			companyId: COMPANY_ID,
			scenarioId: scenario.id,
			versionNo: 1,
			thesisData: {},
			authoredBy: ACTOR
		})
		.returning();
	versionId = version.versionId;

	await db.update(thesisScenarios).set({ currentVersionId: versionId }).where(eq(thesisScenarios.id, scenario.id));

	await db.insert(killTriggers).values({
		versionId,
		label: 'Revenue growth stalls',
		metricKey: 'revenue_growth_yoy_pct',
		operator: '<',
		threshold: '5',
		severity: 'kill',
		action: 'exit position',
		gracePeriods: 2,
		manualCheck: false
	});
});

afterAll(async () => {
	// thesis_versions and position_decisions are append-only (BEFORE UPDATE OR
	// DELETE triggers) by design (ADR-008/ADR-024) - cascading a company
	// delete through them is blocked in production on purpose. Test-only:
	// disable those two triggers just for this cleanup, then restore them.
	await db.execute(sql`ALTER TABLE thesis_versions DISABLE TRIGGER trg_forbid_version_update`);
	await db.execute(sql`ALTER TABLE position_decisions DISABLE TRIGGER trg_forbid_decision_update`);
	try {
		await db.delete(companies).where(eq(companies.companyId, COMPANY_ID)); // cascades everything
	} finally {
		await db.execute(sql`ALTER TABLE thesis_versions ENABLE TRIGGER trg_forbid_version_update`);
		await db.execute(sql`ALTER TABLE position_decisions ENABLE TRIGGER trg_forbid_decision_update`);
	}
});

describe('rule engine + observations (ports app/services/rule_engine.py)', () => {
	it('does not fire on a single breach when grace_periods=2', async () => {
		const result = await postObservations(
			COMPANY_ID,
			'FY26Q1',
			'2026-06-30',
			[{ metric_key: 'revenue_growth_yoy_pct', numeric_value: 2 }],
			ACTOR
		);
		expect(result.proposals).toHaveLength(0);
	});

	it('fires a kill proposal once the breach streak reaches grace_periods', async () => {
		const result = await postObservations(
			COMPANY_ID,
			'FY26Q2',
			'2026-09-30',
			[{ metric_key: 'revenue_growth_yoy_pct', numeric_value: 1 }],
			ACTOR
		);
		expect(result.proposals).toHaveLength(1);
		expect(result.proposals[0].proposed_status).toBe('broken');
		expect(result.proposals[0].source).toBe('rule_engine');
	});

	it('does not fire a duplicate proposal for the same trigger while one is already pending', async () => {
		const proposals = await evaluateObservations(COMPANY_ID, 'FY26Q2');
		expect(proposals).toHaveLength(0);
	});

	it('treats a missing observation as a data gap, not a breach', async () => {
		const result = await postObservations(
			COMPANY_ID,
			'FY27Q1',
			'2027-06-30',
			[{ metric_key: 'debt_to_equity', numeric_value: 0.5 }], // different metric, no revenue_growth_yoy_pct obs this period
			ACTOR
		);
		expect(result.proposals).toHaveLength(0);
	});

	it('rejects an unknown metric_key', async () => {
		await expect(
			postObservations(COMPANY_ID, 'FY27Q2', '2027-09-30', [{ metric_key: 'not_a_real_metric', numeric_value: 1 }], ACTOR)
		).rejects.toThrow(UnknownMetricError);
	});

	it('rejects observations for a nonexistent company', async () => {
		await expect(
			postObservations('NOPE_NOT_REAL', 'FY26Q1', '2026-06-30', [{ metric_key: 'debt_to_equity', numeric_value: 1 }], ACTOR)
		).rejects.toThrow(NotFoundError);
	});
});

describe('audit: overriding a fired kill trigger', () => {
	it('requires a non-empty note to submit a health check that overrides an active fired kill', async () => {
		await expect(submitHealthCheck(COMPANY_ID, 'FY26Q2', 'on_track', '', ACTOR)).rejects.toThrow(OverrideRequiresNoteError);
	});

	it('accepts the override once a note is supplied, and writes a status_event', async () => {
		const health = await submitHealthCheck(COMPANY_ID, 'FY26Q2', 'on_track', 'Reviewed manually, one-off dip.', ACTOR);
		expect(health.verdict).toBe('on_track');

		const [scenario] = await db.select().from(thesisScenarios).where(eq(thesisScenarios.id, scenarioId)).limit(1);
		expect(scenario.status).toBe('on_track');
	});
});

describe('decisions (ports app/services/decisions.py, append-only)', () => {
	it('logs a buy decision capturing the scenario current_version_id', async () => {
		const decision = await logDecision(COMPANY_ID, 'buy', 100, 10, '2026-02-01', 'Initial position', ACTOR);
		expect(decision.versionId).toBe(versionId);
		expect(Number(decision.price)).toBe(100);
	});

	it('lists decisions ordered by decided_on', async () => {
		await logDecision(COMPANY_ID, 'sell', 120, 5, '2026-03-01', 'Trim', ACTOR);
		const rows = await listDecisions(COMPANY_ID);
		expect(rows.length).toBeGreaterThanOrEqual(2);
		expect(rows[0].decidedOn <= rows[rows.length - 1].decidedOn).toBe(true);
	});
});

describe('price performance (ports app/services/price_performance.py)', () => {
	it('computes pct_change against the decision baseline (first buy price)', async () => {
		await logPrice(COMPANY_ID, '2026-04-01', 150, ACTOR);
		const perf = await computePerformance(COMPANY_ID, 'decision', ACTOR);
		expect(perf.baseline_price).toBe(100);
		expect(perf.current_price).toBe(150);
		expect(perf.pct_change).toBeCloseTo(50, 5);
	});

	it("falls back to the nearest price when nothing was logged on/after the thesis's last_reviewed date", async () => {
		const perf = await computePerformance(COMPANY_ID, 'thesis', ACTOR);
		expect(perf.baseline_price).not.toBeNull();
		expect(perf.note).toMatch(/nearest available price/);
	});
});

describe('custom tables (ports app/routers/custom_tables.py)', () => {
	it('creates a table, validates row types, and rejects an unknown column key', async () => {
		const table = await createTable(
			COMPANY_ID,
			'Peer Comps',
			[
				{ key: 'peer', label: 'Peer', type: 'text' },
				{ key: 'pe_ratio', label: 'P/E', type: 'number' }
			],
			'proof_points',
			ACTOR
		);
		const row = await createRow(table.id, { peer: 'CompCo', pe_ratio: '18.5' }, ACTOR);
		expect(row?.rowData).toEqual({ peer: 'CompCo', pe_ratio: 18.5 });

		await expect(createRow(table.id, { unknown_col: 1 }, ACTOR)).rejects.toThrow(/unknown column key/);
		await deleteTable(table.id);
	});
});

describe('guidance (ports app/routers/guidance.py)', () => {
	it('creates and resolves a guidance note', async () => {
		const { note } = await createGuidance(COMPANY_ID, 'what_can_kill_it', 'Add a competitor risk trigger.', ACTOR);
		expect(note.status).toBe('open');
		const resolved = await resolveGuidance(note.id, ACTOR);
		expect(resolved?.note.status).toBe('resolved');
		expect(resolved?.note.resolvedBy).toBe(ACTOR);
	});
});

describe('taxonomy (ports app/services/taxonomy.py propose_niche)', () => {
	it('creates a new niche under an existing industry, idempotently', async () => {
		const name = `Vitest Niche ${Date.now()}`;
		const first = await proposeNiche('Auto & Mobility', name);
		const second = await proposeNiche('Auto & Mobility', name);
		expect(second.id).toBe(first.id);
		// This niche isn't tied to the throwaway company, so afterAll's cascade
		// delete never reaches it - clean it up here or it pollutes the real
		// taxonomy (and the dashboard's facet bar) on every test run.
		await db.delete(specificNiches).where(eq(specificNiches.id, first.id));
	});
});
