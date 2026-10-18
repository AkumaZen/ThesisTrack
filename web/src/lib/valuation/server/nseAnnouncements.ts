import { parseNseAnnouncements, type ParsedAnnouncement } from '../announcements';

// Same browser-like headers the Python concall downloader uses against NSE
// (services/concall/concall_downloader/sources/nse.py). NSE answers these without cookies from Vercel.
const NSE_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/118.0',
	Accept: '*/*',
	'Accept-Language': 'en-US,en;q=0.5',
	Referer: 'https://www.nseindia.com/get-quotes/equity?symbol=HDFCBANK'
};
const TIMEOUT_MS = 8000;
const DAY_MS = 86_400_000;

const ddmmyyyy = (d: Date) => {
	// NSE expects dates in IST.
	const ist = new Date(d.getTime() + 5.5 * 3600_000);
	return `${String(ist.getUTCDate()).padStart(2, '0')}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${ist.getUTCFullYear()}`;
};

/** Announcements one company made in the last `days` days (newest first as NSE returns them).
 *  A date window keeps the answer small: without one NSE returns the whole history (about 1 MB). */
export async function fetchSymbolAnnouncements(
	symbol: string,
	days: number,
	fetcher: typeof fetch = fetch,
	now: Date = new Date()
): Promise<ParsedAnnouncement[]> {
	const params = new URLSearchParams({
		index: 'equities',
		symbol,
		from_date: ddmmyyyy(new Date(now.getTime() - days * DAY_MS)),
		to_date: ddmmyyyy(now)
	});
	const res = await fetcher(`https://www.nseindia.com/api/corporate-announcements?${params}`, {
		headers: NSE_HEADERS,
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`NSE announcements for ${symbol} failed (HTTP ${res.status})`);
	return parseNseAnnouncements(await res.json());
}
