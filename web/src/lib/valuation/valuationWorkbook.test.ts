import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbook } from './exportXlsx';
import { valuationSheets } from './valuationWorkbook';
import { freshAllAssumptions, project } from './valuationEngine';

const input = {
	name: 'Example Ltd',
	symbol: 'EXAMPLE',
	cmp: 100,
	shares: 10,
	baseSales: 1000,
	baseBookValuePerShare: 50,
	assumptions: freshAllAssumptions(),
	activeMethod: 'pe' as const,
	fairValuePct: 75,
	exportedBy: 'analyst',
	exportedAt: new Date('2026-10-04T10:00:00+05:30')
};

describe('valuation workbook', () => {
	it('summarises every method and scenario, with prices matching the engine', () => {
		const [summary, detail] = valuationSheets(input);
		expect(summary.rows).toHaveLength(12); // 4 methods x 3 scenarios
		expect(detail.rows).toHaveLength(36); // x 3 years

		const base = project('pe', 1000, 50, 10, input.assumptions.pe.base);
		const peBase = summary.rows.find((r) => r[0] === 'P/E (in use)' && r[1] === 'Base')!;
		expect(peBase[3]).toBeCloseTo(base[1].impliedPrice, 6);
		expect(peBase[7]).toBeCloseTo(base[1].impliedPrice * 0.75, 6); // the team's fair value %
		expect(summary.rows.filter((r) => r[7] != null)).toHaveLength(4); // base rows only
	});

	it('writes a real .xlsx that reads back with the same numbers and formats', async () => {
		const buffer = await buildWorkbook(valuationSheets(input));
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(buffer);
		expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Projections']);
		const ws = wb.getWorksheet('Summary')!;
		// 3 note lines, a blank line, then the header.
		expect(ws.getRow(5).getCell(1).value).toBe('Method');
		const first = ws.getRow(6);
		expect(first.getCell(1).value).toBe('P/E (in use)');
		expect(first.getCell(2).value).toBe('Bear');
		expect(typeof first.getCell(4).value).toBe('number');
		expect(ws.getColumn(4).numFmt).toBe('#,##0.00');
	});
});
