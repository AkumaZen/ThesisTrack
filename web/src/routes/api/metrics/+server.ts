// Ports GET /api/metrics from app/routers/taxonomy.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { asc, isNull, or, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { metricDefinitions } from '$lib/server/db/schema';
import { requireActor, handleAuthError } from '$lib/server/http';
import { requireWriteActor, errorResponse, zodErrorMessage } from '$lib/server/http';
import { createMetricSchema } from '$lib/server/schemas/metric';

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

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		requireWriteActor(locals.actor);
		const parsed = createMetricSchema.safeParse(await request.json());
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));
		const value = parsed.data;
		const [existing] = await db
			.select()
			.from(metricDefinitions)
			.where(eq(metricDefinitions.metricKey, value.metric_key))
			.limit(1);
		if (existing) return errorResponse(409, `metric '${value.metric_key}' already exists`);
		const [created] = await db
			.insert(metricDefinitions)
			.values({
				metricKey: value.metric_key,
				label: value.label,
				unit: value.unit,
				operatingModel: value.operating_model,
				higherIsBetter: value.higher_is_better,
				helpText: value.help_text,
				isCore: false
			})
			.returning();
		return json({
			metric_key: created.metricKey,
			label: created.label,
			unit: created.unit,
			operating_model: created.operatingModel,
			higher_is_better: created.higherIsBetter,
			is_core: created.isCore
		}, { status: 201 });
	} catch (err) {
		return handleAuthError(err);
	}
};
