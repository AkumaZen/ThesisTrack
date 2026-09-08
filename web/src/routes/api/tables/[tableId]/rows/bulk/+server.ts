// POST /api/tables/{table_id}/rows/bulk - CSV import and paste-from-
// clipboard both funnel through here instead of one createRow call per row.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { createRowsBulk, ValidationError } from '$lib/server/services/customTables';

const bulkIn = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000) });

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
		const parsed = bulkIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		let rows;
		try {
			rows = await createRowsBulk(tableId, parsed.data.rows, actor.identity);
		} catch (err) {
			if (err instanceof ValidationError) return errorResponse(422, err.message);
			throw err;
		}
		if (!rows) return errorResponse(404, `table ${tableId} not found`);
		return json(rows.map(rowToOut), { status: 201 });
	} catch (err) {
		return handleAuthError(err);
	}
};
