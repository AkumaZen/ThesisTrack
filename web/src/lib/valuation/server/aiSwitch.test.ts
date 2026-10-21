import { beforeEach, describe, expect, it, vi } from 'vitest';
const stub = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: stub.env }));
vi.mock('./concallStore', () => ({}));
vi.mock('./trackerFinancials', () => ({}));
import { aiEnabled } from './aiSwitch';
import { summariesEnabled, summariseAnnouncement } from './announcementSummary';
import { analyseBatch } from './concallJob';

beforeEach(() => { Object.keys(stub.env).forEach((k) => delete stub.env[k]); vi.unstubAllGlobals(); });

describe('AI kill switch', () => {
	it('is on by default and when empty, off only for AI_FEATURES=off', () => {
		expect(aiEnabled()).toBe(true);
		stub.env.AI_FEATURES = '';
		expect(aiEnabled()).toBe(true);
		stub.env.AI_FEATURES = 'off';
		expect(aiEnabled()).toBe(false);
	});

	it('skips announcement summaries and never calls the provider when off', async () => {
		stub.env.OPEN_AI_KEY = 'test-key';
		expect(summariesEnabled()).toBe(true);
		stub.env.AI_FEATURES = 'off';
		expect(summariesEnabled()).toBe(false);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await expect(summariseAnnouncement({ nseSymbol: 'X', companyName: 'X', subject: 's', details: 'd' }, fetchMock)).rejects.toThrow('AI features are turned off');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('makes no concall analysis call when off', async () => {
		stub.env.OPEN_AI_KEY = 'test-key';
		stub.env.AI_FEATURES = 'off';
		const fetchMock = vi.fn();
		await expect(analyseBatch(3, undefined, fetchMock)).rejects.toThrow('AI features are turned off');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
