// Ports app/services/price_performance.py.
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { db } from '../db';
import { companies, positionDecisions, priceObservations, thesisScenarios } from '../db/schema';
import { getScenarioOptional } from './scenarios';

export class NotFoundError extends Error {}

export async function logPrice(companyId: string, observedOn: string, price: number, actor: string) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const [row] = await db
		.insert(priceObservations)
		.values({ companyId, observedOn, price: String(price), source: 'manual', actor })
		.onConflictDoUpdate({
			target: [priceObservations.companyId, priceObservations.observedOn],
			set: { price: String(price), actor }
		})
		.returning({ id: priceObservations.id });

	const [full] = await db.select().from(priceObservations).where(eq(priceObservations.id, row.id)).limit(1);
	return full;
}

export async function listPrices(companyId: string) {
	return db
		.select()
		.from(priceObservations)
		.where(eq(priceObservations.companyId, companyId))
		.orderBy(asc(priceObservations.observedOn));
}

async function latestPrice(companyId: string) {
	const [row] = await db
		.select()
		.from(priceObservations)
		.where(eq(priceObservations.companyId, companyId))
		.orderBy(desc(priceObservations.observedOn))
		.limit(1);
	return row ?? null;
}

async function thesisBaseline(
	scenario: typeof thesisScenarios.$inferSelect
): Promise<[string | null, number | null, string | null]> {
	const [onOrAfter] = await db
		.select()
		.from(priceObservations)
		.where(and(eq(priceObservations.companyId, scenario.companyId), gte(priceObservations.observedOn, scenario.lastReviewed)))
		.orderBy(asc(priceObservations.observedOn))
		.limit(1);
	if (onOrAfter) return [onOrAfter.observedOn, Number(onOrAfter.price), null];

	const allPrices = await listPrices(scenario.companyId);
	if (!allPrices.length) return [null, null, 'No price data logged yet.'];

	const lastReviewedMs = new Date(scenario.lastReviewed).getTime();
	let nearest = allPrices[0];
	let nearestDiff = Math.abs(new Date(nearest.observedOn).getTime() - lastReviewedMs);
	for (const p of allPrices) {
		const diff = Math.abs(new Date(p.observedOn).getTime() - lastReviewedMs);
		if (diff < nearestDiff) {
			nearest = p;
			nearestDiff = diff;
		}
	}
	return [
		nearest.observedOn,
		Number(nearest.price),
		`No price logged on/after the thesis's last-reviewed date (${scenario.lastReviewed}) - using the nearest available price instead.`
	];
}

async function decisionBaseline(
	companyId: string,
	actor: string
): Promise<[string | null, number | null, string | null]> {
	const [firstBuy] = await db
		.select()
		.from(positionDecisions)
		.where(
			and(
				eq(positionDecisions.companyId, companyId),
				eq(positionDecisions.actor, actor),
				eq(positionDecisions.action, 'buy')
			)
		)
		.orderBy(asc(positionDecisions.decidedOn))
		.limit(1);
	if (!firstBuy) return [null, null, 'No buy decisions logged yet.'];
	return [firstBuy.decidedOn, Number(firstBuy.price), null];
}

export async function computePerformance(companyId: string, baselineMode: 'thesis' | 'decision', actor: string) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const latest = await latestPrice(companyId);
	const currentDate = latest ? latest.observedOn : null;
	const currentPrice = latest ? Number(latest.price) : null;

	const scenario = await getScenarioOptional(companyId, actor);
	if (!scenario) {
		return {
			baseline_mode: baselineMode,
			baseline_date: null,
			baseline_price: null,
			current_date: currentDate,
			current_price: currentPrice,
			pct_change: null,
			currency: company.currency,
			note: "You haven't started a thesis on this company yet."
		};
	}

	let baselineDate: string | null;
	let baselinePrice: number | null;
	let note: string | null;
	if (baselineMode === 'thesis') {
		[baselineDate, baselinePrice, note] = await thesisBaseline(scenario);
	} else {
		[baselineDate, baselinePrice, note] = await decisionBaseline(companyId, actor);
	}

	if (currentPrice === null) {
		note = !note ? 'No price data logged yet.' : note;
	}

	let pctChange: number | null = null;
	if (baselinePrice !== null && currentPrice !== null) {
		pctChange = ((currentPrice - baselinePrice) / baselinePrice) * 100;
	}

	return {
		baseline_mode: baselineMode,
		baseline_date: baselineDate,
		baseline_price: baselinePrice,
		current_date: currentDate,
		current_price: currentPrice,
		pct_change: pctChange,
		currency: company.currency,
		note
	};
}
