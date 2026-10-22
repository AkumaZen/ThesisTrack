import { beforeEach, describe, expect, it, vi } from 'vitest';
const stub = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: stub.env }));
const jobs = vi.hoisted(() => ({ analyseBatch: vi.fn(), refreshBatch: vi.fn() }));
vi.mock('$lib/valuation/server/concallJob', () => ({ analyseBatch: jobs.analyseBatch, refreshBatch: jobs.refreshBatch, modelConfig: () => ({ key: 'test-key', model: 'm' }), MAX_ANALYSES_PER_RUN: 5 }));
import { POST } from './+server';

const call = (mode: string) => POST({ request: new Request('http://x/api', { method: 'POST', body: JSON.stringify({ mode }) }) } as Parameters<typeof POST>[0]);

beforeEach(() => { Object.keys(stub.env).forEach((k) => delete stub.env[k]); jobs.analyseBatch.mockReset(); jobs.refreshBatch.mockReset(); });

describe('concalls run endpoint with the AI kill switch', () => {
	it('answers 503 and runs no analysis when AI is off', async () => {
		stub.env.AI_FEATURES = 'off';
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await expect(call('analyse')).rejects.toMatchObject({ status: 503, body: { message: 'AI features are turned off.' } });
		expect(jobs.analyseBatch).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('still runs the non-AI refresh when AI is off', async () => {
		stub.env.AI_FEATURES = 'off';
		jobs.refreshBatch.mockResolvedValue({ done: [], failed: [], remaining: 0 });
		const res = await call('refresh');
		expect(res.status).toBe(200);
		expect(jobs.refreshBatch).toHaveBeenCalled();
	});

	it('analyses when AI is on', async () => {
		jobs.analyseBatch.mockResolvedValue({ analysed: [], cached: 0, failed: [], remaining: 0 });
		const res = await call('analyse');
		expect(res.status).toBe(200);
		expect(jobs.analyseBatch).toHaveBeenCalled();
	});
});
