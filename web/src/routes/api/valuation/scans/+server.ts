import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cleanScanName, MAX_SCANS_PER_USER, parseScanConfig } from '$lib/valuation/savedScans';
import { countScans, createScan, getScan, listScans } from '$lib/valuation/server/savedScanStore';
import { snapshotOne } from '$lib/valuation/server/scanSnapshotJob';

// A person's own saved scans. Writes are refused for read-only accounts by the access policy.
export const GET: RequestHandler = async ({ locals }) => json({ scans: await listScans(locals.user!.id) });

/** Body: { name, config, notify? }. The first snapshot is stored at once so the new scan shows its matches. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as { name?: unknown; config?: unknown; notify?: unknown } | null;
	if (!body || typeof body !== 'object') error(400, 'Expected a JSON object.');
	const name = cleanScanName(body.name);
	if (!name) error(400, 'Give the scan a name.');
	const config = parseScanConfig(body.config);
	if (!config) error(400, 'The scan filters are not valid.');
	const owner = locals.user!.id;
	if ((await countScans(owner)) >= MAX_SCANS_PER_USER) error(409, `You can keep ${MAX_SCANS_PER_USER} saved scans. Delete one first.`);
	const id = await createScan(owner, name, config, body.notify === true);
	const scan = await getScan(id);
	const snapshot = scan ? await snapshotOne(scan).catch(() => null) : null;
	return json({ id, snapshot }, { status: 201 });
};
