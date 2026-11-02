import { describe, expect, it } from 'vitest';
import { documentCandidate, documentSummarySchema, trustedDocumentUrl } from './companyDocuments';

describe('company document selection', () => {
	const pdfUrl = 'https://nsearchives.nseindia.com/corporate/order.pdf';
	it('accepts only exchange HTTPS PDF URLs', () => {
		expect(trustedDocumentUrl(pdfUrl)).toBe(pdfUrl);
		for (const url of ['http://nsearchives.nseindia.com/a.pdf', 'https://nsearchives.nseindia.com.evil.test/a.pdf', 'https://user:password@nsearchives.nseindia.com/a.pdf', 'https://127.0.0.1/a.pdf', 'https://nsearchives.nseindia.com:8443/a.pdf', 'javascript:alert(1)', 'https://nsearchives.nseindia.com/page']) expect(trustedDocumentUrl(url)).toBeNull();
	});
	it('excludes routine filings and meeting notices before spending on AI', () => {
		for (const subject of ['Trading window closure', 'Board meeting intimation', 'Loss of share certificates']) expect(documentCandidate({ subject, details: '', pdfUrl })).toBe(false);
		expect(documentCandidate({ subject: 'Receipt of orders', details: '', pdfUrl })).toBe(true);
		expect(documentCandidate({ subject: 'Outcome of board meeting', details: '', pdfUrl })).toBe(true);
		expect(documentCandidate({ subject: 'Expansion update', details: '', pdfUrl: null })).toBe(false);
	});
	it('rejects missing summaries and invented categories', () => {
		expect(documentSummarySchema.safeParse({ important: true, category: 'Order wins', takeaway: 'New order', summary: 'Details (page 1).' }).success).toBe(true);
		expect(documentSummarySchema.safeParse({ important: true, category: 'Guaranteed returns', takeaway: 'New order', summary: '' }).success).toBe(false);
	});
});
