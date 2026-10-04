import type { LayoutServerLoad } from './$types';

// The signed-in person (or null on /login) for every page - the nav, the session store and
// role-dependent controls all read it from here.
export const load: LayoutServerLoad = ({ locals }) => ({ user: locals.user });
