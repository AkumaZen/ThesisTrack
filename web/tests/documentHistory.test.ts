import { describe, expect, it, vi } from 'vitest';
const stub = vi.hoisted(() => ({ env: { DATABASE_URL: 'postgres://test:test@localhost:1/test' } }));
vi.mock('$env/dynamic/private', () => stub);
import { createDocumentReviewJob, reviewDocumentBatch } from '../src/lib/server/services/companyDocuments';
import { loadDocumentHistory } from '../src/lib/companyDocumentRefresh';
import { fetchSymbolAnnouncements } from '../src/lib/valuation/server/nseAnnouncements';

const summary = { important: true, category: 'Order wins' as const, takeaway: 'Order received.', summary: 'A verified order (page 1).' };
const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: i + 1, pdfUrl: `https://nsearchives.nseindia.com/corporate/order-${i}.pdf`, subject: 'Receipt of orders', details: '', announcedAt: new Date(Date.UTC(2024, 4, 14 + i)), documentSummary: null as unknown }));

describe('full document history', () => {
	it('reviews over 100 documents, including the oldest and newest, across automatically continued batches', async () => {
		const documents = rows(137), review = vi.fn(async () => summary), save = vi.fn(async () => {});
		const job = createDocumentReviewJob(documents, documents.length);
		while (job.state === 'reviewing') await reviewDocumentBatch(job, documents, review, save);
		expect(job.processed).toBe(137); expect(job.failed).toBe(0); expect(job.state).toBe('complete');
		expect(review.mock.calls).toHaveLength(137);
		expect(save).toHaveBeenCalledWith(1, summary); expect(save).toHaveBeenCalledWith(137, summary);
	});
	it('deduplicates PDFs, reuses saved summaries, and does not stop later documents after a failure', async () => {
		const documents = rows(12); documents[0].documentSummary = summary;
		documents.push({ ...documents[1], id: 1000 });
		const job = createDocumentReviewJob(documents, documents.length);
		const review = vi.fn(async (row: { id: number }) => { if (row.id === 3) throw new Error('Unreadable PDF'); return summary; });
		const save = vi.fn(async () => {});
		while (job.state === 'reviewing') await reviewDocumentBatch(job, documents, review, save);
		expect(job.total).toBe(12); expect(job.processed).toBe(12); expect(job.failed).toBe(1);
		expect(job.errors[documents[2].pdfUrl!]).toBe('Unreadable PDF');
		expect(review).toHaveBeenCalledTimes(11); expect(save).toHaveBeenCalledWith(12, summary);
	});
	it('resumes a serialized checkpoint without repeating completed documents', async () => {
		const documents = rows(9), review = vi.fn(async () => summary), save = vi.fn(async () => {});
		const job = createDocumentReviewJob(documents, 9);
		await reviewDocumentBatch(job, documents, review, save);
		const resumed = JSON.parse(JSON.stringify(job));
		while (resumed.state === 'reviewing') await reviewDocumentBatch(resumed, documents, review, save);
		expect(review).toHaveBeenCalledTimes(9); expect(resumed.processed).toBe(9);
	});
	it('one browser refresh follows every checkpoint instead of returning after the first five documents', async () => {
		let calls = 0;
		const fetcher = vi.fn<typeof fetch>(async () => { calls++; return Response.json({ documents: [], warnings: [], progress: { state: calls < 10 ? 'reviewing' : 'complete', processed: calls * 3, total: 30 } }); });
		await loadDocumentHistory('BALUFORGE', true, vi.fn(), fetcher);
		expect(fetcher).toHaveBeenCalledTimes(10);
		expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).action).toBe('start');
		expect(JSON.parse(fetcher.mock.calls[9][1]!.body as string).action).toBe('continue');
	});
	it('requests the complete exchange range instead of a 90-day window', async () => {
		const fetcher = vi.fn<typeof fetch>(async () => Response.json([]));
		await fetchSymbolAnnouncements('BALUFORGE', null, fetcher, new Date('2026-11-02T10:00:00Z'));
		const url = new URL(String(fetcher.mock.calls[0][0]));
		expect(url.searchParams.get('from_date')).toBe('01-01-1990');
		expect(url.searchParams.get('to_date')).toBe('02-11-2026');
	});
});
