import { api } from '$lib/api';
import type { Scorecard } from '$lib/scorecard';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => ({ scorecard: (await api.getScorecard(fetch)) as Scorecard });
