// Ports app/routers/observations.py's service portion.
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { companies, metricDefinitions, observations } from '../db/schema';
import { NotFoundError } from './scenarios';
import { evaluateObservations } from './ruleEngine';

export class UnknownMetricError extends Error {}

export interface ObservationIn {
	metric_key: string;
	numeric_value?: number | null;
	text_value?: string | null;
	source_type?: string | null;
	source_url?: string | null;
	note?: string | null;
}

export async function postObservations(
	companyId: string,
	period: string,
	periodEnd: string,
	items: ObservationIn[],
	actorIdentity: string
) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const keys = [...new Set(items.map((o) => o.metric_key))];
	const knownRows = await db
		.select({ metricKey: metricDefinitions.metricKey })
		.from(metricDefinitions)
		.where(inArray(metricDefinitions.metricKey, keys));
	const known = new Set(knownRows.map((r) => r.metricKey));
	const unknown = keys.filter((k) => !known.has(k));
	if (unknown.length) {
		throw new UnknownMetricError(`unknown metric_key(s): ${JSON.stringify(unknown.sort())}`);
	}

	const written: number[] = [];
	for (const obs of items) {
		const [row] = await db
			.insert(observations)
			.values({
				companyId,
				period,
				periodEnd,
				metricKey: obs.metric_key,
				numericValue: obs.numeric_value != null ? String(obs.numeric_value) : null,
				textValue: obs.text_value ?? null,
				sourceType: obs.source_type ?? null,
				sourceUrl: obs.source_url ?? null,
				note: obs.note ?? null,
				ingestedBy: actorIdentity
			})
			.onConflictDoUpdate({
				target: [observations.companyId, observations.period, observations.metricKey],
				set: {
					numericValue: obs.numeric_value != null ? String(obs.numeric_value) : null,
					textValue: obs.text_value ?? null,
					sourceType: obs.source_type ?? null,
					sourceUrl: obs.source_url ?? null,
					note: obs.note ?? null,
					ingestedBy: actorIdentity
				}
			})
			.returning({ id: observations.id });
		written.push(row.id);
	}

	const proposals = await evaluateObservations(companyId, period);

	return {
		period,
		observation_ids: written,
		count: written.length,
		proposals: proposals.map((p) => ({
			id: p.id,
			proposed_status: p.proposedStatus,
			source: p.source,
			rationale: p.rationale,
			evidence: p.evidence
		}))
	};
}
