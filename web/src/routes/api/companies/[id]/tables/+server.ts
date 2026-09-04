// Ports POST/GET /api/companies/{id}/tables from app/routers/custom_tables.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireActor, requireWriteActor, errorResponse, handleAuthError } from '$lib/server/http';
import { createTable, listTables } from '$lib/server/services/customTables';
import { NotFoundError } from '$lib/server/services/scenarios';
import { PILLAR_KEYS } from '$lib/server/pillars';

const column = z
	.object({
		key: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
		label: z.string().min(1).max(120),
		type: z.enum(['text', 'number', 'date', 'enum']).default('text'),
		options: z.array(z.string()).nullish()
	})
	.refine((v) => !(v.options && v.options.length && v.type !== 'enum'), {
		message: "options is only valid for a column with type='enum'"
	})
	.refine((v) => !(v.type === 'enum' && (!v.options || !v.options.length)), {
		message: "an 'enum' column needs at least one option"
	});

const tableCreate = z.object({
	name: z.string().min(1).max(120),
	columns: z.array(column).default([]),
	section: z
		.string()
		.nullish()
		.refine((v) => v == null || (PILLAR_KEYS as readonly string[]).includes(v), {
			message: `section must be one of ${JSON.stringify(PILLAR_KEYS)} or null`
		})
});

function tableToOut(table: { id: number; companyId: string; name: string; columns: unknown; section: string | null; createdBy: string; createdAt: Date; updatedAt: Date }, rowCount: number) {
	return {
		id: table.id,
		company_id: table.companyId,
		name: table.name,
		columns: table.columns,
		section: table.section,
		created_by: table.createdBy,
		created_at: table.createdAt,
		updated_at: table.updatedAt,
		row_count: rowCount
	};
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = tableCreate.safeParse(body);
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		const table = await createTable(params.id!, parsed.data.name, parsed.data.columns, parsed.data.section ?? null, actor.identity);
		return json(tableToOut(table, 0), { status: 201 });
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireActor(locals.actor);
		const rows = await listTables(params.id!);
		return json(rows.map(({ table, rowCount }) => tableToOut(table, rowCount)));
	} catch (err) {
		return handleAuthError(err);
	}
};
