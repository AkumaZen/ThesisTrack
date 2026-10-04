import { runPriceChecks } from './alertChecks';

// Price vs fair value is the only check that needs live prices, so it runs on its own timer
// (and skips itself outside market hours). Sector flips and breakouts read the shared candle
// caches and so run right after each cache warm instead - see sectorRotationScheduler.ts.
const PRICE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
// Let the dev server finish starting before the first pass touches Screener / Angel One.
const FIRST_RUN_DELAY_MS = 60 * 1000;

async function priceCheck() {
	try {
		const summary = await runPriceChecks();
		if (summary.alerts > 0 || summary.errors > 0) {
			console.log(
				`[alerts] price check: ${summary.checked} checked, ${summary.alerts} alert(s), ${summary.errors} error(s)`
			);
		}
	} catch (e) {
		console.error('[alerts] price check failed:', e);
	}
}

/** Safe to call more than once (e.g. across a dev-server HMR reload) - only the first call
 *  schedules anything, same guard as the sector-rotation scheduler. */
export function startAlertScheduler() {
	const g = globalThis as unknown as { __alertSchedulerStarted?: boolean };
	if (g.__alertSchedulerStarted) return;
	g.__alertSchedulerStarted = true;
	console.log('[alerts] scheduler started: price checks every 10 min during market hours');

	setTimeout(priceCheck, FIRST_RUN_DELAY_MS);
	setInterval(priceCheck, PRICE_CHECK_INTERVAL_MS);
}
