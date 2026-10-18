import { buildPushPayload, readyToNotify, shouldNotify, type ParsedAnnouncement } from '../announcements';
import { fetchSymbolAnnouncements } from './nseAnnouncements';
import { summariesEnabled, summariseAnnouncement } from './announcementSummary';
import {
	claimDelivery,
	distinctTrackedSymbols,
	listPendingDeliveries,
	listSubscriptions,
	listToSummarise,
	noteSummaryFailure,
	recordPushOutcome,
	saveAnnouncements,
	saveSummary,
	type AnnouncementRow
} from './announcementStore';
import { pushConfigured, pushToTargets, sendWebPush, type PushSender } from '$lib/server/webPush';

/** NSE is asked for the last few days each run; older filings only matter for the company page. */
const POLL_DAYS = 3;
const POLL_CONCURRENCY = 4;
/** LLM calls per run. Whatever is left over is picked up by the next run a minute later. */
const SUMMARIES_PER_RUN = 5;

export interface JobDeps {
	fetchAnnouncements: (symbol: string, days: number) => Promise<ParsedAnnouncement[]>;
	summarise: (a: AnnouncementRow) => Promise<string>;
	send: PushSender;
	summariesOn: () => boolean;
	pushOn: () => boolean;
	now: () => Date;
}

const defaultDeps: JobDeps = {
	fetchAnnouncements: (symbol, days) => fetchSymbolAnnouncements(symbol, days),
	summarise: (a) => summariseAnnouncement(a),
	send: sendWebPush,
	summariesOn: summariesEnabled,
	pushOn: pushConfigured,
	now: () => new Date()
};

export interface JobSummary {
	symbols: number;
	fetched: number;
	newAnnouncements: number;
	summarised: number;
	notified: number;
	pushSent: number;
	pushFailed: number;
	subscriptionsRemoved: number;
	errors: string[];
}

/**
 * One poll, called every minute by the external scheduler: fetch what tracked companies announced,
 * store anything new, summarise a few, then push each person the filings published after they started
 * tracking that company. Every step tolerates the one before it failing (an announcement is stored
 * and pushed with its raw subject even if the LLM is down).
 */
export async function runAnnouncementCheck(overrides: Partial<JobDeps> = {}): Promise<JobSummary> {
	const deps = { ...defaultDeps, ...overrides };
	const now = deps.now();
	const summary: JobSummary = {
		symbols: 0, fetched: 0, newAnnouncements: 0, summarised: 0, notified: 0,
		pushSent: 0, pushFailed: 0, subscriptionsRemoved: 0, errors: []
	};

	const symbols = await distinctTrackedSymbols();
	summary.symbols = symbols.length;
	if (!symbols.length) return summary;

	// 1. Fetch (a few symbols at a time, to stay gentle with NSE).
	for (let i = 0; i < symbols.length; i += POLL_CONCURRENCY) {
		await Promise.all(
			symbols.slice(i, i + POLL_CONCURRENCY).map(async (symbol) => {
				try {
					const rows = await deps.fetchAnnouncements(symbol, POLL_DAYS);
					summary.fetched += rows.length;
					summary.newAnnouncements += await saveAnnouncements(rows);
				} catch (err) {
					summary.errors.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
				}
			})
		);
	}

	// 2. Summarise (capped).
	const summariesOn = deps.summariesOn();
	if (summariesOn) {
		for (const a of await listToSummarise(symbols, now, SUMMARIES_PER_RUN)) {
			try {
				await saveSummary(a.id, await deps.summarise(a));
				summary.summarised++;
			} catch (err) {
				await noteSummaryFailure(a.id);
				summary.errors.push(`summary ${a.nseSymbol}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	// 3. Push. Without VAPID keys nothing is claimed, so the filings go out once keys exist.
	if (!deps.pushOn()) return summary;
	const subsByUser = new Map<number, Awaited<ReturnType<typeof listSubscriptions>>>();
	for (const p of await listPendingDeliveries(now)) {
		const a = p.announcement;
		if (!shouldNotify(a.announcedAt, p.trackedSince, now) || !readyToNotify(a, summariesOn)) continue;
		if (!(await claimDelivery(p.userId, a.id))) continue;
		summary.notified++;
		let targets = subsByUser.get(p.userId);
		if (!targets) subsByUser.set(p.userId, (targets = await listSubscriptions(p.userId)));
		if (!targets.length) continue;
		const outcome = await pushToTargets(targets, buildPushPayload(a), deps.send);
		await recordPushOutcome(outcome);
		summary.pushSent += outcome.sent;
		summary.pushFailed += outcome.failed;
		summary.subscriptionsRemoved += outcome.gone.length;
		if (outcome.gone.length) subsByUser.set(p.userId, targets.filter((t) => !outcome.gone.includes(t.id)));
	}
	return summary;
}
