// The app's background runs (see backgroundRun.svelte.ts), one per job, shared by every panel that
// shows it, so the same job is never started twice.
import { getRun } from './backgroundRun.svelte';
import { BATCH_SIZE, batchSteps, buildSteps, forgetSectorCards, type RefreshPlan, type StepResult } from './refreshAll';
import { HISTORY_BATCH_SIZE, historySteps, newlyLoaded } from './historyLoad';

async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(String(res.status));
	return (await res.json()) as T;
}

/** Refresh all sectors: the Nifty 50, then every company sector by sector. */
export const refreshAllRun = () =>
	getRun('refresh-all-sectors', () => ({
		title: 'Refreshing all sectors',
		href: '/valuation/sector-rotation',
		retrySize: BATCH_SIZE,
		plan: async () => buildSteps(await getJson<RefreshPlan>('/api/valuation/sector-refresh-plan')),
		// New prices change every chart and sector figure built from them.
		afterRun: async () => forgetSectorCards()
	}));

const fetchMissingHistory = async () =>
	(await getJson<{ symbols: string[] }>('/api/valuation/mcap-universe/missing-history')).symbols;
let plannedHistory: string[] = [];

/** Load missing history: the market cap list's companies with no stored prices. Listeners get the
 *  tickers that now have history. */
export const historyRun = () =>
	getRun<string[]>('load-missing-history', () => ({
		title: 'Loading price history',
		href: '/valuation/stage-scanner',
		retrySize: HISTORY_BATCH_SIZE,
		plan: async () => {
			plannedHistory = await fetchMissingHistory();
			return historySteps(plannedHistory);
		},
		afterRun: async () => {
			forgetSectorCards();
			return newlyLoaded(plannedHistory, await fetchMissingHistory());
		}
	}));

export interface BatchLoadJob {
	/** "Loading financial statements". */
	title: string;
	href: string;
	/** GET -> { symbols: string[] } of what is missing. */
	missingUrl: string;
	/** POST { symbols } -> { ok: number, failed: { symbol, error }[] }. */
	batchUrl: string;
	batchSize: number;
}

/** A "load what is missing" job (Screener financials, 5-year highs), one per batch endpoint. */
export const batchLoadRun = (job: BatchLoadJob) =>
	getRun(`batch:${job.batchUrl}`, () => ({
		title: job.title,
		href: job.href,
		retrySize: job.batchSize,
		plan: async () => {
			const { symbols } = await getJson<{ symbols: string[] }>(job.missingUrl);
			return batchSteps(
				symbols.map((symbol) => ({ symbol, sector: '' })),
				job.batchSize
			);
		},
		send: (step) => sendBatchLoad(job.batchUrl, step.symbols ?? [])
	}));

/** One batch of a "load what is missing" job. A whole-request failure fails every company in it. */
export async function sendBatchLoad(batchUrl: string, symbols: string[]): Promise<StepResult> {
	try {
		const res = await fetch(batchUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ symbols })
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = (await res.json()) as { ok: number; failed: { symbol: string; error: string }[] };
		return {
			ok: body.ok,
			unlisted: 0,
			failed: body.failed.map((f) => f.symbol),
			errors: Object.fromEntries(body.failed.map((f) => [f.symbol, f.error]))
		};
	} catch (e) {
		const message = e instanceof Error ? e.message : 'request failed';
		return { ok: 0, unlisted: 0, failed: [...symbols], errors: Object.fromEntries(symbols.map((s) => [s, message])) };
	}
}
