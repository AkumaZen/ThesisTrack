import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cleanScanName, isScanId } from '$lib/valuation/savedScans';
import { deleteScan, updateScan } from '$lib/valuation/server/savedScanStore';

/** Body: { name?, notify? }. Only the owner may change a scan. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!isScanId(params.id)) error(404, 'No such scan.');
	const body = (await request.json().catch(() => null)) as { name?: unknown; notify?: unknown } | null;
	if (!body || typeof body !== 'object') error(400, 'Expected a JSON object.');
	const patch: { name?: string; notify?: boolean } = {};
	if (body.name !== undefined) {
		const name = cleanScanName(body.name);
		if (!name) error(400, 'Give the scan a name.');
		patch.name = name;
	}
	if (body.notify !== undefined) {
		if (typeof body.notify !== 'boolean') error(400, '"notify" must be true or false.');
		patch.notify = body.notify;
	}
	if (Object.keys(patch).length === 0) error(400, 'Nothing to change.');
	if (!(await updateScan(params.id, locals.user!.id, patch))) error(404, 'No such scan of yours.');
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!isScanId(params.id)) error(404, 'No such scan.');
	if (!(await deleteScan(params.id, locals.user!.id))) error(404, 'No such scan of yours.');
	return json({ ok: true });
};
