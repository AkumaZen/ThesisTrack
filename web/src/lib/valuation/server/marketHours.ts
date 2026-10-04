// NSE/BSE cash market hours: 09:15–15:30 IST, Monday–Friday. This intentionally does NOT
// account for exchange holidays (a fixed IST calendar that changes yearly and isn't worth
// hardcoding here) — a holiday will read as "open" and the live call will simply return
// whatever Angel One gives it (typically the prior close), which is a harmless false negative,
// not a wasted-call problem. What this DOES correctly avoid is calls on weekends and
// outside trading hours, the overwhelming majority of "market is obviously closed" time.
//
// Uses Intl's IANA timezone conversion rather than a manual UTC+5:30 offset — India has no DST,
// so the arithmetic would happen to work, but going through Intl keeps this correct without
// relying on that coincidence and reads as intentional rather than a magic-number offset.
export function isMarketOpenIST(now: Date = new Date()): boolean {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Kolkata',
		weekday: 'short',
		hour: 'numeric',
		minute: 'numeric',
		hourCycle: 'h23'
	}).formatToParts(now);

	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	const weekday = get('weekday');
	const hour = Number(get('hour'));
	const minute = Number(get('minute'));

	if (weekday === 'Sat' || weekday === 'Sun') return false;

	const minutesSinceMidnight = hour * 60 + minute;
	const openAt = 9 * 60 + 15;
	const closeAt = 15 * 60 + 30;
	return minutesSinceMidnight >= openAt && minutesSinceMidnight < closeAt;
}
