import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { telegramLinks, telegramLinkTokens } from '$lib/server/db/valuationSchema';

const TOKEN_TTL_MS = 15 * 60_000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A fresh one-time token for the person (any earlier unused one is dropped). Only its hash is stored. */
export async function createLinkToken(userId: number, now = new Date()): Promise<string> {
	const token = randomBytes(24).toString('base64url');
	await db.delete(telegramLinkTokens).where(lt(telegramLinkTokens.expiresAt, now));
	await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.userId, userId));
	await db.insert(telegramLinkTokens).values({ tokenHash: hash(token), userId, expiresAt: new Date(now.getTime() + TOKEN_TTL_MS) });
	return token;
}

/** Spends the token (once) and links the chat to its person. A chat belongs to one person: linking it
 *  moves it. Returns the person, or null for an unknown, used or expired token. */
export async function consumeLinkToken(token: string, chatId: string, now = new Date()): Promise<number | null> {
	const [row] = await db
		.delete(telegramLinkTokens)
		.where(and(eq(telegramLinkTokens.tokenHash, hash(token)), gt(telegramLinkTokens.expiresAt, now)))
		.returning({ userId: telegramLinkTokens.userId });
	if (!row) return null;
	await db.transaction(async (tx) => {
		await tx.delete(telegramLinks).where(eq(telegramLinks.chatId, chatId));
		await tx
			.insert(telegramLinks)
			.values({ userId: row.userId, chatId })
			.onConflictDoUpdate({ target: telegramLinks.userId, set: { chatId, linkedAt: now } });
	});
	return row.userId;
}

export async function getTelegramChat(userId: number): Promise<string | null> {
	const [row] = await db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, userId));
	return row?.chatId ?? null;
}

export async function unlinkUser(userId: number) {
	await db.delete(telegramLinks).where(eq(telegramLinks.userId, userId));
}

export async function unlinkChat(chatId: string) {
	await db.delete(telegramLinks).where(eq(telegramLinks.chatId, chatId));
}
