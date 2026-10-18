import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const symbol = params.symbol.toUpperCase();
	if (!/^[A-Z0-9&-]{1,20}$/.test(symbol) || /^\d+$/.test(symbol)) error(404, 'Only NSE-listed companies are supported.');
	return { symbol };
};
