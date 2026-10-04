import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCompanyTeam } from '$lib/server/teamStore';

/** Thesis, notes, discussion, review status, coverage and the team list for one company. */
export const GET: RequestHandler = async ({ params }) => json(await getCompanyTeam(params.symbol));
