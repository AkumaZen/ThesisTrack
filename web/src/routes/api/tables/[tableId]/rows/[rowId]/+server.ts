// Ports PUT/DELETE /api/tables/{table_id}/rows/{row_id} from app/routers/custom_tables.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError } from '$lib/server/http';
import { deleteRow, updateRow, ValidationError } from '$lib/server/services/customTables';

const rowIn = z.object({ row_data: z.record(z.string(), z.unknown()).default({}) });

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

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		requireWriteActor(locals.actor);
		const tableId = Number(params.tableId);
		const rowId = Number(params.rowId);
		const body = await request.json();
		const parsed = rowIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		const { table, row } = await (async () => {
			try {
				return await updateRow(tableId, rowId, parsed.data.row_data);
			} catch (err) {
				if (err instanceof ValidationError) throw err;
				throw err;
			}
		})();
		if (!table) return errorResponse(404, `table ${tableId} not found`);
		if (!row) return errorResponse(404, `row ${rowId} not found on table ${tableId}`);
		return json(rowToOut(row));
	} catch (err) {
		if (err instanceof ValidationError) return errorResponse(422, err.message);
		return handleAuthError(err);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		requireWriteActor(locals.actor);
		const tableId = Number(params.tableId);
		const rowId = Number(params.rowId);
		const ok = await deleteRow(tableId, rowId);
		if (!ok) return errorResponse(404, `row ${rowId} not found on table ${tableId}`);
		return new Response(null, { status: 204 });
	} catch (err) {
		return handleAuthError(err);
	}
};
