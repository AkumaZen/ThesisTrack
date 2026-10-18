import type { PushPayload } from './announcements';

// Pure Telegram helpers: reading a webhook update, the deep link, and the alert text. No network,
// database or secrets in here. Chat ids and tokens are never logged by any caller.

export type TelegramCommand =
	| { kind: 'start'; chatId: string; token: string | null }
	| { kind: 'stop'; chatId: string };

/** A private-chat "/start <token>" or "/stop" from a Telegram update; anything else is ignored. */
export function parseTelegramUpdate(update: unknown): TelegramCommand | null {
	const msg = (update as { message?: { text?: unknown; chat?: { id?: unknown; type?: unknown } } } | null)?.message;
	if (!msg || typeof msg.text !== 'string' || msg.chat?.type !== 'private') return null;
	const id = msg.chat.id;
	if (typeof id !== 'number' && typeof id !== 'string') return null;
	const chatId = String(id);
	const m = /^\/(start|stop)(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(msg.text.trim());
	if (!m) return null;
	if (m[1].toLowerCase() === 'stop') return { kind: 'stop', chatId };
	return { kind: 'start', chatId, token: m[2] && /^[A-Za-z0-9_-]{16,64}$/.test(m[2]) ? m[2] : null };
}

/** The link the person opens to start the bot with their one-time token. */
export const deepLink = (botUsername: string, token: string) =>
	`https://t.me/${encodeURIComponent(botUsername.replace(/^@/, ''))}?start=${token}`;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Telegram HTML message for an alert: bold title, body, and an optional link. */
export function formatTelegramAlert(payload: PushPayload, link?: string | null): string {
	const parts = [`<b>${escapeHtml(payload.title)}</b>`, escapeHtml(payload.body)];
	if (link && /^https?:\/\//i.test(link)) parts.push(`<a href="${escapeHtml(link).replace(/"/g, '&quot;')}">Open document</a>`);
	return parts.join('\n\n');
}
