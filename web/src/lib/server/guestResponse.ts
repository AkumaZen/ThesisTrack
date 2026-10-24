// Guest mode: applies the identity redactor (guestRedact.ts) to everything a guest is sent, and
// turns a label a guest picked ("Analyst 2") back into the person it stands for on the way in.
import { asc } from 'drizzle-orm';
import { db } from './db';
import { users } from './db/schema';
import { createGuestRedactor, type GuestRedactor } from './guestRedact';

/** Built from the current team on every call: the users table is a handful of rows, and a cache
 *  would show a brand-new account as "Team member" until it expired. */
export async function guestRedactor(): Promise<GuestRedactor> {
	const team = await db
		.select({ id: users.id, email: users.email, displayName: users.displayName })
		.from(users)
		.orderBy(asc(users.id));
	return createGuestRedactor(team);
}

/** Query parameters that name a person: a guest sends the label it was shown. */
const PERSON_PARAMS = ['owner'];

/** Swap a label in the request's person parameters for the identity it stands for. */
export async function unmaskGuestParams(url: URL): Promise<void> {
	const present = PERSON_PARAMS.filter((p) => url.searchParams.has(p));
	if (present.length === 0) return;
	const redactor = await guestRedactor();
	for (const p of present) {
		const identity = redactor.identityFor(url.searchParams.get(p) ?? '');
		// Anything else (a real email typed into the URL, say) is dropped, so it cannot be used
		// to test whether someone is on the team.
		if (identity) url.searchParams.set(p, identity);
		else url.searchParams.delete(p);
	}
}

/** The response with every team identity replaced. JSON is redacted field by field; HTML and
 *  plain text as text. Anything else (images, files, streams) passes through. */
export async function redactGuestResponse(response: Response): Promise<Response> {
	const type = response.headers.get('content-type') ?? '';
	const isJson = /\bjson\b/i.test(type);
	// Pages and plain text; never a stream (text/event-stream), which must not be buffered.
	const isText = isJson || /^text\/(html|plain)/i.test(type);
	if (!isText || response.body === null || [204, 205, 304].includes(response.status)) return response;
	const redactor = await guestRedactor();
	const raw = await response.text();
	let body: string;
	if (isJson) {
		try {
			body = JSON.stringify(redactor.json(JSON.parse(raw)));
		} catch {
			body = redactor.text(raw); // not a single JSON document (a stream of lines)
		}
	} else {
		body = redactor.text(raw);
	}
	const headers = new Headers(response.headers);
	headers.delete('content-length');
	headers.delete('etag');
	return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
