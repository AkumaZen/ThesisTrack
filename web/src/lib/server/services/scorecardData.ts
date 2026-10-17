// Gathers what the Scorecard needs from the database and hands it to the pure maths in
// $lib/scorecard.ts. STORED prices only: never Angel One (the Nifty history is read straight from
// its table instead of getBenchmarkCandles, which would fetch when empty).
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import {
	broadIndustries,
	companies,
	killTriggers,
	positionDecisions,
	thesisScenarios,
	thesisVersions,
	triggerEvaluations
} from '../db/schema';
import { benchmarkSeriesCache } from '../db/valuationSchema';
import { readCachedCloses } from '$lib/valuation/server/companyGrowthSeries';
import { latestClose } from '$lib/entryPrice.js';
import { computeScorecard, type ScorecardInput, type Series } from '$lib/scorecard';
import { priceSymbol } from './entryPrice';

async function storedNifty(): Promise<Series | null> {
	const [row] = await db
		.select({
			dates: sql<string[]>`jsonb_path_query_array(${benchmarkSeriesCache.candles}, '$[*].date')`,
			closes: sql<number[]>`jsonb_path_query_array(${benchmarkSeriesCache.candles}, '$[*].close')`
		})
		.from(benchmarkSeriesCache)
		.where(eq(benchmarkSeriesCache.id, 'nifty50'));
	return row ? { dates: row.dates.map((d) => String(d).slice(0, 10)), closes: row.closes } : null;
}

export async function buildScorecard() {
	const scenarios = await db
		.select({ s: thesisScenarios, c: companies, sector: broadIndustries.name })
		.from(thesisScenarios)
		.innerJoin(companies, eq(companies.companyId, thesisScenarios.companyId))
		.innerJoin(broadIndustries, eq(broadIndustries.id, companies.broadIndustryId));
	const ids = scenarios.map((r) => r.s.id);

	// Only real theses: the dashboard hides thin placeholder scenarios, so require a current version.
	const withVersion = scenarios.filter((r) => r.s.currentVersionId != null);

	const sells = ids.length
		? await db
				.select({ scenarioId: positionDecisions.scenarioId, price: positionDecisions.price })
				.from(positionDecisions)
				.where(sql`${positionDecisions.action} = 'sell' and ${inArray(positionDecisions.scenarioId, ids)}`)
				.orderBy(positionDecisions.decidedOn, positionDecisions.id)
		: [];
	const lastSell = new Map<number, number>();
	for (const d of sells) lastSell.set(d.scenarioId, Number(d.price)); // ascending, so the last write is the newest

	const fired = ids.length
		? await db
				.selectDistinct({ scenarioId: thesisVersions.scenarioId })
				.from(triggerEvaluations)
				.innerJoin(killTriggers, eq(killTriggers.id, triggerEvaluations.triggerId))
				.innerJoin(thesisVersions, eq(thesisVersions.versionId, killTriggers.versionId))
				.where(sql`${triggerEvaluations.fired} and ${killTriggers.severity} = 'kill' and ${inArray(thesisVersions.scenarioId, ids)}`)
		: [];
	const killed = new Set(fired.map((f) => f.scenarioId));

	const symbols = withVersion.map((r) => priceSymbol(r.c)).filter((s): s is string => !!s);
	const closes = await readCachedCloses(symbols);

	const inputs: ScorecardInput[] = withVersion.map(({ s, c, sector }) => {
		const sym = priceSymbol(c);
		const series = sym ? closes.get(sym) : undefined;
		return {
			id: s.id,
			companyId: c.companyId,
			companyName: c.name,
			sector,
			owner: s.owner,
			conviction: s.conviction,
			outcome: s.outcome,
			entryDate: s.entryDate,
			entryPrice: s.entryPrice != null ? Number(s.entryPrice) : null,
			needsPrice: s.needsPrice,
			entryPriceSource: s.entryPriceSource,
			exitDate: s.exitDate,
			sellPrice: lastSell.get(s.id) ?? null,
			current: series ? latestClose(series.dates, series.closes) : null,
			series: series ? { dates: series.dates.map((d) => String(d).slice(0, 10)), closes: series.closes } : null,
			killFired: killed.has(s.id),
			lesson: s.lesson
		};
	});
	return computeScorecard(inputs, await storedNifty());
}
