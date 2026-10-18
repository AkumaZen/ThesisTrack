// Telegram: the webhook (secret header, link, unlink, one-time tokens) and alert delivery with the same
// claim-before-send dedupe as Web Push, against the local database with a fake Telegram.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// $env/dynamic/private is fixed at start-up, so the test supplies the (mutable) environment itself.
const fakeEnv = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$env/dynamic/private', async (original) => {
	Object.assign(fakeEnv, ((await original()) as { env: Record<string, string> }).env);
	return { env: fakeEnv };
});
import { and, eq } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import {
	announcements,
	telegramLinkTokens,
	telegramLinks,
	trackedCompanies
} from '../src/lib/server/db/valuationSchema';
import { POST as webhook } from '../src/routes/api/telegram/webhook/+server';
import { createLinkToken, consumeLinkToken, getTelegramChat } from '../src/lib/valuation/server/telegramStore';
import { runAnnouncementCheck, type JobDeps } from '../src/lib/valuation/server/announcementJob';
import { TelegramError } from '../src/lib/server/telegram';
import { dbReachable } from './dbReachable';

const dbUp = await dbReachable();
const RUN = Date.now();
const SYMBOL = `VG${RUN}`;
const CHAT = String(900_000_000 + (RUN % 1_000_000));
const SECRET = `secret-${RUN}`;
const NOW = new Date();
const mins = (n: number) => new Date(NOW.getTime() - n * 60_000);

let userId = 0;
const telegramSent: string[] = [];
const replies: string[] = [];

const call = (secret: string | null, body: unknown) =>
	webhook({
		request: new Request('http://localhost/api/telegram/webhook', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
			body: JSON.stringify(body)
		})
	} as unknown as Parameters<typeof webhook>[0]);

const update = (text: string, chat = CHAT) => ({ message: { text, chat: { id: Number(chat), type: 'private' } } });
const status = async (p: Response | Promise<Response>) => {
	try {
		return (await p).status;
	} catch (e) {
		return (e as { status: number }).status;
	}
};

function deps(over: Partial<JobDeps> = {}): Partial<JobDeps> {
	return {
		fetchAnnouncements: async (s) =>
			s === SYMBOL
				? [{ dedupeKey: `vitest-tg:${RUN}:a`, nseSymbol: SYMBOL, companyName: 'Tg Ltd', subject: 'Credit Rating', details: 'rating', announcedAt: mins(5), pdfUrl: 'https://x.example/a.pdf' }]
				: [],
		summariesOn: () => false,
		pushOn: () => false,
		telegramOn: () => true,
		sendTelegram: async (chat, html) => {
			telegramSent.push(`${chat}|${html}`);
		},
		now: () => NOW,
		intel: { fetchMeetings: async () => [], fetchDeals: async () => [], fetchShareholding: async () => null },
		...over
	};
}

