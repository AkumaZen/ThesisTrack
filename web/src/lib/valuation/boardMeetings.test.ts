import { describe, expect, it } from 'vitest';
import {
	endOfWeek,
	findDates,
	formatMeetingDay,
	groupMeetings,
	isDue,
	istDay,
	meetingKey,
	parseMeetingDate,
	parseNseBoardMeetings
} from './boardMeetings';

// Shaped like real rows from nseindia.com/api/corporate-board-meetings (HFCL, 2026-10-14).
const INTIMATION = {
	bm_symbol: 'HFCL',
	bm_date: '19-Oct-2026',
	bm_purpose: 'Board Meeting Intimation',
	bm_desc: 'HFCL LIMITED has informed the Exchange about Board Meeting to be held on 19-Oct-2026 to inter-alia consider and approve the Unaudited Financial results of the Company for the Quarterly ended September 2026 .',
	sm_name: 'HFCL Limited'
};
const AGENDA = { ...INTIMATION, bm_purpose: 'Financial Results', bm_desc: 'To consider and approve the financial results for the period ended September 30, 2026' };
const OLD = { ...AGENDA, bm_date: '10-Aug-2026' };

describe('parseNseBoardMeetings', () => {
	it('merges the intimation and the agenda row of one meeting and drops past meetings', () => {
		const out = parseNseBoardMeetings([INTIMATION, AGENDA, OLD], '2026-10-18');
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			nseSymbol: 'HFCL',
			meetingDate: '2026-10-19',
			isResults: true,
			purpose: 'Financial results',
			source: 'nse',
			dedupeKey: 'HFCL|2026-10-19|results'
		});
	});
	it('keeps non-results meetings apart, with their own purpose', () => {
		const out = parseNseBoardMeetings(
			[{ ...INTIMATION, bm_desc: 'Board meeting to consider fund raising' }, { ...AGENDA, bm_purpose: 'Fund Raising', bm_desc: 'To consider fund raising by way of QIP' }],
			'2026-10-18'
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ isResults: false, purpose: 'Fund Raising' });
	});
	it('tolerates junk', () => {
		expect(parseNseBoardMeetings(null, '2026-10-18')).toEqual([]);
		expect(parseNseBoardMeetings([null, 5, { bm_symbol: '', bm_date: 'x' }], '2026-10-18')).toEqual([]);
	});
});

describe('findDates / parseMeetingDate', () => {
	it('reads the formats exchanges use', () => {
		expect(findDates('to be held on 19-Oct-2026')).toEqual(['2026-10-19']);
		expect(findDates('on Monday, October 19, 2026 at 3 PM')).toEqual(['2026-10-19']);
		expect(findDates('on 19th October, 2026')).toEqual(['2026-10-19']);
		expect(findDates('on 3 Nov 2026')).toEqual(['2026-11-03']);
		expect(findDates('on 05/11/2026')).toEqual(['2026-11-05']);
		expect(findDates('on 05.11.2026')).toEqual(['2026-11-05']);
		expect(findDates('on 31 Feb 2026 and 12 Sept 2026')).toEqual(['2026-09-12']);
	});
	it('picks the first date on or after the day it was announced', () => {
		const announced = new Date('2026-10-14T07:30:00Z');
		expect(parseMeetingDate('letter dated 10-Oct-2026: board meeting on 19-Oct-2026 and results on 20-Oct-2026', announced)).toBe('2026-10-19');
		expect(parseMeetingDate('No date here', announced)).toBeNull();
		expect(parseMeetingDate('held on 19-Oct-2031', announced)).toBeNull();
	});
	it('uses the IST day of the announcement', () => {
		// 19:00 UTC on the 18th is 00:30 IST on the 19th.
		expect(parseMeetingDate('on 18-Oct-2026', new Date('2026-10-18T19:00:00Z'))).toBeNull();
		expect(parseMeetingDate('on 19-Oct-2026', new Date('2026-10-18T19:00:00Z'))).toBe('2026-10-19');
	});
});

describe('calendar grouping', () => {
	const NOW = new Date('2026-10-18T04:00:00Z'); // Sunday 18 Oct 2026, 09:30 IST
	it('works out IST days and week ends', () => {
		expect(istDay(new Date('2026-10-18T19:00:00Z'))).toBe('2026-10-19');
		expect(endOfWeek('2026-10-18')).toBe('2026-10-18'); // Sunday ends its own week
		expect(endOfWeek('2026-10-19')).toBe('2026-10-25');
		expect(endOfWeek('2026-10-22')).toBe('2026-10-25');
	});
	it('splits this week from later and drops the past', () => {
		const m = (meetingDate: string) => ({ meetingDate });
		const out = groupMeetings([m('2026-11-02'), m('2026-10-17'), m('2026-10-18'), m('2026-10-20')], NOW);
		expect(out.thisWeek.map((x) => x.meetingDate)).toEqual(['2026-10-18']);
		expect(out.later.map((x) => x.meetingDate)).toEqual(['2026-10-20', '2026-11-02']);
	});
	it('formats a plain calendar day', () => {
		expect(formatMeetingDay('2026-10-19')).toBe('Mon, 19 Oct 2026');
		expect(meetingKey('HFCL', '2026-10-19', false)).toBe('HFCL|2026-10-19|other');
	});
});

describe('isDue (refresh throttle)', () => {
	const NOW = new Date('2026-10-18T12:00:00Z');
	const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
	const SIX_H = 6 * 3600_000;
	it('is due when never refreshed', () => expect(isDue(undefined, NOW, SIX_H)).toBe(true));
	it('waits out the interval after a good refresh', () => {
		expect(isDue({ refreshedAt: ago(359), ok: true }, NOW, SIX_H)).toBe(false);
		expect(isDue({ refreshedAt: ago(360), ok: true }, NOW, SIX_H)).toBe(true);
	});
	it('retries a failed refresh sooner', () => {
		expect(isDue({ refreshedAt: ago(14), ok: false }, NOW, SIX_H)).toBe(false);
		expect(isDue({ refreshedAt: ago(15), ok: false }, NOW, SIX_H)).toBe(true);
	});
});
