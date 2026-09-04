// Ports app/routers/custom_tables.py's row-validation + CRUD.
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { companies, customTableRows, customTables } from '../db/schema';
import { NotFoundError } from './scenarios';

export class ValidationError extends Error {}

export interface ColumnDef {
	key: string;
	label: string;
	type: 'text' | 'number' | 'date' | 'enum';
	options?: string[] | null;
}

export function validateRowData(columns: ColumnDef[], rowData: Record<string, unknown>): Record<string, unknown> {
	const byKey = new Map(columns.map((c) => [c.key, c]));
	const unknown = Object.keys(rowData).filter((k) => !byKey.has(k));
	if (unknown.length) throw new ValidationError(`unknown column key(s): ${JSON.stringify(unknown.sort())}`);

	const cleaned: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(rowData)) {
		if (value === null || value === undefined || value === '') continue;
		const col = byKey.get(key)!;
		if (col.type === 'number') {
			const n = typeof value === 'number' ? value : Number(value);
			if (Number.isNaN(n)) throw new ValidationError(`column '${key}' expects a number, got ${JSON.stringify(value)}`);
			cleaned[key] = n;
		} else if (col.type === 'date') {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(new Date(String(value)).getTime())) {
				throw new ValidationError(`column '${key}' expects an ISO date (YYYY-MM-DD), got ${JSON.stringify(value)}`);
			}
			cleaned[key] = String(value);
		} else if (col.type === 'enum') {
			const options = col.options ?? [];
			if (!options.includes(value as string)) {
				throw new ValidationError(`column '${key}' expects one of ${JSON.stringify(options)}, got ${JSON.stringify(value)}`);
			}
			cleaned[key] = value;
		} else {
			cleaned[key] = String(value);
		}
	}
	return cleaned;
}

export async function createTable(companyId: string, name: string, columns: ColumnDef[], section: string | null, actorIdentity: string) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const [table] = await db
		.insert(customTables)
		.values({ companyId, name, columns, section, createdBy: actorIdentity })
		.returning();
	return table;
}

export async function listTables(companyId: string) {
	const tables = await db.select().from(customTables).where(eq(customTables.companyId, companyId)).orderBy(asc(customTables.createdAt));
	const result = [];
	for (const table of tables) {
		const rows = await db.select().from(customTableRows).where(eq(customTableRows.tableId, table.id));
		result.push({ table, rowCount: rows.length });
	}
	return result;
}

export async function getTable(tableId: number) {
	const [table] = await db.select().from(customTables).where(eq(customTables.id, tableId)).limit(1);
	if (!table) return null;
	const rows = await db
		.select()
		.from(customTableRows)
		.where(eq(customTableRows.tableId, tableId))
		.orderBy(asc(customTableRows.rowOrder));
	return { table, rows };
}

export async function patchTable(
	tableId: number,
	fields: { name?: string | null; columns?: ColumnDef[] | null; section?: string | null },
	fieldsSet: Set<string>
) {
	const [table] = await db.select().from(customTables).where(eq(customTables.id, tableId)).limit(1);
	if (!table) return null;

	const update: Record<string, unknown> = {};
	if (fieldsSet.has('name') && fields.name != null) update.name = fields.name;
	if (fieldsSet.has('columns') && fields.columns != null) update.columns = fields.columns;
	if (fieldsSet.has('section')) update.section = fields.section ?? null;

	if (Object.keys(update).length) {
		await db.update(customTables).set(update).where(eq(customTables.id, tableId));
	}
	const [updated] = await db.select().from(customTables).where(eq(customTables.id, tableId)).limit(1);
	const rows = await db.select().from(customTableRows).where(eq(customTableRows.tableId, tableId));
	return { table: updated, rowCount: rows.length };
}

export async function deleteTable(tableId: number) {
	const [table] = await db.select().from(customTables).where(eq(customTables.id, tableId)).limit(1);
	if (!table) return false;
	await db.delete(customTables).where(eq(customTables.id, tableId));
	return true;
}

export async function createRow(tableId: number, rowData: Record<string, unknown>, actorIdentity: string) {
	const [table] = await db.select().from(customTables).where(eq(customTables.id, tableId)).limit(1);
	if (!table) return null;

	const cleaned = validateRowData(table.columns as ColumnDef[], rowData);

	const [maxRow] = await db
		.select()
		.from(customTableRows)
		.where(eq(customTableRows.tableId, tableId))
		.orderBy(desc(customTableRows.rowOrder))
		.limit(1);
	const nextOrder = maxRow ? maxRow.rowOrder + 1 : 0;

	const [row] = await db
		.insert(customTableRows)
		.values({ tableId, rowData: cleaned, rowOrder: nextOrder, createdBy: actorIdentity })
		.returning();
	return row;
}

export async function updateRow(tableId: number, rowId: number, rowData: Record<string, unknown>) {
	const [table] = await db.select().from(customTables).where(eq(customTables.id, tableId)).limit(1);
	if (!table) return { table: null, row: null };
	const [row] = await db.select().from(customTableRows).where(eq(customTableRows.id, rowId)).limit(1);
	if (!row || row.tableId !== tableId) return { table, row: null };

	const cleaned = validateRowData(table.columns as ColumnDef[], rowData);
	await db.update(customTableRows).set({ rowData: cleaned }).where(eq(customTableRows.id, rowId));
	const [updated] = await db.select().from(customTableRows).where(eq(customTableRows.id, rowId)).limit(1);
	return { table, row: updated };
}

export async function deleteRow(tableId: number, rowId: number) {
	const [row] = await db.select().from(customTableRows).where(eq(customTableRows.id, rowId)).limit(1);
	if (!row || row.tableId !== tableId) return false;
	await db.delete(customTableRows).where(eq(customTableRows.id, rowId));
	return true;
}
