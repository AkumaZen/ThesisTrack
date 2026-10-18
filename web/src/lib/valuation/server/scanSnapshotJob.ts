import { diffSnapshots, scanShareHref, type SnapshotDiff } from '../savedScans';
import { formatTelegramAlert } from '../telegram';
import type { PushPayload } from '../announcements';
import { pushConfigured, pushToTargets } from '$lib/server/webPush';
import { telegramConfigured, sendTelegramMessage } from '$lib/server/telegram';
import { listSubscriptions, recordPushOutcome } from './announcementStore';
import { getTelegramChat } from './telegramStore';
import {
	evaluateInContext,
	listAllScans,
	loadScanContext,
	saveSnapshot,
	getSnapshot,
	snapshotBefore,
	type SavedScan
} from './savedScanStore';

export interface SnapshotSummary {
	scans: number;
	snapped: number;
	date: string | null;
	alerts: number;
	errors: string[];
}

/** The message for a scan with new matches: a short list of tickers and a link to the scan. */
export function newMatchPayload(scan: Pick<SavedScan, 'id' | 'name'>, added: string[], date: string): PushPayload {
	const shown = added.slice(0, 8).join(', ');
	const more = added.length > 8 ? ` and ${added.length - 8} more` : '';
	return {
		title: `${scan.name}: ${added.length} new match${added.length === 1 ? '' : 'es'}`,
		body: `${shown}${more} (scan as of ${date})`,
		url: scanShareHref(scan.id),
		tag: `scan-${scan.id}-${date}`
	};
}

/** Sends one person's alert to their devices and Telegram chat. Failures are swallowed: a dead channel must not stop the run. */
async function notifyOwner(userId: number, payload: PushPayload): Promise<boolean> {
	let sent = false;
	if (telegramConfigured()) {
		try {
			const chat = await getTelegramChat(userId);
			if (chat) {
				await sendTelegramMessage(chat, formatTelegramAlert(payload));
				sent = true;
			}
		} catch {
			// Best effort, as for announcement alerts.
		}
	}
	if (pushConfigured()) {
		try {
			const targets = await listSubscriptions(userId);
			if (targets.length) {
				const outcome = await pushToTargets(targets, payload);
				await recordPushOutcome(outcome);
				sent = sent || outcome.sent > 0;
			}
		} catch {
			// Best effort.
		}
	}
	return sent;
}

/** Stores a snapshot of one scan for the data date (no alerts): a new scan gets its first one at once. */
export async function snapshotOne(scan: SavedScan): Promise<{ date: string; matches: number } | null> {
	const ctx = await loadScanContext();
	if (!ctx.dataDate) return null;
	const symbols = evaluateInContext(scan.config, ctx);
	await saveSnapshot(scan.id, ctx.dataDate, symbols);
	return { date: ctx.dataDate, matches: symbols.length };
}

/** Evaluates every saved scan against the stored scan results, stores today's snapshot (dated by the
 *  newest session in the data, so running twice a day or on a holiday never invents a new day), and
 *  alerts the owners of scans with the alert switch on when something new has matched since the
 *  previous snapshot. The first snapshot of a scan never alerts: nothing is "new" yet. */
export async function runScanSnapshots(): Promise<SnapshotSummary> {
	const summary: SnapshotSummary = { scans: 0, snapped: 0, date: null, alerts: 0, errors: [] };
	const scans = await listAllScans();
	summary.scans = scans.length;
	if (scans.length === 0) return summary;
	const ctx = await loadScanContext();
	if (!ctx.dataDate) return summary;
	summary.date = ctx.dataDate;
	for (const scan of scans) {
		try {
			const symbols = evaluateInContext(scan.config, ctx);
			const previous = await snapshotBefore(scan.id, ctx.dataDate);
			// A second run for the same data date refreshes the snapshot but never alerts twice.
			const alreadyToday = (await getSnapshot(scan.id, ctx.dataDate)) !== null;
			await saveSnapshot(scan.id, ctx.dataDate, symbols);
			summary.snapped++;
			if (!scan.notify || alreadyToday) continue;
			const diff: SnapshotDiff = diffSnapshots(previous?.symbols ?? null, symbols);
			if (diff.added.length > 0 && (await notifyOwner(scan.ownerId, newMatchPayload(scan, diff.added, ctx.dataDate)))) {
				summary.alerts++;
			}
		} catch (e) {
			summary.errors.push(`${scan.name}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	return summary;
}
