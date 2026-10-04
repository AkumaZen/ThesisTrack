import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { restoreValuationVersion } from '$lib/server/savedValuationsStore';

/** Body: { versionId, baseVersion? }. Makes that version current again (as a new version). With
 *  baseVersion, refused with 409 + the current record if someone saved since. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = (await request.json().catch(() => null)) as {
		versionId?: unknown;
		baseVersion?: unknown;
	} | null;
	const versionId = body?.versionId;
	if (typeof versionId !== 'number' || !Number.isInteger(versionId) || versionId <= 0) {
		error(400, '"versionId" must be a positive whole number.');
	}
	const baseVersion = body?.baseVersion;
	if (
		baseVersion !== undefined &&
		(typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0)
	) {
		error(400, '"baseVersion" must be a whole number, 0 or more.');
	}
	const outcome = await restoreValuationVersion(
		params.symbol,
		versionId,
		baseVersion as number | undefined,
		locals.user!.username
	);
	if (outcome.ok) return json({ ok: true, version: outcome.version });
	if (outcome.reason === 'not_found') error(404, 'No such version for this company');
	return json({ conflict: true, current: outcome.current }, { status: 409 });
};
