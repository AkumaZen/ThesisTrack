import { beforeEach, describe, expect, it, vi } from 'vitest';

const { env } = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env }));

import { requireCronSecret } from './cron';

const req = (auth?: string) => new Request('http://x/api/cron/announcements', { headers: auth ? { authorization: auth } : {} });
const statusOf = (fn: () => void) => {
	try {
		fn();
	} catch (e) {
		return (e as { status: number }).status;
	}
	return 200;
};

describe('requireCronSecret', () => {
	beforeEach(() => delete env.CRON_SECRET);

	it('stays shut when no secret is configured', () => {
		expect(statusOf(() => requireCronSecret(req('Bearer anything')))).toBe(503);
	});
	it('rejects a missing or wrong secret and accepts the right one', () => {
		env.CRON_SECRET = 's3cret';
		expect(statusOf(() => requireCronSecret(req()))).toBe(401);
		expect(statusOf(() => requireCronSecret(req('Bearer nope')))).toBe(401);
		expect(statusOf(() => requireCronSecret(req('Bearer s3cret')))).toBe(200);
	});
});
