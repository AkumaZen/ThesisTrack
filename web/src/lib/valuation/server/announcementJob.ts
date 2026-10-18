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
import { isRoutine } from '../announcementTags';
import { buildDealPayload, shouldNotifyDeal } from '../deals';
import { istDay } from '../boardMeetings';
import type { PushPayload } from '../announcements';
import { claimDealDelivery, getOnlyImportant, listPendingDealDeliveries } from './intelStore';
import {
	defaultIntelDeps,
	emptyIntelSummary,
	refreshCalendar,
	refreshDeals,
	refreshShareholding,
	tagBacklog,
	type IntelDeps,
	type IntelSummary
} from './intelJob';
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
	intel: IntelDeps;
	/** Slow best-effort sources (calendar, ...) are skipped once a run is this far in. */
	extrasBudgetMs: number;
}

const defaultDeps: JobDeps = {
	fetchAnnouncements: (symbol, days) => fetchSymbolAnnouncements(symbol, days),
	summarise: (a) => summariseAnnouncement(a),
	send: sendWebPush,
	summariesOn: summariesEnabled,
	pushOn: pushConfigured,
	now: () => new Date(),
	intel: defaultIntelDeps,
	extrasBudgetMs: 30_000
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
	/** Pushes skipped because the person only wants important filings and this one is routine. */
	suppressed: number;
	dealsNotified: number;
	intel: IntelSummary;
	errors: string[];
}

/**
 * One poll, called every minute by the external scheduler: fetch what tracked companies announced,
 * store anything new, summarise a few, then push each person the filings published after they started
 * tracking that company. Every step tolerates the one before it failing (an announcement is stored
 * and pushed with its raw subject even if the LLM is down).
 */
export async function runAnnouncementCheck(
	overrides: Partial<Omit<JobDeps, 'intel'>> & { intel?: Partial<IntelDeps> } = {}
): Promise<JobSummary> {
	const deps = { ...defaultDeps, ...overrides, intel: { ...defaultIntelDeps, ...overrides.intel } };
	const now = deps.now();
	const summary: JobSummary = {
		symbols: 0, fetched: 0, newAnnouncements: 0, summarised: 0, notified: 0,
		pushSent: 0, pushFailed: 0, subscriptionsRemoved: 0, suppressed: 0, dealsNotified: 0, intel: emptyIntelSummary(), errors: []
	};
	const startedAt = Date.now();

	// Older rows get their tag before anything is pushed (a push title carries it).
	await tagBacklog(summary.intel).catch((err) => summary.errors.push(`tags: ${err instanceof Error ? err.message : String(err)}`));

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
	const notify = makeNotifier(deps, summary);
	if (deps.pushOn()) await deliver(deps, now, summary, summariesOn, notify);

	// 4. Best-effort extras; they never delay or break the alerts above.
	if (Date.now() - startedAt < deps.extrasBudgetMs) {
		const guard = (name: string) => (err: unknown) =>
			summary.errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
		await refreshCalendar(deps.intel, now, summary.intel).catch(guard('calendar'));
		await refreshDeals(deps.intel, now, summary.intel).catch(guard('deals'));
		await refreshShareholding(deps.intel, now, summary.intel).catch(guard('shareholding'));
		summary.errors.push(...summary.intel.errors);
		if (deps.pushOn()) await deliverDeals(now, summary, notify).catch(guard('deal alerts'));
	}
	return summary;
}

type Notify = (userId: number, payload: PushPayload) => Promise<void>;

/** Sends one message to a person's devices, remembering their subscriptions for the rest of the run. */
function makeNotifier(deps: JobDeps, summary: JobSummary): Notify {
	const subsByUser = new Map<number, Awaited<ReturnType<typeof listSubscriptions>>>();
	return async (userId, payload) => {
		let targets = subsByUser.get(userId);
		if (!targets) subsByUser.set(userId, (targets = await listSubscriptions(userId)));
		if (!targets.length) return;
		const outcome = await pushToTargets(targets, payload, deps.send);
		await recordPushOutcome(outcome);
		summary.pushSent += outcome.sent;
		summary.pushFailed += outcome.failed;
		summary.subscriptionsRemoved += outcome.gone.length;
		if (outcome.gone.length) subsByUser.set(userId, targets.filter((t) => !outcome.gone.includes(t.id)));
	};
}

async function deliver(deps: JobDeps, now: Date, summary: JobSummary, summariesOn: boolean, notify: Notify) {
	const importantOnly = new Map<number, boolean>();
	for (const p of await listPendingDeliveries(now)) {
		const a = p.announcement;
		if (!shouldNotify(a.announcedAt, p.trackedSince, now) || !readyToNotify(a, summariesOn)) continue;
		if (!(await claimDelivery(p.userId, a.id))) continue;
		let only = importantOnly.get(p.userId);
		if (only === undefined) importantOnly.set(p.userId, (only = await getOnlyImportant(p.userId)));
		if (only && isRoutine(a.tag)) {
			summary.suppressed++; // claimed, so it is not reconsidered, but nobody is interrupted
			continue;
		}
		summary.notified++;
		await notify(p.userId, buildPushPayload(a));
	}
}

/** Bulk/block deals on tracked companies, claimed before sending like announcements. */
async function deliverDeals(now: Date, summary: JobSummary, notify: Notify) {
	const sinceDay = istDay(new Date(now.getTime() - 4 * 86_400_000));
	for (const p of await listPendingDealDeliveries(sinceDay)) {
		if (!shouldNotifyDeal(p.deal.dealDate, p.deal.createdAt, p.trackedSince, now)) continue;
		if (!(await claimDealDelivery(p.userId, p.deal.id))) continue;
		summary.dealsNotified++;
		await notify(p.userId, buildDealPayload(p.deal));
	}
}
