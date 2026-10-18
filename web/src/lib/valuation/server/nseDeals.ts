import { parseLargeDeals, type ParsedDeal } from '../deals';
import { fetchNseJson } from './nseAnnouncements';

/** The latest trading day's bulk and block deals for the whole market (one small request). The
 *  per-symbol historical endpoints answered 503 to server requests, so this snapshot is polled
 *  every few hours and each deal is stored once. */
export async function fetchLatestDeals(fetcher: typeof fetch = fetch): Promise<ParsedDeal[]> {
	return parseLargeDeals(await fetchNseJson('snapshot-capital-market-largedeal', fetcher));
}
