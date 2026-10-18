import { describe, expect, it } from 'vitest';
import {
	buildPushPayload,
	dedupeKeyFor,
	parseNseAnnouncements,
	parseNseTime,
	readyToNotify,
	shouldNotify
} from './announcements';
import { fetchSymbolAnnouncements } from './server/nseAnnouncements';

// Shaped like a real row from nseindia.com/api/corporate-announcements (HFCL, 2026-10-17).
const ROW = {
	an_dt: '17-Oct-2026 11:17:01',
	attchmntFile: 'https://nsearchives.nseindia.com/corporate/AHMED_17102026111539_HFCL_STX_ESG_Letter_17102026.pdf',
	attchmntText: 'HFCL Limited has informed the Exchange about Intimation of ESG rating',
	desc: 'General Updates',
	seq_id: '106820958',
	sm_name: 'HFCL Limited',
	sort_date: '2026-10-17 11:17:01',
	symbol: 'HFCL'
};

describe('parseNseTime', () => {
	it('reads NSE times as IST', () => {
		expect(parseNseTime('17-Oct-2026 11:17:01')?.toISOString()).toBe('2026-10-17T05:47:01.000Z');
		expect(parseNseTime('09-Mar-2011')?.toISOString()).toBe('2011-03-08T18:30:00.000Z');
	});
	it('rejects anything else', () => {
		expect(parseNseTime('2026-10-17')).toBeNull();
		expect(parseNseTime('17-Foo-2026 11:17:01')).toBeNull();
		expect(parseNseTime(undefined)).toBeNull();
	});
});

describe('parseNseAnnouncements', () => {
	it('maps a row to an announcement', () => {
		const [a] = parseNseAnnouncements([ROW]);
		expect(a).toMatchObject({
			dedupeKey: 'nse:106820958',
			nseSymbol: 'HFCL',
			companyName: 'HFCL Limited',
			subject: 'General Updates',
			pdfUrl: ROW.attchmntFile
		});
		expect(a.details).toContain('ESG rating');
		expect(a.announcedAt.toISOString()).toBe('2026-10-17T05:47:01.000Z');
	});
	it('drops rows it cannot use and tolerates a non-array payload', () => {
		expect(parseNseAnnouncements({ error: 'x' })).toEqual([]);
		const rows = parseNseAnnouncements([null, 'x', { ...ROW, symbol: '' }, { ...ROW, an_dt: 'bad', exchdisstime: '' }, ROW]);
		expect(rows).toHaveLength(1);
	});
	it('falls back to the text when there is no subject and ignores a non-URL attachment', () => {
		const [a] = parseNseAnnouncements([{ ...ROW, desc: '', attchmntFile: '-' }]);
		expect(a.subject).toContain('HFCL Limited has informed');
		expect(a.pdfUrl).toBeNull();
	});
});

describe('dedupeKeyFor', () => {
	it('uses the sequence id when NSE gives one, otherwise a stable hash', () => {
		expect(dedupeKeyFor('HFCL', 'x', 'y', '55')).toBe('nse:55');
		const hash = dedupeKeyFor('HFCL', '17-Oct-2026 11:17:01', 'https://x/a.pdf', '');
		expect(hash).toMatch(/^h:[0-9a-f]{24}$/);
		expect(dedupeKeyFor('HFCL', '17-Oct-2026 11:17:01', 'https://x/a.pdf', '')).toBe(hash);
		expect(dedupeKeyFor('HFCL', '17-Oct-2026 11:17:02', 'https://x/a.pdf', '')).not.toBe(hash);
	});
});

describe('shouldNotify (new since tracking)', () => {
	const now = new Date('2026-10-18T10:00:00Z');
	it('never pushes what was announced before the person started tracking', () => {
		const tracked = new Date('2026-10-18T09:00:00Z');
		expect(shouldNotify(new Date('2026-10-18T08:59:59Z'), tracked, now)).toBe(false);
		expect(shouldNotify(new Date('2026-10-18T09:00:01Z'), tracked, now)).toBe(true);
	});
	it('drops anything older than a day, even if tracked earlier', () => {
		const tracked = new Date('2026-10-01T00:00:00Z');
		expect(shouldNotify(new Date('2026-10-17T09:00:00Z'), tracked, now)).toBe(false);
		expect(shouldNotify(new Date('2026-10-17T11:00:00Z'), tracked, now)).toBe(true);
	});
});

describe('readyToNotify', () => {
	it('waits for the summary, but not forever, and not at all when summaries are off', () => {
		expect(readyToNotify({ summary: null, summaryAttempts: 0 }, true)).toBe(false);
		expect(readyToNotify({ summary: 'ok', summaryAttempts: 1 }, true)).toBe(true);
		expect(readyToNotify({ summary: null, summaryAttempts: 3 }, true)).toBe(true);
		expect(readyToNotify({ summary: null, summaryAttempts: 0 }, false)).toBe(true);
	});
});

describe('buildPushPayload', () => {
	it('puts the symbol and subject in the title and the summary in the body', () => {
		const p = buildPushPayload({ id: 7, nseSymbol: 'HFCL', subject: 'Board Meeting', summary: 'Results due.', pdfUrl: null });
		expect(p).toEqual({
			title: 'HFCL: Board Meeting',
			body: 'Results due.',
			url: '/valuation/tracking?symbol=HFCL',
			tag: 'announcement-7'
		});
	});
	it('falls back to the raw subject and clips long text', () => {
		const p = buildPushPayload({ id: 1, nseSymbol: 'X', subject: 'S'.repeat(500), summary: null, pdfUrl: null });
		expect(p.body.length).toBeLessThanOrEqual(280);
		expect(p.title.length).toBeLessThanOrEqual(100);
	});
});

describe('fetchSymbolAnnouncements', () => {
	it('asks NSE for one symbol in a date window and parses the rows', async () => {
		let url = '';
		const fake = (async (u: string) => {
			url = u;
			return new Response(JSON.stringify([ROW]), { status: 200 });
		}) as unknown as typeof fetch;
		const rows = await fetchSymbolAnnouncements('HFCL', 3, fake, new Date('2026-10-18T10:00:00Z'));
		expect(rows).toHaveLength(1);
		expect(url).toContain('symbol=HFCL');
		expect(url).toContain('from_date=15-10-2026');
		expect(url).toContain('to_date=18-10-2026');
	});
	it('throws on an HTTP error', async () => {
		const fake = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch;
		await expect(fetchSymbolAnnouncements('HFCL', 3, fake)).rejects.toThrow('HTTP 403');
	});
});
