import { describe, expect, it } from 'vitest';
import { pushToTargets, type PushTarget } from './webPush';

const target = (id: number): PushTarget => ({ id, endpoint: `https://push.example/${id}`, p256dh: 'p', auth: 'a' });
const payload = { title: 't', body: 'b', url: '/u', tag: 'x' };

describe('pushToTargets', () => {
	it('reports 404 and 410 subscriptions as gone, other failures as failed, and counts successes', async () => {
		const send = async (t: PushTarget) => {
			if (t.id === 1) return;
			if (t.id === 2) throw Object.assign(new Error('gone'), { statusCode: 410 });
			if (t.id === 3) throw Object.assign(new Error('missing'), { statusCode: 404 });
			throw Object.assign(new Error('busy'), { statusCode: 503 });
		};
		const out = await pushToTargets([target(1), target(2), target(3), target(4)], payload, send);
		expect(out.sent).toBe(1);
		expect(out.succeededIds).toEqual([1]);
		expect(out.gone.sort()).toEqual([2, 3]);
		expect(out.failed).toBe(1);
		expect(out.failedIds).toEqual([4]);
	});

	it('sends the payload as JSON', async () => {
		let body = '';
		await pushToTargets([target(1)], payload, async (_t, b) => void (body = b));
		expect(JSON.parse(body)).toEqual(payload);
	});
});
