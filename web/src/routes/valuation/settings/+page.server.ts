import type { PageServerLoad } from './$types';
import { getAnalysisSettings } from '$lib/server/analysisSettingsStore';

export const load: PageServerLoad = async () => ({ settings: await getAnalysisSettings() });
