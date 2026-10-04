import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteWatchlist, renameWatchlist } from '$lib/valuation/server/watchlistsStore';
import { watchlistNameProblem } from '$lib/valuation/watchlists';

function idOf(raw: string) {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Invalid list id');
	return id;
}

/** Body: { name }. Anyone may rename. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
	const problem = watchlistNameProblem(body?.name);
	if (problem) error(400, problem);
	const result = await renameWatchlist(
		idOf(params.id),
		body!.name as string,
		locals.user!.username
	);
	if (!result.ok) {
		error(
			result.reason === 'duplicate' ? 409 : 404,
			result.reason === 'duplicate'
				? 'A list with that name already exists.'
				: 'That list no longer exists.'
		);
	}
	return json({ ok: true });
};

/** The creator or an admin may delete; the companies stay on the main watchlist. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const result = await deleteWatchlist(
		idOf(params.id),
		locals.user!.username,
		locals.user!.role === 'admin'
	);
	if (!result.ok) {
		if (result.reason === 'forbidden')
			error(403, 'Only the person who made this list or an admin can delete it.');
		error(404, 'That list no longer exists.');
	}
	return json({ ok: true });
};
