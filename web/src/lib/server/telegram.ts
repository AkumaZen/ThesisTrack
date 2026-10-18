import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

// Telegram is an optional backup channel. Everything here is inactive unless both the bot token
// and the bot username are configured. Tokens and chat ids are never logged or put in errors.

export const telegramConfigured = () => Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME);

export const telegramBotUsername = () => env.TELEGRAM_BOT_USERNAME ?? null;

/** Constant-time check of the X-Telegram-Bot-Api-Secret-Token header. Without a configured secret
 *  nothing passes, so the webhook cannot be driven by strangers. */
export function webhookSecretOk(header: string | null): boolean {
	const secret = env.TELEGRAM_WEBHOOK_SECRET;
	if (!secret || !header) return false;
	const a = Buffer.from(header);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}

export type TelegramSender = (chatId: string, html: string) => Promise<void>;

/** Raised with the HTTP status only; 403 means the person blocked the bot or deleted the chat. */
export class TelegramError extends Error {
	constructor(readonly status: number) {
		super(`Telegram request failed (HTTP ${status})`);
	}
}

export const sendTelegramMessage: TelegramSender = async (chatId, html) => {
	const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new TelegramError(res.status);
};
