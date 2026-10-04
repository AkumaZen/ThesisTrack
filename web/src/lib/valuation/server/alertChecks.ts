import { getCompanyData } from './companyCache';
import { fetchLtp } from './angelone';
import { isMarketOpenIST } from './marketHours';
import { getSavedValuationRow, listSavedValuationRows } from './savedValuationsStore';
import { listAllBaskets, listAllMajorSectors, getSymbolNames, listAllSymbols } from './sectorStore';
import { getMajorSectorReturn, getSectorReturn } from './sectorRotationCache';
import { getStageScanResult } from './stageScanEngine';
import {
	anyoneWants,
	getThresholds,
	insertAlert,
	loadStates,
	setState,
	type NewAlert
} from './alertStore';
import { notifyByEmail } from './alertNotify';
import { fairValueFromTarget, sideOfFairValue, targetForSaved } from '../fairValue';
import { getAnalysisSettings } from './analysisSettingsStore';
import { detectRsBand, rsBand, rsThresholdMessage } from '../rsThresholds';
import {
	basketSubject,
	detectFairValueCrossing,
	detectNearBreakout,
	detectSectorFlip,
	fairValueMessage,
	nearBreakoutMessage,
	sectorFlipMessage,
	sectorSubject,
	symbolSubject,
	type RotationSignal
} from '../alerts';

export interface CheckSummary {
	scope: 'price' | 'sector' | 'breakout';
	checked: number;
	alerts: number;
	errors: number;
	/** Set when the whole scope was skipped, with the reason. */
	skipped?: string;
}

// One run per scope at a time: the scheduler and a manual "Check now" must never overlap, or
// both could read the same stored state and each raise the same alert.
const running = new Set<string>();

async function exclusive(
	scope: CheckSummary['scope'],
	fn: (summary: CheckSummary) => Promise<void>
): Promise<CheckSummary> {
	const summary: CheckSummary = { scope, checked: 0, alerts: 0, errors: 0 };
	if (running.has(scope)) return { ...summary, skipped: 'A check is already running.' };
	running.add(scope);
	try {
		await fn(summary);
	} finally {
		running.delete(scope);
	}
	return summary;
}

/** Writes an alert (and sends the optional email) unless nobody on the team wants it (everyone
 *  has that type off or the subject muted). Which of them sees it is decided per user when the
 *  feed is read. Callers update stored state either way, so a crossing is never replayed. */
async function raise(alert: NewAlert): Promise<boolean> {
	if (!(await anyoneWants(alert.type, alert.subjectKey))) return false;
	const record = await insertAlert(alert);
	await notifyByEmail(record);
	return true;
}

// ---------------------------------------------------------------------------------------------
// Price vs fair value
// ---------------------------------------------------------------------------------------------

/** Compares each saved valuation's price against its fair value (a set % of the Base-case FY+2E
 *  target). Live prices only exist while the market is open, so scheduled runs skip otherwise;
 *  a manual run (`force`) falls back to the last known CMP. */
export async function runPriceChecks(opts: { force?: boolean } = {}): Promise<CheckSummary> {
	return exclusive('price', async (summary) => {
		if (!(await anyoneWants('price_fair_value'))) {
			summary.skipped = 'Price alerts are turned off for everyone.';
			return;
		}
		const marketOpen = isMarketOpenIST();
		if (!marketOpen && !opts.force) {
			summary.skipped = 'Market is closed.';
			return;
		}

		const states = await loadStates('fv:');
		const { fairValuePct } = (await getAnalysisSettings()).valuation;
		for (const { symbol } of await listSavedValuationRows()) {
			try {
				const record = await getSavedValuationRow(symbol);
				if (!record) continue;
				const { data } = await getCompanyData(symbol);
				const computed = targetForSaved(record, data);
				const fairValue = fairValueFromTarget(computed?.target, fairValuePct);
				if (fairValue == null) continue;

				const live = marketOpen ? await fetchLtp(symbol) : null;
				const price = live ?? data.cmp;
				if (price == null || !(price > 0)) continue;

				summary.checked++;
				const key = `fv:${symbol}`;
				const { next, crossing } = detectFairValueCrossing(
					states.get(key) ?? null,
					sideOfFairValue(price, fairValue)
				);
				await setState(key, next);
				if (crossing) {
					const raised = await raise({
						type: 'price_fair_value',
						subjectKey: symbolSubject(symbol),
						subjectLabel: record.name,
						message: fairValueMessage(crossing, record.name, price, fairValue),
						href: `/company/${symbol}`
					});
					if (raised) summary.alerts++;
				}
			} catch (e) {
				summary.errors++;
				console.error(
					`[alerts] price check for ${symbol} failed:`,
					e instanceof Error ? e.message : e
				);
			}
		}
	});
}

// ---------------------------------------------------------------------------------------------
// Sector rotation flips (major sectors and thematic baskets)
// ---------------------------------------------------------------------------------------------

const isCredentialsError = (e: unknown) =>
	e instanceof Error && e.message.startsWith('ANGEL_CREDENTIALS_MISSING');

/** Relies on the shared candle caches the 2-hourly warmer keeps fresh - on a cold cache this
 *  would pay for real rate-limited Angel One fetches, so the scheduler runs it right after
 *  the warm cycle rather than on its own timer. */
