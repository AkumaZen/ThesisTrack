import type { PageServerLoad } from './$types';
import { getAnalysisSettings } from '$lib/valuation/server/analysisSettingsStore';

export const load: PageServerLoad = async () => ({ settings: await getAnalysisSettings() });
