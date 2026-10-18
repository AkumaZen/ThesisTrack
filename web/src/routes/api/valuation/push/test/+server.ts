import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listSubscriptions, recordPushOutcome } from '$lib/valuation/server/announcementStore';
import { pushConfigured, pushToTargets } from '$lib/server/webPush';

export const POST: RequestHandler = async ({ locals }) => {
	if (!pushConfigured()) error(503, 'Push notifications are not configured on the server yet.');
	const targets = await listSubscriptions(locals.user!.id);
	if (!targets.length) error(400, 'This device is not subscribed yet. Press Allow notifications first.');
	const outcome = await pushToTargets(targets, {
		title: 'ThesisTrack test',
		body: 'Notifications work. You will be alerted when companies you track announce something.',
		url: '/valuation/tracking',
		tag: 'test'
	});
	await recordPushOutcome(outcome);
	if (!outcome.sent) {
		error(502, outcome.gone.length ? 'The device subscription had expired and was removed. Allow notifications again.' : 'The push service rejected the message. Try again.');
	}
	return json({ sent: outcome.sent });
};
