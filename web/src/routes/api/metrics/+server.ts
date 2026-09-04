// Ports GET /api/metrics from app/routers/taxonomy.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { asc, isNull, or, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { metricDefinitions } from '$lib/server/db/schema';
import { requireActor, handleAuthError } from '$lib/server/http';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		requireActor(locals.actor);
		const operatingModel = url.searchParams.get('operating_model');
		const query = db
			.select()
			.from(metricDefinitions)
			.orderBy(asc(metricDefinitions.sortOrder), asc(metricDefinitions.label));
		const rows = await (operatingModel
			? query.where(or(eq(metricDefinitions.operatingModel, operatingModel as never), isNull(metricDefinitions.operatingModel)))
			: query);
		return json(
			rows.map((m) => ({
				metric_key: m.metricKey,
				label: m.label,
				operating_model: m.operatingModel,
				unit: m.unit,
				higher_is_better: m.higherIsBetter,
				is_core: m.isCore
			}))
		);
	} catch (err) {
		return handleAuthError(err);
	}
};
