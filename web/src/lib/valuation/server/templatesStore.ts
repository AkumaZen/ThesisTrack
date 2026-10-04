import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { valuationTemplateDefaults, valuationTemplates } from '$lib/server/db/valuationSchema';
import { isUniqueViolation } from './watchlistsStore';
import { listAllBaskets } from './sectorStore';
import type { MethodId } from '$lib/valuation/valuationEngine';
import type { StartingTemplate, ValuationTemplate } from '$lib/valuation/templates';

type Row = typeof valuationTemplates.$inferSelect;

function toTemplate(r: Row, basketDefaults: string[]): ValuationTemplate {
	return {
		id: r.id,
		name: r.name,
		assumptions: r.assumptions as ValuationTemplate['assumptions'],
		activeMethod: r.activeMethod as MethodId,
		createdBy: r.createdBy,
		updatedBy: r.updatedBy,
		updatedAt: r.updatedAt,
		basketDefaults
	};
}

export async function listTemplates(): Promise<ValuationTemplate[]> {
	const [rows, defaults] = await Promise.all([
		db
			.select()
			.from(valuationTemplates)
			.orderBy(asc(sql`lower(${valuationTemplates.name})`)),
		db.select().from(valuationTemplateDefaults)
	]);
	return rows.map((r) =>
		toTemplate(
			r,
			defaults
				.filter((d) => d.templateId === r.id && d.scope.startsWith('basket:'))
				.map((d) => d.scope.slice('basket:'.length))
		)
	);
}

export type TemplateOutcome<T> =
	{ ok: true; value: T } | { ok: false; reason: 'duplicate' | 'not_found' | 'forbidden' };

export async function createTemplate(
	input: { name: string; assumptions: unknown; activeMethod: MethodId },
	by: string
): Promise<TemplateOutcome<number>> {
	const now = Date.now();
	try {
		const [row] = await db
			.insert(valuationTemplates)
			.values({
				name: input.name.trim(),
				assumptions: input.assumptions,
				activeMethod: input.activeMethod,
				createdBy: by,
				createdAt: now,
				updatedBy: by,
				updatedAt: now
			})
			.returning({ id: valuationTemplates.id });
		return { ok: true, value: row.id };
	} catch (e) {
		if (isUniqueViolation(e)) return { ok: false, reason: 'duplicate' };
		throw e;
	}
}

/** Renames and/or replaces the content. Anyone may update a shared template (it is recorded who
 *  did); only its creator or the admin may delete it. */
export async function updateTemplate(
	id: number,
	patch: { name?: string; assumptions?: unknown; activeMethod?: MethodId },
	by: string
): Promise<TemplateOutcome<null>> {
	try {
		const updated = await db
			.update(valuationTemplates)
			.set({
				...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
				...(patch.assumptions !== undefined ? { assumptions: patch.assumptions } : {}),
				...(patch.activeMethod !== undefined ? { activeMethod: patch.activeMethod } : {}),
				updatedBy: by,
				updatedAt: Date.now()
			})
			.where(eq(valuationTemplates.id, id))
			.returning({ id: valuationTemplates.id });
		return updated.length ? { ok: true, value: null } : { ok: false, reason: 'not_found' };
	} catch (e) {
		if (isUniqueViolation(e)) return { ok: false, reason: 'duplicate' };
		throw e;
	}
}

export async function deleteTemplate(
	id: number,
	user: { username: string; role: string }
): Promise<TemplateOutcome<null>> {
	const [row] = await db.select().from(valuationTemplates).where(eq(valuationTemplates.id, id));
	if (!row) return { ok: false, reason: 'not_found' };
	if (row.createdBy !== user.username && user.role !== 'admin') {
		return { ok: false, reason: 'forbidden' };
	}
	await db.delete(valuationTemplates).where(eq(valuationTemplates.id, id));
	return { ok: true, value: null };
}

/** Sets (templateId) or clears (null) the default for a scope ('user:<id>' or 'basket:<key>'). */
export async function setTemplateDefault(
	scope: string,
	templateId: number | null,
	by: string
): Promise<TemplateOutcome<null>> {
	if (templateId === null) {
		await db.delete(valuationTemplateDefaults).where(eq(valuationTemplateDefaults.scope, scope));
		return { ok: true, value: null };
	}
	const [exists] = await db
		.select({ id: valuationTemplates.id })
		.from(valuationTemplates)
		.where(eq(valuationTemplates.id, templateId));
	if (!exists) return { ok: false, reason: 'not_found' };
	const values = { scope, templateId, setBy: by, setAt: Date.now() };
	await db
		.insert(valuationTemplateDefaults)
		.values(values)
		.onConflictDoUpdate({ target: valuationTemplateDefaults.scope, set: values });
	return { ok: true, value: null };
}

export async function userDefaultTemplateId(userId: number): Promise<number | null> {
	const [row] = await db
		.select()
		.from(valuationTemplateDefaults)
		.where(eq(valuationTemplateDefaults.scope, `user:${userId}`));
	return row?.templateId ?? null;
}

/** A sector basket's default is more specific than a person's own default, so it wins. Among
 *  several baskets holding the company, the first in alphabetical order with a default is used. */
export async function startingTemplateFor(
	symbol: string,
	userId: number
): Promise<StartingTemplate | null> {
	const baskets = (await listAllBaskets()).filter((b) => b.symbols.includes(symbol.toUpperCase()));
	const scopes = [...baskets.map((b) => `basket:${b.key}`), `user:${userId}`];
	const defaults = await db
		.select()
		.from(valuationTemplateDefaults)
		.where(inArray(valuationTemplateDefaults.scope, scopes));
	for (const scope of scopes) {
		const d = defaults.find((x) => x.scope === scope);
		if (!d) continue;
		const [row] = await db
			.select()
			.from(valuationTemplates)
			.where(eq(valuationTemplates.id, d.templateId));
		if (!row) continue;
		const basket = baskets.find((b) => `basket:${b.key}` === scope);
		return {
			template: toTemplate(row, []),
			reason: basket ? `the default for ${basket.label}` : 'your default'
		};
	}
	return null;
}
