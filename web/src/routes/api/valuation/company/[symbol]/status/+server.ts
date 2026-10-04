import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setStatus } from '$lib/valuation/server/teamStore';
import { REVIEW_STATUSES, noteProblem, type ReviewStatus } from '$lib/valuation/team';

/** Body: { status, atVersion?, comment? }. Any signed-in analyst; who and when are recorded. */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const input = (await request.json().catch(() => null)) as {
		status?: unknown;
		atVersion?: unknown;
		comment?: unknown;
	} | null;
	if (!REVIEW_STATUSES.includes(input?.status as ReviewStatus)) {
		error(400, '"status" must be draft, review_needed or approved.');
	}
	const atVersion = input?.atVersion ?? null;
	if (atVersion !== null && (!Number.isInteger(atVersion) || (atVersion as number) < 0)) {
		error(400, '"atVersion" must be a whole number.');
	}
	const comment = input?.comment;
	if (comment !== undefined && comment !== '' && noteProblem(comment)) {
		error(400, noteProblem(comment)!);
	}
	const info = await setStatus(
		params.symbol,
		input!.status as ReviewStatus,
		atVersion as number | null,
		locals.user!.username,
		typeof comment === 'string' ? comment : undefined
	);
	return json(info);
};
