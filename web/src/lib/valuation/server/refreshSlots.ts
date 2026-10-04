// When prices are refreshed on their own: four times on each weekday, in India time. Nothing
// else refreshes them in the background - the rest is someone pressing Refresh.
//
//   09:30  before the market settles     12:30  midday
//   15:30  near the close                16:30  after the close (the day's bar is complete)
//
// vercel.json runs the same four moments as UTC crons (04:00, 07:00, 10:00 and 11:00).
export const REFRESH_SLOTS_IST = ['09:30', '12:30', '15:30', '16:30'] as const;

/** The refresh slot that is due at `now` (within the hour after it begins), as "YYYY-MM-DDTHH:MM"
 *  in India time, or null when none is - weekends, and any other time of day. */
export function dueRefreshSlot(now: Date = new Date()): string | null {
	const ist = new Date(now.getTime() + (5 * 60 + 30) * 60_000);
	const day = ist.getUTCDay();
	if (day === 0 || day === 6) return null;
	const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
	for (const slot of [...REFRESH_SLOTS_IST].reverse()) {
		const [h, m] = slot.split(':').map(Number);
		const since = minutes - (h * 60 + m);
		if (since >= 0 && since < 60) return `${ist.toISOString().slice(0, 10)}T${slot}`;
	}
	return null;
}
