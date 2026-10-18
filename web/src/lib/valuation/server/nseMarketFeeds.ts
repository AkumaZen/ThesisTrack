import { parseNseAnnouncements, type ParsedAnnouncement } from '../announcements';
import { parseCorporateActions, type ParsedAction } from '../corporateActions';
import { parseInsiderTrades, parseSastDisclosures, type ParsedInsiderTrade, type ParsedSast } from '../insiderTrades';
import { fetchNseJson } from './nseAnnouncements';

// Market-wide NSE feeds, asked for one calendar window at a time. Without from_date/to_date the
// all-equities endpoints answer with only the latest 20 rows; with a window they return the whole
// window (about 250 announcements a day), so a day per request is both complete and small.

// A full day of announcements is about 200 KB and a month of insider trades 1.5 MB.
const FEED_TIMEOUT_MS = 20_000;

/** NSE expects dates as DD-MM-YYYY, in IST. `day` is already an IST calendar day, YYYY-MM-DD. */
export const nseDate = (day: string): string => `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`;

const window = (from: string, to: string) => `index=equities&from_date=${nseDate(from)}&to_date=${nseDate(to)}`;

export const fetchAnnouncementsBetween = async (from: string, to: string, fetcher: typeof fetch = fetch): Promise<ParsedAnnouncement[]> =>
	parseNseAnnouncements(await fetchNseJson(`corporate-announcements?${window(from, to)}`, fetcher, FEED_TIMEOUT_MS));

export const fetchInsiderBetween = async (from: string, to: string, fetcher: typeof fetch = fetch): Promise<ParsedInsiderTrade[]> =>
	parseInsiderTrades(await fetchNseJson(`corporates-pit?${window(from, to)}`, fetcher, FEED_TIMEOUT_MS));

export const fetchSastBetween = async (from: string, to: string, fetcher: typeof fetch = fetch): Promise<ParsedSast[]> =>
	parseSastDisclosures(await fetchNseJson(`corporate-sast-reg29?${window(from, to)}`, fetcher, FEED_TIMEOUT_MS));

/** Corporate actions with an ex-date in the window, market-wide. */
export const fetchActionsBetween = async (from: string, to: string, fetcher: typeof fetch = fetch): Promise<ParsedAction[]> =>
	parseCorporateActions(await fetchNseJson(`corporates-corporateActions?${window(from, to)}`, fetcher, FEED_TIMEOUT_MS));

/** One company's corporate actions since `from` (the full history, not just the latest 20). */
export const fetchSymbolActions = async (symbol: string, from: string, to: string, fetcher: typeof fetch = fetch): Promise<ParsedAction[]> =>
	parseCorporateActions(await fetchNseJson(`corporates-corporateActions?${window(from, to)}&symbol=${encodeURIComponent(symbol)}`, fetcher, FEED_TIMEOUT_MS));

/** One company's insider trades and SAST filings in a window (a company page loads these on demand). */
export const fetchSymbolInsider = async (symbol: string, from: string, to: string, fetcher: typeof fetch = fetch): Promise<ParsedInsiderTrade[]> =>
	parseInsiderTrades(await fetchNseJson(`corporates-pit?${window(from, to)}&symbol=${encodeURIComponent(symbol)}`, fetcher, FEED_TIMEOUT_MS));

export const fetchSymbolSast = async (symbol: string, from: string, to: string, fetcher: typeof fetch = fetch): Promise<ParsedSast[]> =>
	parseSastDisclosures(await fetchNseJson(`corporate-sast-reg29?${window(from, to)}&symbol=${encodeURIComponent(symbol)}`, fetcher, FEED_TIMEOUT_MS));
