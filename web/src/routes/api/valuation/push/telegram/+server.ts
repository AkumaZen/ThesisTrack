import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { telegramBotUsername, telegramConfigured } from '$lib/server/telegram';
import { createLinkToken, getTelegramChat, unlinkUser } from '$lib/valuation/server/telegramStore';
import { deepLink } from '$lib/valuation/telegram';

// The person's own Telegram link. Open to read-only accounts (see PERSONAL_API_PREFIXES). Chat ids are never returned.
export const GET: RequestHandler = async ({ locals }) =>
	json({ available: telegramConfigured(), linked: telegramConfigured() && Boolean(await getTelegramChat(locals.user!.id)) });

export const POST: RequestHandler = async ({ locals }) => {
	if (!telegramConfigured()) error(404, 'Telegram is not set up.');
	const token = await createLinkToken(locals.user!.id);
	return json({ url: deepLink(telegramBotUsername()!, token) });
};

export const DELETE: RequestHandler = async ({ locals }) => {
	await unlinkUser(locals.user!.id);
	return json({ ok: true });
};
