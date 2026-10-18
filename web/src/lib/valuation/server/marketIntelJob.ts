import { istDay } from '../boardMeetings';
import type { ParsedAnnouncement } from '../announcements';
import type { ParsedAction } from '../corporateActions';
import type { ParsedInsiderTrade, ParsedSast } from '../insiderTrades';
import { claimDueSymbols, markRefreshFailed } from './intelStore';
import {
	pruneFeed,
	saveCorporateActions,
	saveFeedAnnouncements,
	saveInsiderTrades,
	saveSastDisclosures
} from './marketIntelStore';
import {
	fetchActionsBetween,
	fetchAnnouncementsBetween,
	fetchInsiderBetween,
	fetchSastBetween,
	fetchSymbolActions,
	fetchSymbolInsider,
	fetchSymbolSast
} from './nseMarketFeeds';

// Market-wide NSE feeds stored in our own tables. Everything is cut into small units (one calendar
// day of one feed, or the corporate actions window) whose progress lives in symbol_refresh, so a
// run does as many units as its time budget allows and the next run carries on where it stopped.
// A first run therefore fills history over a few minutes; after that each run tops up the last
// two days, and older days are never fetched twice.

const MINUTE_MS = 60_000;
const HOUR_MS = 3600_000;
const DAY_MS = 86_400_000;

/** Today and yesterday are re-read this often: filings arrive late in the evening and overnight. */
export const RECENT_INTERVAL_MS = 10 * MINUTE_MS;
/** A past day is fetched once (the interval is longer than any backfill window). */
const ONCE_MS = 400 * DAY_MS;
export const ACTIONS_INTERVAL_MS = 6 * HOUR_MS;
const PRUNE_INTERVAL_MS = 24 * HOUR_MS;
/** Days of each feed kept filled in; older filings of a company are loaded when its page asks. */
export const BACKFILL_DAYS = { ann: 14, pit: 30, sast: 30 } as const;
/** Past days per feed per run (the rest follow on the next runs). */
const BACKFILL_PER_RUN = 3;
const ACTIONS_LOOKBACK_DAYS = 14;
const ACTIONS_LOOKAHEAD_DAYS = 90;
/** How far back a company's own dividend and insider history is loaded when its page asks. */
export const COMPANY_HISTORY_YEARS = 5;
const COMPANY_INTERVAL_MS = 24 * HOUR_MS;

export interface MarketIntelDeps {
	fetchAnnouncements: (from: string, to: string) => Promise<ParsedAnnouncement[]>;
	fetchInsider: (from: string, to: string) => Promise<ParsedInsiderTrade[]>;
	fetchSast: (from: string, to: string) => Promise<ParsedSast[]>;
	fetchActions: (from: string, to: string) => Promise<ParsedAction[]>;
	fetchSymbolActions: (symbol: string, from: string, to: string) => Promise<ParsedAction[]>;
	fetchSymbolInsider: (symbol: string, from: string, to: string) => Promise<ParsedInsiderTrade[]>;
	fetchSymbolSast: (symbol: string, from: string, to: string) => Promise<ParsedSast[]>;
	prune: (now: Date) => Promise<number>;
	now: () => Date;
}

export const defaultMarketDeps: MarketIntelDeps = {
	fetchAnnouncements: fetchAnnouncementsBetween,
	fetchInsider: fetchInsiderBetween,
	fetchSast: fetchSastBetween,
	fetchActions: fetchActionsBetween,
	fetchSymbolActions,
	fetchSymbolInsider,
	fetchSymbolSast,
	prune: (now) => pruneFeed(now),
	now: () => new Date()
};

export interface MarketSummary {
	newAnnouncements: number;
	newInsiderTrades: number;
	newSast: number;
	newActions: number;
	pruned: number;
	unitsDone: number;
	errors: string[];
}

export const emptyMarketSummary = (): MarketSummary => ({
	newAnnouncements: 0,
	newInsiderTrades: 0,
	newSast: 0,
	newActions: 0,
	pruned: 0,
	unitsDone: 0,
	errors: []
});

export const addDays = (day: string, n: number): string =>
	new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Feed = 'ann' | 'pit' | 'sast';
const FEED_KIND: Record<Feed, string> = { ann: 'feed-ann', pit: 'feed-pit', sast: 'feed-sast' };

