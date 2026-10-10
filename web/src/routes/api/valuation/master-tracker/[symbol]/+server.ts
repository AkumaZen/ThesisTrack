import { json, error, isHttpError } from '@sveltejs/kit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { acceptPreview, analyseSchema, guidanceSchema, modelSchema, type Preview } from '$lib/valuation/masterTracker';
import { analyseResearch, loadResearch, TrackerProviderError } from '$lib/valuation/server/masterTrackerProvider';
import { getTrackerCompany, getTrackerPreview, getTrackerResearch, saveTrackerResearch, saveTrackerPreview, updateTrackerCompany, discardTrackerPreview, TrackerConflict } from '$lib/valuation/server/masterTrackerStore';
import type { RequestHandler } from './$types';
import type { TrackerProgress } from '$lib/valuation/trackerProgress';
import { getSavedValuationRow } from '$lib/valuation/server/savedValuationsStore';

export const config = { maxDuration: 300 };
const busy = new Set<string>();
const postSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('edit-model'), baseVersion: z.number().int() }),
	z.object({ action: z.literal('quarters'), refresh: z.boolean().default(false) }),
	z.object({ action: z.literal('analyse'), ...analyseSchema.shape }),
	z.object({ action: z.literal('accept'), previewId: z.string().uuid(), accepted: z.array(z.string()).max(150), valuation: z.boolean(), edited: z.array(guidanceSchema).max(150).default([]), editedModel: modelSchema.optional(), acknowledgeManual: z.boolean().default(false) }),
	z.object({ action: z.literal('reject'), previewId: z.string().uuid() }),
	z.object({ action: z.literal('edit'), baseVersion: z.number().int(), itemId: z.string(), commitment: z.string().min(1).max(2000), status: guidanceSchema.shape.status, actual: z.string().max(2000), explanation: z.string().min(1).max(3000) }),
	z.object({ action: z.literal('identity'), baseVersion: z.number().int(), bseCode: z.string().regex(/^\d{6}$/) })
]);

