// Ports app/routers/guidance.py.
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { companies, guidanceNotes } from '../db/schema';
import { NotFoundError } from './scenarios';

export type GuidanceTarget = {
	targetMetric?: 'revenue' | 'margin' | 'other' | null;
	targetMetricLabel?: string | null;
	targetValue?: number | null;
	targetUnit?: string | null;
	targetPeriod?: string | null;
	expectedResultsDate?: string | null;
};

export async function createGuidance(
	companyId: string,
	blockKey: string,
	note: string,
	actorIdentity: string,
	target: GuidanceTarget = {}
) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const [row] = await db
		.insert(guidanceNotes)
		.values({
			companyId,
			blockKey,
			note,
			createdBy: actorIdentity,
			targetMetric: target.targetMetric ?? null,
			targetMetricLabel: target.targetMetricLabel ?? null,
			targetValue: target.targetValue != null ? String(target.targetValue) : null,
			targetUnit: target.targetUnit ?? null,
			targetPeriod: target.targetPeriod ?? null,
			expectedResultsDate: target.expectedResultsDate ?? null
		})
		.returning();
	return { note: row, companyName: company.name };
}

export async function listGuidance(
	companyId: string | null,
	blockKey: string | null,
	status: string | null,
	owner: string | null = null
) {
	const conditions = [];
	if (companyId) conditions.push(eq(guidanceNotes.companyId, companyId));
	if (blockKey) conditions.push(eq(guidanceNotes.blockKey, blockKey));
	if (status) conditions.push(eq(guidanceNotes.status, status));
	if (owner) conditions.push(eq(guidanceNotes.createdBy, owner));

	// Latest guidance always on top, plain and simple - no secondary sort by
	// status/outcome to muddy that ordering.
	const rows = await db
		.select({ note: guidanceNotes, companyName: companies.name })
		.from(guidanceNotes)
		.innerJoin(companies, eq(guidanceNotes.companyId, companies.companyId))
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(desc(guidanceNotes.createdAt));
	return rows;
}

export async function resolveGuidance(guidanceId: number, actorIdentity: string) {
	const [note] = await db.select().from(guidanceNotes).where(eq(guidanceNotes.id, guidanceId)).limit(1);
	if (!note) return null;

	await db
		.update(guidanceNotes)
		.set({ status: 'resolved', resolvedBy: actorIdentity, resolvedAt: new Date() })
		.where(eq(guidanceNotes.id, guidanceId));

	const [updated] = await db.select().from(guidanceNotes).where(eq(guidanceNotes.id, guidanceId)).limit(1);
	const [company] = await db.select().from(companies).where(eq(companies.companyId, updated.companyId)).limit(1);
	return { note: updated, companyName: company?.name ?? null };
}

// Marking a target achieved/missed is also what resolves the note - once the
// period's numbers are in, there's nothing left to track.
export async function setGuidanceOutcome(guidanceId: number, outcome: 'achieved' | 'missed', actorIdentity: string) {
	const [note] = await db.select().from(guidanceNotes).where(eq(guidanceNotes.id, guidanceId)).limit(1);
	if (!note) return null;

	await db
		.update(guidanceNotes)
		.set({ outcome, status: 'resolved', resolvedBy: actorIdentity, resolvedAt: new Date() })
		.where(eq(guidanceNotes.id, guidanceId));

	const [updated] = await db.select().from(guidanceNotes).where(eq(guidanceNotes.id, guidanceId)).limit(1);
	const [company] = await db.select().from(companies).where(eq(companies.companyId, updated.companyId)).limit(1);
	return { note: updated, companyName: company?.name ?? null };
}

export async function deleteGuidance(guidanceId: number) {
	const [note] = await db.select().from(guidanceNotes).where(eq(guidanceNotes.id, guidanceId)).limit(1);
	if (!note) return false;
	await db.delete(guidanceNotes).where(eq(guidanceNotes.id, guidanceId));
	return true;
}
