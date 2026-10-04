import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createWatchlist, listWatchlists } from '$lib/server/watchlistsStore';
import { watchlistNameProblem } from '$lib/watchlists';

export const GET: RequestHandler = async () => json(await listWatchlists());

/** Body: { name }. Any signed-in analyst may create a list; names are unique (any case). */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
	const problem = watchlistNameProblem(body?.name);
	if (problem) error(400, problem);
	const result = await createWatchlist(body!.name as string, locals.user!.username);
	if (!result.ok) error(409, 'A list with that name already exists.');
	return json(result.value, { status: 201 });
};
