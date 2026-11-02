import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireActor, requireWriteActor, handleAuthError } from '$lib/server/http';
import { documentCompany, documentResponse, refreshCompanyDocuments } from '$lib/server/services/companyDocuments';

export const config = { maxDuration: 300 };
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireActor(locals.actor);
		const company = await documentCompany(params.id);
		return json(company.nseTicker ? await documentResponse(company.nseTicker.toUpperCase()) : { documents: [], warnings: ['This company has no NSE symbol. NSE documents are currently supported.'] });
	} catch (e) { return handleAuthError(e); }
};
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		requireWriteActor(locals.actor);
		const company = await documentCompany(params.id);
		const input = z.object({ action: z.enum(['start', 'continue']).default('start') }).safeParse(await request.json().catch(() => ({})));
		if (!input.success) return json({ detail: 'Choose start or continue.' }, { status: 400 });
		return json(company.nseTicker ? await refreshCompanyDocuments(company.nseTicker.toUpperCase(), input.data.action) : { documents: [], warnings: ['This company has no NSE symbol. NSE documents are currently supported.'] });
	} catch (e) { return handleAuthError(e); }
};
