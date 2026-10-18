import { buildPushPayload, readyToNotify, shouldNotify, type ParsedAnnouncement } from '../announcements';
import { fetchSymbolAnnouncements } from './nseAnnouncements';
import { summariesEnabled, summariseAnnouncement } from './announcementSummary';
import {
	claimDelivery,
	distinctTrackedSymbols,
	listPendingDeliveries,
	listToSummarise,
	noteSummaryFailure,
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
import { telegramConfigured, sendTelegramMessage, type TelegramSender } from '$lib/server/telegram';
import { pushConfigured, sendWebPush, type PushSender } from '$lib/server/webPush';
import { createNotifier, type Notify } from './notify';
import { defaultAlertDeps, emptyAlertSummary, runHoldingAlerts, runPriceAlerts, type AlertDeps, type AlertSummary } from './alertsJob';
import { runMarketIntel, type MarketSummary } from './marketIntelJob';

/** NSE is asked for the last few days each run; older filings only matter for the company page. */
const POLL_DAYS = 3;
const POLL_CONCURRENCY = 4;
/** LLM calls per run. Whatever is left over is picked up by the next run a minute later. */
const SUMMARIES_PER_RUN = 5;

export interface JobDeps {
	fetchAnnouncements: (symbol: string, days: number) => Promise<ParsedAnnouncement[]>;
	summarise: (a: AnnouncementRow) => Promise<string>;
	send: PushSender;
	sendTelegram: TelegramSender;
	telegramOn: () => boolean;
	summariesOn: () => boolean;
	pushOn: () => boolean;
	now: () => Date;
	intel: IntelDeps;
	alerts: AlertDeps;
	/** Tops up the market-wide NSE feeds (announcements, insider trades, corporate actions) within a time budget. Null (the default, so tests never reach NSE) skips it; the cron route turns it on. */
	marketIntel: ((budgetMs: number) => Promise<MarketSummary>) | null;
	/** Slow best-effort sources (calendar, ...) are skipped once a run is this far in. */
	extrasBudgetMs: number;
}

const defaultDeps: JobDeps = {
	fetchAnnouncements: (symbol, days) => fetchSymbolAnnouncements(symbol, days),
	summarise: (a) => summariseAnnouncement(a),
	send: sendWebPush,
	sendTelegram: sendTelegramMessage,
	telegramOn: telegramConfigured,
	summariesOn: summariesEnabled,
	pushOn: pushConfigured,
	now: () => new Date(),
	intel: defaultIntelDeps,
	alerts: defaultAlertDeps,
	marketIntel: null,
	extrasBudgetMs: 30_000
};

/** What the production poller passes in `marketIntel`. */
export const liveMarketIntel = (budgetMs: number) => runMarketIntel({}, budgetMs);

export interface JobSummary {
	symbols: number;
	fetched: number;
	newAnnouncements: number;
	summarised: number;
	notified: number;
	pushSent: number;
	pushFailed: number;
	telegramSent: number;
	telegramFailed: number;
	subscriptionsRemoved: number;
	/** Pushes skipped because the person only wants important filings and this one is routine. */
	suppressed: number;
	dealsNotified: number;
	intel: IntelSummary;
	alerts: AlertSummary;
	market: MarketSummary | null;
	errors: string[];
}

/**
 * One poll, called every minute by the external scheduler: fetch what tracked companies announced,
 * store anything new, summarise a few, then push each person the filings published after they started
 * tracking that company. Every step tolerates the one before it failing (an announcement is stored
 * and pushed with its raw subject even if the LLM is down).
 */
export async function runAnnouncementCheck(
	overrides: Partial<Omit<JobDeps, 'intel' | 'alerts'>> & { intel?: Partial<IntelDeps>; alerts?: Partial<AlertDeps> } = {}
): Promise<JobSummary> {
	const deps = { ...defaultDeps, ...overrides, intel: { ...defaultIntelDeps, ...overrides.intel }, alerts: { ...defaultAlertDeps, ...overrides.alerts } };
	const now = deps.now();
	const summary: JobSummary = {
		symbols: 0, fetched: 0, newAnnouncements: 0, summarised: 0, notified: 0,
		pushSent: 0, pushFailed: 0, telegramSent: 0, telegramFailed: 0, subscriptionsRemoved: 0, suppressed: 0, dealsNotified: 0, intel: emptyIntelSummary(), alerts: emptyAlertSummary(), market: null, errors: []
	};
	const startedAt = Date.now();

	// Older rows get their tag before anything is pushed (a push title carries it).
	await tagBacklog(summary.intel).catch((err) => summary.errors.push(`tags: ${err instanceof Error ? err.message : String(err)}`));

	const symbols = await distinctTrackedSymbols();
	summary.symbols = symbols.length;

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

	// 3. Push and Telegram. With neither configured nothing is claimed, so the filings go out once one is.
	const notify = makeNotifier(deps, summary);
	const channelsOn = deps.pushOn() || deps.telegramOn();
	if (channelsOn) await deliver(deps, now, summary, summariesOn, notify);

	// 3b. Personal price-level alerts (any stock, not only tracked ones).
	if (channelsOn) {
		await runPriceAlerts(notify, now, summary.alerts, deps.alerts).catch((err) =>
			summary.errors.push(`price alerts: ${err instanceof Error ? err.message : String(err)}`)
		);
	}

	// 4. Best-effort extras; they never delay or break the alerts above.
	if (Date.now() - startedAt < deps.extrasBudgetMs) {
		const guard = (name: string) => (err: unknown) =>
			summary.errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
		await refreshCalendar(deps.intel, now, summary.intel).catch(guard('calendar'));
		await refreshDeals(deps.intel, now, summary.intel).catch(guard('deals'));
		await refreshShareholding(deps.intel, now, summary.intel).catch(guard('shareholding'));
		summary.errors.push(...summary.intel.errors);
		if (channelsOn) await deliverDeals(now, summary, notify).catch(guard('deal alerts'));
		if (channelsOn) await runHoldingAlerts(summary.intel.newHoldingPeriods, notify, summary.alerts).catch(guard('holding alerts'));
		summary.errors.push(...summary.alerts.errors);
		// The market-wide feeds take whatever time is left of the budget (never less than a few seconds).
		if (deps.marketIntel) {
			const left = Math.max(5_000, deps.extrasBudgetMs - (Date.now() - startedAt));
			summary.market = await deps.marketIntel(left).catch((err) => {
				guard('market feeds')(err);
				return null;
			});
			if (summary.market) summary.errors.push(...summary.market.errors);
		}
	}
	return summary;
}

/** Sends one message to a person's devices; counts go straight into the run summary. */
function makeNotifier(deps: JobDeps, summary: JobSummary): Notify {
	return createNotifier(deps, summary).notify;
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
		await notify(p.userId, buildPushPayload(a), a.pdfUrl);
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
