import { and, asc, eq, inArray, like } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { alertState, strengthFilterPrefs, strengthRules } from '$lib/server/db/valuationSchema';
import { users } from '$lib/server/db/schema';
import {
	parseRepeat,
	parseStrengthConfig,
	type RepeatPolicy,
	type StrengthConfig
} from '../strength';
import type { StrengthLevel } from './strengthEngine';

export const STRENGTH_LEVELS: StrengthLevel[] = ['sectors', 'subsectors', 'companies', 'company'];
export const isStrengthLevel = (v: unknown): v is StrengthLevel =>
	typeof v === 'string' && (STRENGTH_LEVELS as string[]).includes(v);

export interface StrengthRule {
	id: number;
	name: string;
	level: StrengthLevel;
	parentKey: string | null;
	config: StrengthConfig;
	repeat: RepeatPolicy;
	enabled: boolean;
	createdBy: string | null;
	createdAt: number;
}

function toRule(row: typeof strengthRules.$inferSelect, createdBy: string | null): StrengthRule {
	return {
		id: row.id,
		name: row.name,
		level: row.level,
		parentKey: row.parentKey,
		config: parseStrengthConfig(row.config),
		repeat: parseRepeat(row.repeat),
		enabled: row.enabled,
		createdBy,
		createdAt: row.createdAt
	};
}

export async function listRules(): Promise<StrengthRule[]> {
	const rows = await db
		.select({ rule: strengthRules, by: users.displayName })
		.from(strengthRules)
		.leftJoin(users, eq(users.id, strengthRules.createdBy))
		.orderBy(asc(strengthRules.id));
	return rows.map((r) => toRule(r.rule, r.by));
}

export async function createRule(input: {
	name: string;
	level: StrengthLevel;
	parentKey: string | null;
	config: StrengthConfig;
	repeat: RepeatPolicy;
	userId: number;
}): Promise<StrengthRule> {
	const [row] = await db
		.insert(strengthRules)
		.values({
			name: input.name,
			level: input.level,
			parentKey: input.parentKey,
			config: input.config,
			repeat: input.repeat,
			createdBy: input.userId,
			createdAt: Date.now()
		})
		.returning();
	return toRule(row, null);
}

export async function setRuleEnabled(id: number, enabled: boolean): Promise<boolean> {
	const rows = await db
		.update(strengthRules)
		.set({ enabled })
		.where(eq(strengthRules.id, id))
		.returning({ id: strengthRules.id });
	return rows.length > 0;
}

/** Removes the rule and its remembered per-subject state. */
export async function deleteRule(id: number): Promise<boolean> {
	const rows = await db
		.delete(strengthRules)
		.where(eq(strengthRules.id, id))
		.returning({ id: strengthRules.id });
	await db.delete(alertState).where(like(alertState.key, `strength:${id}:%`));
	return rows.length > 0;
}

/** A place within a level (a sector, subsector or company key), or '' for the level as a whole. */
export const isFilterScope = (v: unknown): v is string =>
	typeof v === 'string' && v.length <= 120 && /^[A-Za-z0-9&._%/-]*$/.test(v);

/**
 * The person's filter for one place. A place with none of its own starts from the one kept for
 * the whole level (what was saved before filters were kept per place).
 */
export async function getFilterPref(
	userId: number,
	level: StrengthLevel,
	scope = ''
): Promise<StrengthConfig | null> {
	const rows = await db
		.select()
		.from(strengthFilterPrefs)
		.where(
			and(
				eq(strengthFilterPrefs.userId, userId),
				eq(strengthFilterPrefs.level, level),
				inArray(strengthFilterPrefs.scope, [...new Set([scope, ''])])
			)
		);
	const row = rows.find((r) => r.scope === scope) ?? rows.find((r) => r.scope === '');
	return row ? parseStrengthConfig(row.config) : null;
}

export async function saveFilterPref(
	userId: number,
	level: StrengthLevel,
	config: StrengthConfig,
	scope = ''
): Promise<void> {
	await db
		.insert(strengthFilterPrefs)
		.values({ userId, level, scope, config })
		.onConflictDoUpdate({
			target: [strengthFilterPrefs.userId, strengthFilterPrefs.level, strengthFilterPrefs.scope],
			set: { config }
		});
}
