import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: { execute } }));
vi.mock('$env/dynamic/private', () => ({ env: { VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890' } }));

import { GET } from './+server';

const call = () => GET({} as never) as Promise<Response>;

beforeEach(() => {
	execute.mockReset();
});

describe('GET /api/health', () => {
	it('reports ok and the running commit when the database answers', async () => {
		execute.mockResolvedValue([{ '?column?': 1 }]);
		const res = await call();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: 'ok', database: 'ok', commit: 'abcdef1' });
	});

	it('returns 503 when the database query fails', async () => {
		execute.mockRejectedValue(new Error('connect ECONNREFUSED'));
		const res = await call();
		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({ status: 'error', database: 'unreachable' });
	});

	it('returns 503 when the database does not answer in time', async () => {
		vi.useFakeTimers();
		try {
			execute.mockReturnValue(new Promise(() => {}));
			const pending = call();
			await vi.advanceTimersByTimeAsync(3000);
			expect((await pending).status).toBe(503);
		} finally {
			vi.useRealTimers();
		}
	});
});
