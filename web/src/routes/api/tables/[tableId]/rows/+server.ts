// Ports POST /api/tables/{table_id}/rows from app/routers/custom_tables.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError } from '$lib/server/http';
import { createRow, ValidationError } from '$lib/server/services/customTables';

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

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const tableId = Number(params.tableId);
		const body = await request.json();
		const parsed = rowIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		let row;
		try {
			row = await createRow(tableId, parsed.data.row_data, actor.identity);
		} catch (err) {
			if (err instanceof ValidationError) return errorResponse(422, err.message);
			throw err;
		}
		if (!row) return errorResponse(404, `table ${tableId} not found`);
		return json(rowToOut(row), { status: 201 });
	} catch (err) {
		return handleAuthError(err);
	}
};
