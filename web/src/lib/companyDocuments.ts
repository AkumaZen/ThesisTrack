import { z } from 'zod';
import { classifyAnnouncement } from './valuation/announcementTags';

export const DOCUMENT_TYPES = ['Order wins', 'Results', 'Expansion / capex', 'Acquisitions', 'Guidance', 'Fundraising', 'Management', 'Credit rating', 'Regulatory', 'Corporate actions', 'Other material updates'] as const;
export const documentSummarySchema = z.object({
	important: z.boolean(), category: z.enum(DOCUMENT_TYPES),
	takeaway: z.string().min(1).max(400), summary: z.string().min(1).max(4000)
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type CompanyDocument = { id: number; subject: string; announcedAt: string; pdfUrl: string; analysis: DocumentSummary | null };

export function trustedDocumentUrl(value: string | null): string | null {
	try {
		const url = new URL(value ?? '');
		return url.protocol === 'https:' && ['nsearchives.nseindia.com', 'archives.nseindia.com', 'www.nseindia.com'].includes(url.hostname) && !url.username && !url.password && !url.port && /\.pdf$/i.test(url.pathname) ? url.href : null;
	} catch { return null; }
}

export function documentCandidate(a: { subject: string; details: string; pdfUrl: string | null }) {
	const tag = classifyAnnouncement(a.subject, a.details);
	// Board outcomes can contain material approvals; let Luna read those PDFs.
	return !!trustedDocumentUrl(a.pdfUrl) && tag !== 'routine' && (tag !== 'board_meeting' || /outcome/i.test(`${a.subject} ${a.details}`));
}