/** Days of a feed that are due: the recent two on a short timer, then a few older ones. */
async function dueDays(feed: Feed, today: string, now: Date): Promise<string[]> {
	const kind = FEED_KIND[feed];
	const recent = [today, addDays(today, -1)];
	const past = Array.from({ length: BACKFILL_DAYS[feed] - 2 }, (_, i) => addDays(today, -(i + 2)));
	const a = await claimDueSymbols(kind, recent, now, RECENT_INTERVAL_MS, 2);
	const b = await claimDueSymbols(kind, past, now, ONCE_MS, BACKFILL_PER_RUN);
	return [...a, ...b];
}

/**
 * One top-up of the market-wide feeds, starting no new unit once `budgetMs` is spent. A failing
 * feed is reported in `errors` and retried on a later run; nothing is thrown.
 */
export async function runMarketIntel(overrides: Partial<MarketIntelDeps> = {}, budgetMs = 25_000): Promise<MarketSummary> {
	const deps = { ...defaultMarketDeps, ...overrides };
	const now = deps.now();
	const today = istDay(now);
	const summary = emptyMarketSummary();
	const startedAt = Date.now();
	const hasTime = () => Date.now() - startedAt < budgetMs;

	const feeds: { feed: Feed; run: (day: string) => Promise<number>; count: (n: number) => void }[] = [
		{ feed: 'ann', run: async (d) => saveFeedAnnouncements(await deps.fetchAnnouncements(d, d)), count: (n) => (summary.newAnnouncements += n) },
		{ feed: 'pit', run: async (d) => saveInsiderTrades(await deps.fetchInsider(d, d)), count: (n) => (summary.newInsiderTrades += n) },
		{ feed: 'sast', run: async (d) => saveSastDisclosures(await deps.fetchSast(d, d)), count: (n) => (summary.newSast += n) }
	];
	for (const { feed, run, count } of feeds) {
		for (const day of await dueDays(feed, today, now)) {
			if (!hasTime()) {
				await markRefreshFailed(FEED_KIND[feed], day).catch(() => {}); // not tried: due again on the next run
				continue;
			}
			try {
				count(await run(day));
				summary.unitsDone++;
			} catch (err) {
				await markRefreshFailed(FEED_KIND[feed], day).catch(() => {});
				summary.errors.push(`${feed} ${day}: ${message(err)}`);
			}
		}
	}

	// Corporate actions: one window across the whole market, upcoming ex-dates included.
	if (hasTime() && (await claimDueSymbols('feed-actions', ['*'], now, ACTIONS_INTERVAL_MS, 1)).length) {
		try {
			summary.newActions = await saveCorporateActions(await deps.fetchActions(addDays(today, -ACTIONS_LOOKBACK_DAYS), addDays(today, ACTIONS_LOOKAHEAD_DAYS)));
			summary.unitsDone++;
		} catch (err) {
			await markRefreshFailed('feed-actions', '*').catch(() => {});
			summary.errors.push(`actions: ${message(err)}`);
		}
	}

	if ((await claimDueSymbols('feed-prune', ['*'], now, PRUNE_INTERVAL_MS, 1)).length) {
		summary.pruned = await deps.prune(now).catch((err) => {
			summary.errors.push(`prune: ${message(err)}`);
			return 0;
		});
	}
	return summary;
}

export interface CompanyFilingsResult {
	refreshed: boolean;
	error: string | null;
}

/** Loads one company's own dividend and insider/SAST history from NSE, at most once a day. The
 *  company components ask for this before reading, so the history is there even for names the
 *  market-wide windows never covered. */
export async function refreshCompanyFilings(symbol: string, overrides: Partial<MarketIntelDeps> = {}): Promise<CompanyFilingsResult> {
	const deps = { ...defaultMarketDeps, ...overrides };
	const now = deps.now();
	if (!(await claimDueSymbols('company-filings', [symbol], now, COMPANY_INTERVAL_MS, 1)).length) return { refreshed: false, error: null };
	const today = istDay(now);
	const from = addDays(today, -365 * COMPANY_HISTORY_YEARS);
	const results = await Promise.allSettled([
		deps.fetchSymbolActions(symbol, from, addDays(today, ACTIONS_LOOKAHEAD_DAYS)).then(saveCorporateActions),
		deps.fetchSymbolInsider(symbol, from, today).then(saveInsiderTrades),
		deps.fetchSymbolSast(symbol, from, today).then(saveSastDisclosures)
	]);
	const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
	if (failed) {
		await markRefreshFailed('company-filings', symbol).catch(() => {});
		return { refreshed: false, error: message(failed.reason) };
	}
	return { refreshed: true, error: null };
}
