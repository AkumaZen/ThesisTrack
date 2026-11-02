import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireActor, requireWriteActor, handleAuthError } from '$lib/server/http';
import { documentCompany, readCompanyDocuments, refreshCompanyDocuments } from '$lib/server/services/companyDocuments';

export const config = { maxDuration: 300 };
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireActor(locals.actor);
		const company = await documentCompany(params.id);
		return json({ documents: company.nseTicker ? await readCompanyDocuments(company.nseTicker.toUpperCase()) : [], warnings: company.nseTicker ? [] : ['This company has no NSE symbol. NSE documents are currently supported.'] });
	} catch (e) { return handleAuthError(e); }
};
export const POST: RequestHandler = async ({ locals, params }) => {
	try {
		requireWriteActor(locals.actor);
		const company = await documentCompany(params.id);
		return json(company.nseTicker ? await refreshCompanyDocuments(company.nseTicker.toUpperCase()) : { documents: [], warnings: ['This company has no NSE symbol. NSE documents are currently supported.'] });
	} catch (e) { return handleAuthError(e); }
};
