// Ports GET /api/companies/{id}/versions from app/routers/companies.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { thesisVersions } from '$lib/server/db/schema';
import { requireActor, errorResponse, handleAuthError } from '$lib/server/http';
import { getScenarioOptional } from '$lib/server/services/scenarios';
import { diffVersions } from '$lib/server/services/versioning';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		const actor = requireActor(locals.actor);
		const companyId = params.id!;
		const scenario = await getScenarioOptional(companyId, actor.identity);
		if (!scenario) {
			return errorResponse(404, `'${actor.identity}' has no thesis on company '${companyId}' yet`);
		}

		const versions = await db
			.select()
			.from(thesisVersions)
			.where(eq(thesisVersions.scenarioId, scenario.id))
			.orderBy(asc(thesisVersions.versionNo));

		const summaries = versions.map((v) => ({
			version_id: v.versionId,
			version_no: v.versionNo,
			change_note: v.changeNote,
			authored_by: v.authoredBy,
			authored_at: v.authoredAt
		}));

		const diffParam = url.searchParams.get('diff');
		if (!diffParam) return json({ versions: summaries });

		const [fromNoStr, toNoStr] = diffParam.split(',');
		const fromNo = Number(fromNoStr);
		const toNo = Number(toNoStr);
		if (Number.isNaN(fromNo) || Number.isNaN(toNo)) {
			return errorResponse(422, "diff must be 'from,to' version numbers");
		}
		const byNo = new Map(versions.map((v) => [v.versionNo, v]));
		if (!byNo.has(fromNo) || !byNo.has(toNo)) {
			return errorResponse(422, `version_no not found: ${fromNo} or ${toNo}`);
		}
		const changes = diffVersions(byNo.get(fromNo)!, byNo.get(toNo)!);

		return json({
			versions: summaries,
			diff: { from_version_no: fromNo, to_version_no: toNo, changes }
		});
	} catch (err) {
		return handleAuthError(err);
	}
};
