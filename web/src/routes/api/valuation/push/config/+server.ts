import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pushConfigured, vapidPublicKey } from '$lib/server/webPush';

// The public VAPID key the browser needs to subscribe (it is public by design).
export const GET: RequestHandler = () =>
	json({ configured: pushConfigured(), publicKey: pushConfigured() ? vapidPublicKey() : null });
