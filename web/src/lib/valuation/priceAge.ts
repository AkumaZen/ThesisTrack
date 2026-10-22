const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The trading date the stalest stored prices behind a card run to: the oldest of each stock's last
 *  candle date ("2026-10-16T00:00:00+05:30" -> "2026-10-16"), so a card never claims to be fresher
 *  than its most out-of-date constituent. Null when no stock has any candle. */
export function oldestLastDay(dateLists: string[][]): string | null {
	const lasts = dateLists.filter((d) => d.length > 0).map((d) => d[d.length - 1].slice(0, 10));
	return lasts.length > 0 ? lasts.reduce((a, b) => (a < b ? a : b)) : null;
}

/** "16 Oct" from "2026-10-16" (a calendar date, so no time zone shifts it). */
export function formatDataThrough(day: string): string {
	const [, m, d] = day.split('-').map(Number);
	return `${d} ${MONTHS[m - 1]}`;
}

/** "5 Oct, 4:30 pm" - when the stored prices behind a card were last fetched, in the viewer's
 *  own time zone. */
export function formatAsOf(ms: number): string {
	const d = new Date(ms);
	const h = d.getHours();
	const minutes = String(d.getMinutes()).padStart(2, '0');
	return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${minutes} ${h < 12 ? 'am' : 'pm'}`;
}
