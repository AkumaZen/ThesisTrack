import webpush from 'web-push';
import { env } from '$env/dynamic/private';
import type { PushPayload } from '$lib/valuation/announcements';

export interface PushTarget {
	id: number;
	endpoint: string;
	p256dh: string;
	auth: string;
}

export type PushSender = (target: PushTarget, payload: string) => Promise<unknown>;

export interface PushOutcome {
	sent: number;
	/** Subscriptions the push service said no longer exist (404/410); the caller deletes them. */
	gone: number[];
	failed: number;
	succeededIds: number[];
	failedIds: number[];
}

export const pushConfigured = () =>
	Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

export const vapidPublicKey = () => env.VAPID_PUBLIC_KEY ?? null;

/** The real sender: web-push signs the request with the VAPID keys from the environment. */
export const sendWebPush: PushSender = (target, payload) =>
	webpush.sendNotification(
		{ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
		payload,
		{
			vapidDetails: {
				subject: env.VAPID_SUBJECT!,
				publicKey: env.VAPID_PUBLIC_KEY!,
				privateKey: env.VAPID_PRIVATE_KEY!
			},
			TTL: 6 * 3600,
			timeout: 8000
		}
	);

/** Sends one message to every target. A dead subscription (404/410) is reported in `gone`; any
 *  other failure is counted but the subscription is kept, since the push service may recover. */
export async function pushToTargets(
	targets: PushTarget[],
	payload: PushPayload,
	send: PushSender = sendWebPush
): Promise<PushOutcome> {
	const body = JSON.stringify(payload);
	const outcome: PushOutcome = { sent: 0, gone: [], failed: 0, succeededIds: [], failedIds: [] };
	await Promise.all(
		targets.map(async (t) => {
			try {
				await send(t, body);
				outcome.sent++;
				outcome.succeededIds.push(t.id);
			} catch (err) {
				const status = (err as { statusCode?: number }).statusCode;
				if (status === 404 || status === 410) outcome.gone.push(t.id);
				else {
					outcome.failed++;
					outcome.failedIds.push(t.id);
				}
			}
		})
	);
	return outcome;
}
