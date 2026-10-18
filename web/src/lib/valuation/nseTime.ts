const MONTHS: Record<string, string> = {
	jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
	jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

/** NSE writes times in IST as "17-Oct-2026 11:17:01" (sometimes date only). */
export function parseNseTime(raw: unknown): Date | null {
	if (typeof raw !== 'string') return null;
	const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw.trim());
	const month = m ? MONTHS[m[2].toLowerCase()] : undefined;
	if (!m || !month) return null;
	const iso = `${m[3]}-${month}-${m[1].padStart(2, '0')}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+05:30`;
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date;
}
