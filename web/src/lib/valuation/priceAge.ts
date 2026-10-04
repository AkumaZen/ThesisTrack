const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 Oct, 4:30 pm" - when the stored prices behind a card were last fetched, in the viewer's
 *  own time zone. */
export function formatAsOf(ms: number): string {
	const d = new Date(ms);
	const h = d.getHours();
	const minutes = String(d.getMinutes()).padStart(2, '0');
	return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${minutes} ${h < 12 ? 'am' : 'pm'}`;
}
