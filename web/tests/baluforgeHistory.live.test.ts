import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { fetchSymbolAnnouncements } from '../src/lib/valuation/server/nseAnnouncements';
import { createDocumentReviewJob, reviewDocumentBatch } from '../src/lib/server/services/companyDocuments';

it.skipIf(process.env.RUN_BALUFORGE_HISTORY_TEST !== 'true')('BALUFORGE real exchange history reaches the oldest and newest PDFs without the 100-row or five-review limits', async () => {
	const history = await fetchSymbolAnnouncements('BALUFORGE', null);
	expect(history.length).toBeGreaterThan(100);
	const documents = history.map((row, i) => ({ ...row, id: i + 1, documentSummary: null }));
	const job = createDocumentReviewJob(documents, history.length);
	expect(job.oldest! < '2025-01-01').toBe(true);
	const reviewed = new Set<string>();
	while (job.state === 'reviewing') await reviewDocumentBatch(job, documents, async (row) => {
		reviewed.add(row.pdfUrl!);
		return { important: true, category: 'Other material updates', takeaway: 'Controlled AI result for traversal coverage.', summary: 'This test verifies real feed traversal only, not live AI summary quality.' };
	}, async () => {});
	expect(job.processed).toBe(job.total); expect(job.failed).toBe(0); expect(reviewed.size).toBe(job.total);
	const report = { provider: 'Real NSE feed; controlled AI for traversal', discovered: history.length, candidates: job.total, processed: job.processed, oldest: job.oldest, newest: job.newest };
	await mkdir('../logs', { recursive: true });
	await writeFile('../logs/baluforge-history-traversal.json', JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));
}, 30000);
