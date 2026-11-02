import { json } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { thesisImages } from '$lib/server/db/schema';
import { getMyScenario, NotFoundError, ScenarioNotFoundError } from '$lib/server/services/scenarios';
import { requireActor, requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { imageDetailsSchema, validImageData } from '$lib/thesisImages';

const metadata = { id: thesisImages.id, title: thesisImages.title, category: thesisImages.category,
	caption: thesisImages.caption, sourceUrl: thesisImages.sourceUrl, createdAt: thesisImages.createdAt };
function fail(err: unknown) {
	if (err instanceof NotFoundError || err instanceof ScenarioNotFoundError) return errorResponse(404, err.message);
	if (err instanceof SyntaxError) return errorResponse(400, 'Invalid request.');
	return handleAuthError(err);
}
const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		const actor = requireActor(locals.actor);
		const scenario = await getMyScenario(params.id!, url.searchParams.get('owner') || actor.identity);
		const id = url.searchParams.get('image');
		if (id !== null) {
			const parsed = idSchema.safeParse(id);
			if (!parsed.success) return errorResponse(400, 'Invalid image ID.');
			const [image] = await db.select({ data: thesisImages.imageData }).from(thesisImages)
				.where(and(eq(thesisImages.scenarioId, scenario.id), eq(thesisImages.id, parsed.data))).limit(1);
			if (!image) return errorResponse(404, 'Image not found.');
			const [header, data] = image.data.split(',');
			return new Response(Buffer.from(data, 'base64'), { headers: {
				'Content-Type': header.slice(5, -7), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'
			} });
		}
		return json(await db.select(metadata).from(thesisImages).where(eq(thesisImages.scenarioId, scenario.id)).orderBy(desc(thesisImages.createdAt), desc(thesisImages.id)));
	} catch (err) { return fail(err); }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const scenario = await getMyScenario(params.id!, actor.identity);
		// Cap the body even when a client omits Content-Length.
		const reader = request.body?.getReader();
		if (!reader) return errorResponse(400, 'Choose an image.');
		const chunks: Uint8Array[] = []; let size = 0;
		while (true) {
			const { done, value } = await reader.read(); if (done) break;
			size += value.length;
			// Drain an oversized request without retaining it, keeping the connection usable.
			if (size > 1_420_000) continue;
			chunks.push(value);
		}
		if (size > 1_420_000) return errorResponse(413, 'Image is too large. Choose a smaller image.');
		const parsed = imageDetailsSchema.extend({ imageData: z.string().refine(validImageData, 'Choose a valid PNG, JPEG or WebP image under 1 MB.') }).safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));
		// Serialize uploads per thesis to enforce a bounded database footprint (100 images).
		const image = await db.transaction(async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(${scenario.id}::bigint)`);
			const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(thesisImages).where(eq(thesisImages.scenarioId, scenario.id));
			if (count >= 100) return null;
			const [row] = await tx.insert(thesisImages).values({ scenarioId: scenario.id, ...parsed.data }).returning(metadata);
			return row;
		});
		return image ? json(image, { status: 201 }) : errorResponse(409, 'This thesis has 100 images. Remove an image before adding another.');
	} catch (err) { return fail(err); }
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const scenario = await getMyScenario(params.id!, actor.identity);
		const parsed = imageDetailsSchema.extend({ id: idSchema }).safeParse(await request.json());
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));
		const { id, ...details } = parsed.data;
		const [image] = await db.update(thesisImages).set(details).where(and(eq(thesisImages.id, id), eq(thesisImages.scenarioId, scenario.id))).returning(metadata);
		return image ? json(image) : errorResponse(404, 'Image not found in your thesis.');
	} catch (err) { return fail(err); }
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const scenario = await getMyScenario(params.id!, actor.identity);
		const parsed = z.object({ id: idSchema }).safeParse(await request.json());
		if (!parsed.success) return errorResponse(422, 'Invalid image ID.');
		const [image] = await db.delete(thesisImages).where(and(eq(thesisImages.id, parsed.data.id), eq(thesisImages.scenarioId, scenario.id))).returning({ id: thesisImages.id });
		return image ? json({ deleted: true }) : errorResponse(404, 'Image not found in your thesis.');
	} catch (err) { return fail(err); }
};
