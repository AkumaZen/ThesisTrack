import { describe, expect, it } from 'vitest';
import samples from '../../../../tests/fixtures/nse-market-samples.json';
import { fetchActionsBetween, fetchAnnouncementsBetween, fetchInsiderBetween, fetchSastBetween, fetchSymbolActions, nseDate } from './nseMarketFeeds';

// Rows copied from NSE's own answers (trimmed), served through a fake fetch.
function serve(payload: unknown) {
	const urls: string[] = [];
	const fetcher = (async (url: string) => {
		urls.push(url);
		return new Response(JSON.stringify(payload), { status: 200 });
	}) as unknown as typeof fetch;
	return { urls, fetcher };
}

describe('NSE market-wide feeds', () => {
	it('writes dates the way NSE wants them', () => {
		expect(nseDate('2026-10-05')).toBe('05-10-2026');
	});

	it('asks for the announcements of a window and reads them', async () => {
		const { urls, fetcher } = serve(samples.announcements);
		const rows = await fetchAnnouncementsBetween('2026-10-17', '2026-10-18', fetcher);
		expect(urls[0]).toContain('corporate-announcements?index=equities&from_date=17-10-2026&to_date=18-10-2026');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ nseSymbol: 'TRENT', subject: 'Resignation', dedupeKey: 'nse:106821444' });
	});

	it('reads an insider trade (a sale by a person in the "Other" category)', async () => {
		const { urls, fetcher } = serve(samples.pit);
		const [t] = await fetchInsiderBetween('2026-02-18', '2026-02-18', fetcher);
		expect(urls[0]).toContain('corporates-pit?index=equities&from_date=18-02-2026&to_date=18-02-2026');
		expect(t).toMatchObject({ nseSymbol: 'RELIANCE', personName: 'BALANADU NARAYAN', txnType: 'Sell', quantity: 2320, value: 3294168, beforeShares: 3920, afterShares: 1600, fromDate: '2026-02-13' });
		expect(t.broadcastAt.toISOString()).toBe('2026-02-18T13:36:00.000Z'); // 19:06 IST
	});

	it('reads a promoter SAST acquisition', async () => {
		const { fetcher } = serve(samples.sast);
		const [s] = await fetchSastBetween('2026-10-16', '2026-10-16', fetcher);
		expect(s).toMatchObject({ nseSymbol: 'SSWL', acquirerName: 'SUNENA GARG', action: 'Acquisition', isPromoter: true, sharesAcquired: 100005, sharesAfter: 5764179, pctAcquired: 0.06, pctAfter: 3.66 });
		expect(s.sharesSold).toBeNull();
	});

	it('reads corporate actions, market-wide and for one company', async () => {
		const { urls, fetcher } = serve(samples.actions);
		const [a] = await fetchActionsBetween('2026-10-18', '2026-11-18', fetcher);
		expect(a).toMatchObject({ nseSymbol: 'ICICIAMC', kind: 'dividend', amount: 30, exDate: '2026-10-21', recordDate: '2026-10-21' });
		await fetchSymbolActions('ITC', '2023-01-01', '2026-10-18', fetcher);
		expect(urls[1]).toContain('symbol=ITC');
		expect(urls[1]).toContain('from_date=01-01-2023');
	});

	it('fails with the HTTP status when NSE refuses', async () => {
		const fetcher = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
		await expect(fetchSastBetween('2026-10-16', '2026-10-16', fetcher)).rejects.toThrow('HTTP 403');
	});
});
