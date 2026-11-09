import type { DocumentResponse } from './companyDocuments';

/** One click follows persisted server-side checkpoints until the entire history is reviewed. */
export async function loadDocumentHistory(companyId: string, refresh: boolean, update: (result: DocumentResponse) => void, fetcher: typeof fetch = fetch): Promise<void> {
	const url = `/api/companies/${encodeURIComponent(companyId)}/documents`;
	let action = 'start';
	let retries = 0;
	for (;;) {
		const response = await fetcher(url, refresh ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) } : undefined);
		if (response.status === 423 && refresh) { await new Promise((done) => setTimeout(done, 1000)); continue; }
		const body = await response.json();
		if (!response.ok) throw new Error(body.detail ?? body.message ?? 'Documents could not be loaded.');
		update(body);
		if (refresh && body.progress?.state === 'complete' && body.progress.failed > 0 && retries < 2) { retries++; action = 'start'; continue; }
		if (!refresh || body.progress?.state !== 'reviewing') return;
		action = 'continue';
	}
}