export async function runSectorChecks(): Promise<CheckSummary> {
	return exclusive('sector', async (summary) => {
		if (!(await anyoneWants('sector_rotation'))) {
			summary.skipped = 'Sector alerts are turned off for everyone.';
			return;
		}
		const thresholds = await getThresholds();

		const [majors, baskets, states] = await Promise.all([
			listAllMajorSectors(),
			listAllBaskets(),
			loadStates('sector:')
		]);

		async function evaluate(
			stateKey: string,
			subjectKey: string,
			label: string,
			level: 'sector' | 'basket',
			href: string | null,
			read: () => Promise<{
				signal: RotationSignal;
				rs1w: number | null;
				rs1m: number | null;
			}>
		) {
			const { signal, rs1w, rs1m } = await read();
			summary.checked++;

			// 1) The multi-window momentum flip into Rotating In / Out.
			const { next, flippedTo } = detectSectorFlip(states.get(stateKey) ?? null, signal);
			await setState(stateKey, next);
			if (flippedTo) {
				const raised = await raise({
					type: 'sector_rotation',
					subjectKey,
					subjectLabel: label,
					message: sectorFlipMessage(label, level, flippedTo, rs1m),
					href
				});
				if (raised) summary.alerts++;
			}

			// 2) Short-window strength: weekly (1W) and monthly (1M) relative strength vs Nifty
			//    crossing the configured +/- thresholds. Each window keeps its own state, so a
			//    sector alerts once per crossing and a later re-cross alerts again.
			for (const [window, rs, thresholdPct, suffix] of [
				['weekly', rs1w, thresholds.weeklyPct, 'rsw'],
				['monthly', rs1m, thresholds.monthlyPct, 'rsm']
			] as const) {
				if (rs == null) continue;
				const bandKey = `${stateKey}:${suffix}`;
				const band = detectRsBand(states.get(bandKey) ?? null, rsBand(rs, thresholdPct));
				await setState(bandKey, band.next);
				if (band.entered) {
					const raised = await raise({
						type: 'sector_rotation',
						subjectKey,
						subjectLabel: label,
						message: rsThresholdMessage(label, level, window, band.entered, rs, thresholdPct),
						href
					});
					if (raised) summary.alerts++;
				}
			}
		}

		for (const major of majors) {
			try {
				await evaluate(
					`sector:major:${major.key}`,
					sectorSubject(major.key),
					major.label,
					'sector',
					`/sector-rotation/${major.key}`,
					() => getMajorSectorReturn(major)
				);
			} catch (e) {
				summary.errors++;
				if (isCredentialsError(e)) {
					summary.skipped = 'Angel One credentials are not configured.';
					return;
				}
				console.error(
					`[alerts] sector check ${major.key} failed:`,
					e instanceof Error ? e.message : e
				);
			}
		}

		for (const basket of baskets) {
			// Only baskets that appear on a Sector Rotation page (assigned to a major) are checked.
			const parent = majors.find((m) => m.subsectorKeys.includes(basket.key));
			if (!parent) continue;
			try {
				await evaluate(
					`sector:basket:${basket.key}`,
					basketSubject(basket.key),
					basket.label,
					'basket',
					`/sector-rotation/${parent.key}/${basket.key}`,
					() => getSectorReturn(basket)
				);
			} catch (e) {
				summary.errors++;
				if (isCredentialsError(e)) {
					summary.skipped = 'Angel One credentials are not configured.';
					return;
				}
				console.error(
					`[alerts] basket check ${basket.key} failed:`,
					e instanceof Error ? e.message : e
				);
			}
		}
	});
}

// ---------------------------------------------------------------------------------------------
// Entering Near Stage 2 Breakout
// ---------------------------------------------------------------------------------------------

/** Structural stage only (allowLive: false) across the whole scan universe - from the candle
 *  caches the warmer already keeps fresh, so a warm pass costs no Angel One calls. */
export async function runBreakoutChecks(): Promise<CheckSummary> {
	return exclusive('breakout', async (summary) => {
		if (!(await anyoneWants('near_breakout'))) {
			summary.skipped = 'Breakout alerts are turned off for everyone.';
			return;
		}

		const [symbols, states] = await Promise.all([listAllSymbols(), loadStates('stage:')]);
		const names = await getSymbolNames(symbols);

		for (const symbol of symbols) {
			try {
				const result = await getStageScanResult(symbol, { allowLive: false });
				if (!result) continue;
				summary.checked++;

				const key = `stage:${symbol}`;
				const prev = states.get(key) ?? null;
				const { next, entered } = detectNearBreakout(prev, result.stage);
				await setState(key, next);
				if (entered) {
					const name = names[symbol] ?? symbol;
					const raised = await raise({
						type: 'near_breakout',
						subjectKey: symbolSubject(symbol),
						subjectLabel: name,
						message: nearBreakoutMessage(name, prev, result.distanceToBreakoutPct),
						href: `/company/${symbol}`
					});
					if (raised) summary.alerts++;
				}
			} catch (e) {
				summary.errors++;
				if (isCredentialsError(e)) {
					summary.skipped = 'Angel One credentials are not configured.';
					return;
				}
				console.error(
					`[alerts] breakout check ${symbol} failed:`,
					e instanceof Error ? e.message : e
				);
			}
		}
	});
}

/** Sector flips and breakouts both read the same warmed candle caches. */
export async function runStructuralChecks(): Promise<CheckSummary[]> {
	const sector = await runSectorChecks();
	const breakout = await runBreakoutChecks();
	return [sector, breakout];
}
