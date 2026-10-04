import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listUsers } from '$lib/server/authStore';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user?.role !== 'admin') error(403, 'This page is limited to the admin.');
	return { users: await listUsers() };
};
