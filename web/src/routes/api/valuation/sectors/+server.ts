import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTaxonomySnapshot } from '$lib/server/sectorStore';

export const GET: RequestHandler = async () => json(await getTaxonomySnapshot());
