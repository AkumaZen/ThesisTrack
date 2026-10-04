// Builds an .xlsx file in the browser from data already on screen and downloads it. exceljs is
// loaded only when someone actually exports, so it costs nothing on normal page loads.

export type CellValue = string | number | null | undefined;

export interface SheetColumn {
	header: string;
	/** Excel number format, e.g. '#,##0.00' or '0.0"%"'. Text columns leave it out. */
	format?: string;
	width?: number;
}

export interface Sheet {
	name: string;
	columns: SheetColumn[];
	rows: CellValue[][];
	/** Optional lines above the table (title, source, date). */
	notes?: string[];
}

export const FORMATS = {
	price: '#,##0.00',
	pct: '+0.0"%";-0.0"%";0.0"%"',
	ratio: '0.00"x"',
	int: '#,##0'
};

/** Excel sheet names: max 31 chars, none of : \ / ? * [ ]. */
function sheetName(name: string): string {
	return name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Sheet';
}

export async function buildWorkbook(sheets: Sheet[]): Promise<ArrayBuffer> {
	const { default: ExcelJS } = await import('exceljs');
	const wb = new ExcelJS.Workbook();
	wb.creator = 'ThesisTrack';
	wb.created = new Date();
	for (const s of sheets) {
		const ws = wb.addWorksheet(sheetName(s.name));
		for (const line of s.notes ?? []) ws.addRow([line]).font = { italic: true };
		if (s.notes?.length) ws.addRow([]);
		const headerRow = ws.addRow(s.columns.map((c) => c.header));
		headerRow.font = { bold: true };
		headerRow.eachCell((cell) => {
			cell.border = { bottom: { style: 'thin' } };
		});
		for (const r of s.rows) ws.addRow(r.map((v) => (v === undefined ? null : v)));
		s.columns.forEach((c, i) => {
			const col = ws.getColumn(i + 1);
			if (c.format) col.numFmt = c.format;
			col.width = c.width ?? Math.min(48, Math.max(10, c.header.length + 2));
		});
		ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
	}
	return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadWorkbook(filename: string, sheets: Sheet[]): Promise<void> {
	const buffer = await buildWorkbook(sheets);
	const blob = new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "2026-10-04" in India time, for file names and the "as of" note. */
export function todayStamp(now = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}
