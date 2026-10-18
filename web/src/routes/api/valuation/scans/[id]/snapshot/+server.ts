import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isScanId } from '$lib/valuation/savedScans';
import { getScan } from '$lib/valuation/server/savedScanStore';
import { snapshotOne } from '$lib/valuation/server/scanSnapshotJob';

// Stores today's snapshot of one of your scans from the stored scan results (no alerts are sent).
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!isScanId(params.id)) error(404, 'No such scan.');
	const scan = await getScan(params.id);
	if (!scan || scan.ownerId !== locals.user!.id) error(404, 'No such scan of yours.');
	const snapshot = await snapshotOne(scan);
	if (!snapshot) error(409, 'The scanner has no stored results yet. Open the breakout scanner first.');
	return json(snapshot);
};
