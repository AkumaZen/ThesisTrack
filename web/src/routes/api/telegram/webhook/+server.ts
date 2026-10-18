import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendTelegramMessage, telegramConfigured, webhookSecretOk } from '$lib/server/telegram';
import { handleTelegramUpdate } from '$lib/server/telegramWebhook';

// Telegram calls this with the secret chosen at setWebhook time in X-Telegram-Bot-Api-Secret-Token.
// It is public in access.ts (no session), so the secret is the only gate.
export const POST: RequestHandler = async ({ request }) => {
	if (!telegramConfigured()) error(404, 'Not found.');
	if (!webhookSecretOk(request.headers.get('x-telegram-bot-api-secret-token'))) error(401, 'Bad secret.');
	const update = await request.json().catch(() => null);
	await handleTelegramUpdate(update, sendTelegramMessage);
	return json({ ok: true });
};