export const POST: RequestHandler = async ({ request, params, locals }) => {
	const parsed = postSchema.safeParse(await request.json());
	if (!parsed.success) error(400, 'Invalid tracker request. Check the selected quarters and required fields.');
	const body = parsed.data;
	const company = await getTrackerCompany(params.symbol);
	if (!company) error(404, 'Company is not in the Master Tracker.');
	try {
		if (body.action === 'edit-model') {
			if (body.baseVersion !== company.version) throw new TrackerConflict();
			if (!company.valuation) error(400, 'There is no accepted valuation to edit.');
			const preview: Preview = { id: randomUUID(), symbol: company.symbol, userId: locals.user!.id, baseVersion: company.version, quarters: [], createdAt: Date.now(),
				analysis: { guidance: [], valuation: company.valuation, warnings: [], summary: 'Review and edit the accepted valuation. Saving preserves its earlier version.' }, watchlistBaseVersion: (await getSavedValuationRow(company.symbol))?.version ?? 0 };
			await saveTrackerPreview(preview); return json({ preview });
		}
		if (body.action === 'identity') {
			await updateTrackerCompany({ ...company, bseCode: body.bseCode, version: company.version + 1, updatedAt: Date.now(), updatedBy: locals.user!.username }, body.baseVersion);
			return json({ ok: true });
		}
		if (body.action === 'quarters' || body.action === 'analyse') {
			const lock = `${locals.user!.id}:${company.symbol}`;
			if (busy.has(lock)) error(429, 'Research is already running for this company.');
			busy.add(lock);
			const run = async (progress?: TrackerProgress) => { try {
				progress?.('financials');
				const selected = body.action === 'analyse' ? [...new Set(body.quarters)].sort() : [];
				const key = `${company.symbol}:${selected.join(',') || 'periods'}`;
				let research = body.refresh ? null : await getTrackerResearch(key);
				// Reuse documents; refresh results/CMP after a day or on explicit refresh.
				if (!research || Date.now() - research.fetchedAt > 86400000) {
					research = await loadResearch(company, selected, body.refresh, progress);
					await saveTrackerResearch(key, company.symbol, research);
				} else if (selected.length) progress?.('documents');
				if (JSON.stringify(company.quarters) !== JSON.stringify(research.quarters) || (!company.bseCode && research.bseCode)) {
					const next = { ...company, quarters: research.quarters, bseCode: company.bseCode ?? research.bseCode ?? null, version: company.version + 1 };
					await updateTrackerCompany(next, company.version); Object.assign(company, next);
				}
				if (body.action === 'quarters') return { quarters: research.quarters, warnings: research.warnings, fetchedAt: research.fetchedAt };
				const watchlistBaseVersion = body.valuation ? (await getSavedValuationRow(company.symbol))?.version ?? 0 : undefined;
				const analysis = await analyseResearch(company, research, selected, body.valuation, body.method, progress);
				progress?.('draft');
				const preview: Preview = { id: randomUUID(), symbol: company.symbol, userId: locals.user!.id, baseVersion: company.version, quarters: selected, analysis, createdAt: Date.now(), valuationRequested: body.valuation, requestedMethod: body.method, watchlistBaseVersion };
				await saveTrackerPreview(preview);
				return { preview };
			} finally { busy.delete(lock); } };
			if (body.action === 'analyse' && request.headers.get('accept') === 'application/x-ndjson') {
				const encoder = new TextEncoder();
				let disconnected = false;
				return new Response(new ReadableStream({
					start(controller) {
						const send = (frame: unknown) => { if (!disconnected) controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n')); };
						void run((step) => send({ type: 'progress', step })).then((result) => send({ type: 'result', ...result })).catch((e) => {
							send({ type: 'error', message: e instanceof TrackerProviderError || e instanceof TrackerConflict ? e.message : isHttpError(e) ? e.body.message : 'Analysis could not be completed. Retry; no accepted work was changed.' });
						}).finally(() => { if (!disconnected) controller.close(); });
					},
					cancel() { disconnected = true; }
				}), { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
			}
			return json(await run());
		}
		if (body.action === 'edit') {
			const g = company.guidance.find((g) => g.id === body.itemId);
			if (!g) error(404, 'Guidance item not found.');
			if (['Met', 'Beat', 'Miss'].includes(body.status) && !body.actual.trim()) error(400, 'Enter the reported actual before marking execution.');
			const item = { ...g, id: randomUUID(), previousId: g.id, commitment: body.commitment, status: body.status, actual: body.actual, explanation: body.explanation, origin: 'Manual' as const, manual: true, recordedAt: Date.now() };
			await updateTrackerCompany({ ...company, guidance: [...company.guidance, item], version: company.version + 1, updatedBy: locals.user!.username, updatedAt: Date.now() }, body.baseVersion);
			return json({ ok: true });
		}
		const preview = await getTrackerPreview(body.previewId, locals.user!.id);
		if (!preview || preview.symbol !== company.symbol) error(404, 'Preview not found.');
		if (body.action === 'reject') { await discardTrackerPreview(preview.id, locals.user!.id); return json({ ok: true }); }
		const touchesManual = preview.analysis.guidance.some((g) => body.accepted.includes(g.id) && company.guidance.find((old) => old.id === g.previousId)?.manual) || (body.valuation && company.valuation?.manual);
		if (touchesManual && !body.acknowledgeManual) error(409, 'Review and acknowledge the proposed changes to manually edited work.');
		if (body.editedModel && (!body.valuation || !preview.analysis.valuation)) error(400, 'There is no valuation to edit.');
		if (body.editedModel && body.editedModel.history.some((y, i) => {
			const original = preview.analysis.valuation!.history[i];
			return y.endDate !== original.endDate || y.label !== original.label || JSON.stringify(y.sources) !== JSON.stringify(original.sources);
		})) error(400, 'Historical edits cannot change periods or source references.');
		if (body.editedModel && Object.entries(body.editedModel.scenarios).some(([s, years]) => years.some((y, i) => JSON.stringify(y.sources) !== JSON.stringify(preview.analysis.valuation!.scenarios[s as 'bear' | 'base' | 'bull'][i].sources)))) error(400, 'Scenario edits cannot change source references.');
		const editedModel = body.editedModel ? { ...body.editedModel, manual: true } : undefined;
		if (editedModel?.history.some((y) => Math.abs(y.pbt - y.tax - y.netProfit) > 1)) editedModel.caveats = [...editedModel.caveats, 'Manual figures need review: historical PBT minus tax does not match net profit. This model was saved for manual review.'];
		const next = acceptPreview(company, preview, body.accepted, body.valuation, locals.user!.username, body.edited, editedModel);
		await updateTrackerCompany(next, company.version, preview, body.valuation);
		return json({ ok: true });
	} catch (e) {
		if (e instanceof TrackerProviderError) error(503, e.message);
		if (e instanceof TrackerConflict) error(409, e.message);
		if (e instanceof Error && /Select guidance|This company changed|preview items|history links|no valuation|selected/.test(e.message)) error(409, e.message);
		if (e instanceof Error && /reported actual/.test(e.message)) error(400, e.message);
		throw e;
	}
};
