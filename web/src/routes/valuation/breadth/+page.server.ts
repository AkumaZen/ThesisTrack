import type { PageServerLoad } from './$types';
import { readBreadth } from '$lib/valuation/server/breadthStore';

// Stored breadth rows only; "Refresh breadth" (writers) recomputes them from the stored candles.
export const load: PageServerLoad = async () => ({ rows: await readBreadth() });
