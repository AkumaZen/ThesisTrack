// Ports app/services/audit.py - human verdicts + override audit trail.
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { healthChecks, statusEvents, statusProposals, thesisScenarios } from '../db/schema';
import { getMyScenario } from './scenarios';

export class NotFoundError extends Error {}
export class AlreadyResolvedError extends Error {}
export class OverrideRequiresNoteError extends Error {}

async function findActiveFiredKill(scenarioId: number) {
	const [row] = await db
		.select()
		.from(statusProposals)
		.where(
			and(
				eq(statusProposals.scenarioId, scenarioId),
				eq(statusProposals.source, 'rule_engine'),
				eq(statusProposals.proposedStatus, 'broken'),
				eq(statusProposals.state, 'pending')
			)
		)
		.limit(1);
	return row ?? null;
}

export async function resolveProposal(
	proposalId: number,
	action: 'accept' | 'reject',
	verdict: string | null,
	note: string | null,
	actor: string
) {
	const [proposal] = await db.select().from(statusProposals).where(eq(statusProposals.id, proposalId)).limit(1);
	if (!proposal) throw new NotFoundError(`proposal ${proposalId} not found`);
	if (proposal.state !== 'pending') throw new AlreadyResolvedError(`proposal ${proposalId} is already ${proposal.state}`);

	const [scenario] = await db.select().from(thesisScenarios).where(eq(thesisScenarios.id, proposal.scenarioId)).limit(1);
	const isFiredKill = proposal.source === 'rule_engine' && proposal.proposedStatus === 'broken';

	let finalStatus: string;
	if (action === 'accept') {
		finalStatus = verdict || proposal.proposedStatus;
	} else if (action === 'reject') {
		finalStatus = scenario.status;
	} else {
		throw new Error(`action must be 'accept' or 'reject', got ${JSON.stringify(action)}`);
	}

	const isOverride = isFiredKill && finalStatus !== 'broken';
	if (isOverride && !note) {
		throw new OverrideRequiresNoteError('overriding a fired kill trigger requires a non-empty resolution_note');
	}

	const fromStatus = scenario.status;

	if (action === 'accept') {
		const reasoningChain =
			proposal.source === 'ai_proposed'
				? ((proposal.evidence as { reasoning_chain?: unknown } | null)?.reasoning_chain ?? null)
				: null;
		await db.insert(healthChecks).values({
			companyId: scenario.companyId,
			scenarioId: scenario.id,
			versionId: scenario.currentVersionId!,
			period: proposal.period!,
			verdict: finalStatus as 'on_track' | 'watch_closely' | 'broken',
			source: 'manual',
			note: note || proposal.rationale,
			reasoningChain: reasoningChain as object | null,
			evidence: proposal.evidence,
			humanConfirmed: true,
			author: actor
		});
		await db
			.update(thesisScenarios)
			.set({ status: finalStatus as 'on_track' | 'watch_closely' | 'broken', statusSource: 'manual', lastReviewed: new Date().toISOString().slice(0, 10) })
			.where(eq(thesisScenarios.id, scenario.id));
	}

	await db
		.update(statusProposals)
		.set({
			state: action === 'accept' ? 'accepted' : 'rejected',
			resolvedBy: actor,
			resolutionNote: note
		})
		.where(eq(statusProposals.id, proposalId));

	await db.insert(statusEvents).values({
		companyId: scenario.companyId,
		scenarioId: scenario.id,
		fromStatus: fromStatus as 'on_track' | 'watch_closely' | 'broken',
		toStatus: finalStatus as 'on_track' | 'watch_closely' | 'broken',
		source: 'manual',
		proposalId: proposal.id,
		rationale: note || proposal.rationale,
		override: isOverride,
		actor
	});

	const [updated] = await db.select().from(statusProposals).where(eq(statusProposals.id, proposalId)).limit(1);
	return updated;
}

export async function submitHealthCheck(companyId: string, period: string, verdict: string, note: string, actor: string) {
	const scenario = await getMyScenario(companyId, actor);

	const activeKill = await findActiveFiredKill(scenario.id);
	const isOverride = activeKill != null && verdict !== 'broken';
	if (isOverride && !note) {
		throw new OverrideRequiresNoteError('overriding an active fired kill trigger requires a non-empty note');
	}

	const fromStatus = scenario.status;
	const [health] = await db
		.insert(healthChecks)
		.values({
			companyId,
			scenarioId: scenario.id,
			versionId: scenario.currentVersionId!,
			period,
			verdict: verdict as 'on_track' | 'watch_closely' | 'broken',
			source: 'manual',
			note,
			humanConfirmed: true,
			author: actor
		})
		.returning();

	await db
		.update(thesisScenarios)
		.set({
			status: verdict as 'on_track' | 'watch_closely' | 'broken',
			statusSource: 'manual',
			lastReviewed: new Date().toISOString().slice(0, 10)
		})
		.where(eq(thesisScenarios.id, scenario.id));

	await db.insert(statusEvents).values({
		companyId,
		scenarioId: scenario.id,
		fromStatus: fromStatus as 'on_track' | 'watch_closely' | 'broken',
		toStatus: verdict as 'on_track' | 'watch_closely' | 'broken',
		source: 'manual',
		proposalId: null,
		rationale: note,
		override: isOverride,
		actor
	});

	return health;
}

export async function closeOutcome(companyId: string, outcome: string, note: string, actor: string) {
	const scenario = await getMyScenario(companyId, actor);

	await db
		.update(thesisScenarios)
		.set({ outcome: outcome as 'played_out' | 'invalidated' | 'exited_early', exitDate: new Date().toISOString().slice(0, 10) })
		.where(eq(thesisScenarios.id, scenario.id));

	await db.insert(statusEvents).values({
		companyId,
		scenarioId: scenario.id,
		fromStatus: scenario.status,
		toStatus: scenario.status,
		source: 'manual',
		proposalId: null,
		rationale: `outcome closed as '${outcome}': ${note}`,
		override: false,
		actor
	});

	const [updated] = await db.select().from(thesisScenarios).where(eq(thesisScenarios.id, scenario.id)).limit(1);
	return updated;
}
