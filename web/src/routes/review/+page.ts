import { api } from '$lib/api';
import type { PageLoad } from './$types';

export type Trackable = { id: string; label: string; company_id: string; company_name: string; stale?: boolean; stale_reasons?: string[] };

export const load: PageLoad = async ({ fetch }) => ({
	trackables: await api.listTrackables(fetch) as Trackable[]
});
