import { parseTelegramUpdate } from '$lib/valuation/telegram';
import { consumeLinkToken, unlinkChat } from '$lib/valuation/server/telegramStore';
import type { TelegramSender } from './telegram';

const WELCOME = 'Connected. Alerts for the companies you track in ThesisTrack will also arrive here. Send /stop to disconnect.';
const BAD_TOKEN = 'That link has expired or was already used. Open ThesisTrack, press Connect Telegram and try again.';
const NO_TOKEN = 'To connect, open ThesisTrack, go to Tracked companies and press Connect Telegram.';
const STOPPED = 'Disconnected. You will no longer get alerts here.';

/** Acts on one (already authenticated) webhook update: links or unlinks a chat and answers it. A failed
 *  reply never fails the webhook, since Telegram would retry the update. */
export async function handleTelegramUpdate(update: unknown, send: TelegramSender): Promise<'linked' | 'unlinked' | 'rejected' | 'ignored'> {
	const cmd = parseTelegramUpdate(update);
	if (!cmd) return 'ignored';
	const reply = (text: string) => send(cmd.chatId, text).catch(() => {});
	if (cmd.kind === 'stop') {
		await unlinkChat(cmd.chatId);
		await reply(STOPPED);
		return 'unlinked';
	}
	if (!cmd.token) {
		await reply(NO_TOKEN);
		return 'rejected';
	}
	const userId = await consumeLinkToken(cmd.token, cmd.chatId);
	await reply(userId ? WELCOME : BAD_TOKEN);
	return userId ? 'linked' : 'rejected';
}
