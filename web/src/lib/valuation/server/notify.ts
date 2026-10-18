import type { PushPayload } from '../announcements';
import { formatTelegramAlert } from '../telegram';
import { listSubscriptions, recordPushOutcome } from './announcementStore';
import { getTelegramChat, unlinkChat } from './telegramStore';
import { telegramConfigured, sendTelegramMessage, TelegramError, type TelegramSender } from '$lib/server/telegram';
import { pushConfigured, pushToTargets, sendWebPush, type PushSender } from '$lib/server/webPush';

// The one way to tell a person something: Web Push to their devices and Telegram to their linked
// chat, each only when configured. Reusable by any job (announcements, price and shareholding
// alerts, scan "new match" alerts):
//
//   const { notify } = createNotifier();
//   await notify(userId, { title, body, url, tag }, optionalExternalLink);
//
// Dead push subscriptions are removed and a blocked Telegram chat is unlinked as a side effect.

export interface NotifyDeps {
	send: PushSender;
	sendTelegram: TelegramSender;
	telegramOn: () => boolean;
	pushOn: () => boolean;
}

export interface NotifyCounters {
	pushSent: number;
	pushFailed: number;
	telegramSent: number;
	telegramFailed: number;
	subscriptionsRemoved: number;
}

export const emptyNotifyCounters = (): NotifyCounters => ({
	pushSent: 0,
	pushFailed: 0,
	telegramSent: 0,
	telegramFailed: 0,
	subscriptionsRemoved: 0
});

export const defaultNotifyDeps: NotifyDeps = {
	send: sendWebPush,
	sendTelegram: sendTelegramMessage,
	telegramOn: telegramConfigured,
	pushOn: pushConfigured
};

export type Notify = (userId: number, payload: PushPayload, link?: string | null) => Promise<void>;

/** A notifier that remembers each person's devices and chat for as long as it lives (one job run).
 *  Counts go into `counters`, which the caller may share with its own run summary. */
export function createNotifier(
	overrides: Partial<NotifyDeps> = {},
	counters: NotifyCounters = emptyNotifyCounters()
): { notify: Notify; counters: NotifyCounters; channelsOn: () => boolean } {
	const deps = { ...defaultNotifyDeps, ...overrides };
	const subsByUser = new Map<number, Awaited<ReturnType<typeof listSubscriptions>>>();
	const chatByUser = new Map<number, string | null>();
	const notify: Notify = async (userId, payload, link) => {
		if (deps.telegramOn()) {
			let chat = chatByUser.get(userId);
			if (chat === undefined) chatByUser.set(userId, (chat = await getTelegramChat(userId)));
			if (chat) {
				try {
					await deps.sendTelegram(chat, formatTelegramAlert(payload, link));
					counters.telegramSent++;
				} catch (err) {
					counters.telegramFailed++;
					// 403/400: the person blocked the bot or deleted the chat, so stop trying.
					if (err instanceof TelegramError && (err.status === 403 || err.status === 400)) {
						await unlinkChat(chat);
						chatByUser.set(userId, null);
					}
				}
			}
		}
		if (!deps.pushOn()) return;
		let targets = subsByUser.get(userId);
		if (!targets) subsByUser.set(userId, (targets = await listSubscriptions(userId)));
		if (!targets.length) return;
		const outcome = await pushToTargets(targets, payload, deps.send);
		await recordPushOutcome(outcome);
		counters.pushSent += outcome.sent;
		counters.pushFailed += outcome.failed;
		counters.subscriptionsRemoved += outcome.gone.length;
		if (outcome.gone.length) subsByUser.set(userId, targets.filter((t) => !outcome.gone.includes(t.id)));
	};
	return { notify, counters, channelsOn: () => deps.pushOn() || deps.telegramOn() };
}

/** One-off message to a person, for callers that send a single alert. */
export const notifyUser: Notify = (userId, payload, link) => createNotifier().notify(userId, payload, link);
