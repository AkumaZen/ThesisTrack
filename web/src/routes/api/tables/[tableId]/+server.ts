// Ports GET/PATCH/DELETE /api/tables/{table_id} from app/routers/custom_tables.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireActor, requireWriteActor, errorResponse, handleAuthError } from '$lib/server/http';
import { deleteTable, getTable, patchTable } from '$lib/server/services/customTables';
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

const tableUpdate = z.object({
	name: z.string().min(1).max(120).nullish(),
	columns: z.array(column).nullish(),
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

function rowToOut(row: { id: number; tableId: number; rowData: unknown; rowOrder: number; createdBy: string; createdAt: Date; updatedAt: Date }) {
	return {
		id: row.id,
		table_id: row.tableId,
		row_data: row.rowData,
		row_order: row.rowOrder,
		created_by: row.createdBy,
		created_at: row.createdAt,
		updated_at: row.updatedAt
	};
}

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireActor(locals.actor);
		const tableId = Number(params.tableId);
		const result = await getTable(tableId);
		if (!result) return errorResponse(404, `table ${tableId} not found`);
		return json({ ...tableToOut(result.table, result.rows.length), rows: result.rows.map(rowToOut) });
	} catch (err) {
		return handleAuthError(err);
	}
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		requireWriteActor(locals.actor);
		const tableId = Number(params.tableId);
		const body = await request.json();
		const parsed = tableUpdate.safeParse(body);
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		const fieldsSet = new Set(Object.keys(body));
		const result = await patchTable(tableId, parsed.data, fieldsSet);
		if (!result) return errorResponse(404, `table ${tableId} not found`);
		return json(tableToOut(result.table!, result.rowCount));
	} catch (err) {
		return handleAuthError(err);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		requireWriteActor(locals.actor);
		const tableId = Number(params.tableId);
		const ok = await deleteTable(tableId);
		if (!ok) return errorResponse(404, `table ${tableId} not found`);
		return new Response(null, { status: 204 });
	} catch (err) {
		return handleAuthError(err);
	}
};