describe.skipIf(!dbUp)('Telegram (database)', () => {
	beforeAll(async () => {
		fakeEnv.TELEGRAM_BOT_TOKEN = 'test-token';
		fakeEnv.TELEGRAM_BOT_USERNAME = 'ThesisTestBot';
		fakeEnv.TELEGRAM_WEBHOOK_SECRET = SECRET;
		const [u] = await db
			.insert(users)
			.values({ email: `vitest-tg-${RUN}@example.invalid`, passwordHash: 'x', displayName: `Vitest.Tg${RUN}` })
			.returning({ id: users.id });
		userId = u.id;
	});

	afterAll(async () => {
		if (!dbUp) return;
		for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET']) delete fakeEnv[k];
		await db.delete(announcements).where(eq(announcements.nseSymbol, SYMBOL));
		await db.delete(users).where(eq(users.id, userId));
	});

	it('rejects a missing or wrong secret and links nothing', async () => {
		const token = await createLinkToken(userId);
		expect(await status(call(null, update(`/start ${token}`)))).toBe(401);
		expect(await status(call('wrong', update(`/start ${token}`)))).toBe(401);
		expect(await getTelegramChat(userId)).toBeNull();
		// the token is still unspent: a bad caller cannot burn it
		expect(await db.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.userId, userId))).toHaveLength(1);
	});

	it('links the chat with a valid one-time token, once', async () => {
		const token = await createLinkToken(userId);
		expect(await status(call(SECRET, update(`/start ${token}`)))).toBe(200);
		expect(await getTelegramChat(userId)).toBe(CHAT);
		// spent: the same token links nobody again
		expect(await consumeLinkToken(token, '1')).toBeNull();
	});

	it('refuses an expired token and unknown tokens', async () => {
		const token = await createLinkToken(userId, new Date(NOW.getTime() - 3600_000));
		expect(await consumeLinkToken(token, CHAT)).toBeNull();
		expect(await consumeLinkToken('x'.repeat(32), CHAT)).toBeNull();
	});

	it('unlinks on /stop and on the disconnect call path', async () => {
		expect(await getTelegramChat(userId)).toBe(CHAT);
		expect(await status(call(SECRET, update('/stop')))).toBe(200);
		expect(await getTelegramChat(userId)).toBeNull();
	});

	it('moves a chat to the latest person who links it', async () => {
		const [other] = await db.insert(users).values({ email: `vitest-tg2-${RUN}@example.invalid`, passwordHash: 'x', displayName: `Vitest.Tg2${RUN}` }).returning({ id: users.id });
		try {
			await consumeLinkToken(await createLinkToken(userId), CHAT);
			await consumeLinkToken(await createLinkToken(other.id), CHAT);
			expect(await getTelegramChat(userId)).toBeNull();
			expect(await getTelegramChat(other.id)).toBe(CHAT);
		} finally {
			await db.delete(users).where(eq(users.id, other.id));
		}
	});

	it('sends alerts to Telegram once (same claim-before-send as push) and drops a blocked chat', async () => {
		await db.delete(telegramLinks).where(eq(telegramLinks.userId, userId));
		await consumeLinkToken(await createLinkToken(userId), CHAT);
		await db.insert(trackedCompanies).values({ userId, nseSymbol: SYMBOL, companyName: 'Tg Ltd', createdAt: mins(600) });

		const first = await runAnnouncementCheck(deps());
		expect(first.telegramSent).toBe(1);
		expect(telegramSent).toHaveLength(1);
		expect(telegramSent[0]).toContain(`${CHAT}|<b>[Credit rating] ${SYMBOL}: Credit Rating</b>`);
		expect(telegramSent[0]).toContain('https://x.example/a.pdf');

		const second = await runAnnouncementCheck(deps());
		expect(second.telegramSent).toBe(0);
		expect(telegramSent).toHaveLength(1);

		// A new filing, but the person has blocked the bot: the link is removed and nothing breaks.
		const blocked = await runAnnouncementCheck(
			deps({
				fetchAnnouncements: async (s) =>
					s === SYMBOL
						? [{ dedupeKey: `vitest-tg:${RUN}:b`, nseSymbol: SYMBOL, companyName: 'Tg Ltd', subject: 'Dividend', details: 'div', announcedAt: mins(2), pdfUrl: null }]
						: [],
				sendTelegram: async () => {
					throw new TelegramError(403);
				}
			})
		);
		expect(blocked.telegramFailed).toBe(1);
		expect(blocked.errors).toEqual([]);
		expect(await getTelegramChat(userId)).toBeNull();
		await db.delete(telegramLinks).where(and(eq(telegramLinks.userId, userId)));
	});

	it('stays inactive when Telegram is not configured', async () => {
		const token = fakeEnv.TELEGRAM_BOT_TOKEN;
		delete fakeEnv.TELEGRAM_BOT_TOKEN;
		try {
			expect(await status(call(SECRET, update('/stop')))).toBe(404);
		} finally {
			fakeEnv.TELEGRAM_BOT_TOKEN = token;
		}
	});
});
