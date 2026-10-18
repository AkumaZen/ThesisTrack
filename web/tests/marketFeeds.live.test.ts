// Opt-in smoke test against the real NSE endpoints: LIVE_NSE=1 npx vitest run tests/marketFeeds.live.test.ts
// It never writes to the database; it only checks that each feed still answers and still parses.
import { describe, expect, it } from 'vitest';
import {
	fetchActionsBetween,
	fetchAnnouncementsBetween,
	fetchInsiderBetween,
	fetchSastBetween,
	fetchSymbolActions
} from '../src/lib/valuation/server/nseMarketFeeds';
import { istDay } from '../src/lib/valuation/boardMeetings';
import { addDays } from '../src/lib/valuation/server/marketIntelJob';

const today = istDay(new Date());

describe.skipIf(!process.env.LIVE_NSE)('NSE market-wide feeds (live)', () => {
	it('returns more than 20 announcements for a two-day window', async () => {
		const rows = await fetchAnnouncementsBetween(addDays(today, -3), addDays(today, -2));
		console.log('announcements, 2 days:', rows.length);
		expect(rows.length).toBeGreaterThan(20);
		expect(rows[0].nseSymbol).toMatch(/^[A-Z0-9&-]+$/);
	}, 40_000);

	it('reads insider trades for a month that has them (NSE may hold nothing for recent weeks)', async () => {
		const rows = await fetchInsiderBetween('2026-03-02', '2026-03-06');
		console.log('insider trades, 5 days of March 2026:', rows.length);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0].personName).not.toBe('');
		const recent = await fetchInsiderBetween(addDays(today, -7), today);
		console.log('insider trades, last 7 days:', recent.length);
	}, 40_000);

	it('reads SAST disclosures', async () => {
		const rows = await fetchSastBetween(addDays(today, -30), today);
		console.log('SAST, 30 days:', rows.length);
		expect(rows.length).toBeGreaterThan(0);
	}, 40_000);

	it('reads corporate actions, market-wide and for one company', async () => {
		const market = await fetchActionsBetween(addDays(today, -60), addDays(today, 60));
		console.log('corporate actions, +-60 days:', market.length);
		expect(market.length).toBeGreaterThan(0);
		const itc = await fetchSymbolActions('ITC', addDays(today, -365 * 3), today);
		console.log('ITC actions, 3 years:', itc.length, 'dividends:', itc.filter((a) => a.kind === 'dividend').length);
		expect(itc.some((a) => a.kind === 'dividend')).toBe(true);
	}, 40_000);
});
