import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendTestEmail } from '$lib/server/alertNotify';

export const POST: RequestHandler = async () => {
	const result = await sendTestEmail();
	return json(result, { status: result.ok ? 200 : 502 });
};
