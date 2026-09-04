// Ports the row-validation edge cases app/routers/custom_tables.py's
// _validate_row_data covers (no dedicated Python test file for it, but the
// behavior is exercised implicitly wherever custom tables are used).
import { describe, expect, it } from 'vitest';
import { validateRowData, ValidationError, type ColumnDef } from '../src/lib/server/services/customTables';

const columns: ColumnDef[] = [
	{ key: 'name', label: 'Name', type: 'text' },
	{ key: 'amount', label: 'Amount', type: 'number' },
	{ key: 'seen_on', label: 'Seen on', type: 'date' },
	{ key: 'tier', label: 'Tier', type: 'enum', options: ['A', 'B', 'C'] }
];

describe('validateRowData', () => {
	it('coerces a well-formed row across all column types', () => {
		const cleaned = validateRowData(columns, {
			name: 'Widget',
			amount: '42.5',
			seen_on: '2026-01-15',
			tier: 'B'
		});
		expect(cleaned).toEqual({ name: 'Widget', amount: 42.5, seen_on: '2026-01-15', tier: 'B' });
	});

	it('skips blank cells (missing, null, empty string) instead of rejecting them', () => {
		const cleaned = validateRowData(columns, { name: '', amount: null as unknown as number, seen_on: undefined as unknown as string });
		expect(cleaned).toEqual({});
	});

	it('rejects an unknown column key', () => {
		expect(() => validateRowData(columns, { bogus: 1 })).toThrow(ValidationError);
		expect(() => validateRowData(columns, { bogus: 1 })).toThrow(/unknown column key/);
	});

	it('rejects a non-numeric value for a number column', () => {
		expect(() => validateRowData(columns, { amount: 'not-a-number' })).toThrow(/expects a number/);
	});

	it('rejects a malformed date for a date column', () => {
		expect(() => validateRowData(columns, { seen_on: 'not-a-date' })).toThrow(/expects an ISO date/);
	});

	it('rejects a value outside the enum options', () => {
		expect(() => validateRowData(columns, { tier: 'Z' })).toThrow(/expects one of/);
	});
});
