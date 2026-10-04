import { describe, expect, it } from 'vitest';
import { noteProblem, statusIsStale, NOTE_MAX_LENGTH, type StatusInfo } from './team';
import { timeAgo } from './activity';

const status = (s: StatusInfo['status'], atVersion: number | null): StatusInfo => ({
	status: s,
	atVersion,
	setBy: 'a',
	setAt: 0
});

describe('statusIsStale', () => {
	it('flags an approval only once the valuation moved past the approved version', () => {
		expect(statusIsStale(status('approved', 3), 3)).toBe(false);
		expect(statusIsStale(status('approved', 3), 4)).toBe(true);
	});
	it('never flags other statuses, missing versions or no status', () => {
		expect(statusIsStale(status('review_needed', 3), 9)).toBe(false);
		expect(statusIsStale(status('approved', null), 9)).toBe(false);
		expect(statusIsStale(null, 9)).toBe(false);
	});
});

describe('noteProblem', () => {
	it('accepts real text and rejects empty, blank, non-text and over-long input', () => {
		expect(noteProblem('Met management.')).toBeNull();
		expect(noteProblem('')).toMatch(/Write something/);
		expect(noteProblem('   \n ')).toMatch(/Write something/);
		expect(noteProblem(42)).toMatch(/missing/);
		expect(noteProblem(undefined)).toMatch(/missing/);
		expect(noteProblem('x'.repeat(NOTE_MAX_LENGTH + 1))).toMatch(/under/);
		expect(noteProblem('x'.repeat(NOTE_MAX_LENGTH))).toBeNull();
	});
});

describe('timeAgo', () => {
	const now = Date.UTC(2026, 9, 4, 12, 0, 0);
	it('reads naturally at each scale', () => {
		expect(timeAgo(now - 10_000, now)).toBe('just now');
		expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
		expect(timeAgo(now - 3 * 3600_000, now)).toBe('3 h ago');
		expect(timeAgo(now - 26 * 3600_000, now)).toBe('yesterday');
		expect(timeAgo(now - 4 * 86400_000, now)).toBe('4 days ago');
		expect(timeAgo(now - 30 * 86400_000, now)).toMatch(/2026/);
	});
	it('treats a clock slightly ahead as just now, never negative', () => {
		expect(timeAgo(now + 5_000, now)).toBe('just now');
	});
});
