import { api } from '$lib/api';
import type { PageLoad } from './$types';

export type Trackable = { id: string; label: string; company_id: string; company_name: string };

export const load: PageLoad = async () => ({
	trackables: await api.listTrackables() as Trackable[]
});
