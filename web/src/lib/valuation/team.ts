// Shared types and pure helpers for the per-company team features: thesis, notes, discussion,
// review status and coverage (server side: server/teamStore.ts).

export type NoteKind = 'thesis' | 'note' | 'comment';
export type ReviewStatus = 'draft' | 'review_needed' | 'approved';

export const REVIEW_STATUSES: ReviewStatus[] = ['draft', 'review_needed', 'approved'];
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
	draft: 'Draft',
	review_needed: 'Review needed',
	approved: 'Approved'
};

export const NOTE_MAX_LENGTH = 20000;

export interface CompanyNote {
	id: number;
	kind: NoteKind;
	body: string;
	author: string;
	createdAt: number;
	editedAt: number | null;
}

export interface StatusInfo {
	status: ReviewStatus;
	/** The valuation version the status was set on (null if it was set before any save). */
	atVersion: number | null;
	setBy: string;
	setAt: number;
}

export interface CoverageInfo {
	userId: number;
	username: string;
	assignedBy: string;
	assignedAt: number;
}

export interface TeamMember {
	id: number;
	username: string;
}

/** Everything the company page's Team panel shows, in one request. */
export interface CompanyTeamData {
	notes: CompanyNote[];
	status: StatusInfo | null;
	coverage: CoverageInfo | null;
	members: TeamMember[];
}

/** "Approved" is only trustworthy for the version it was given on. */
export function statusIsStale(status: StatusInfo | null, currentVersion: number): boolean {
	return (
		status !== null &&
		status.status === 'approved' &&
		status.atVersion !== null &&
		currentVersion > status.atVersion
	);
}

/** Why a note body is unacceptable, or null. */
export function noteProblem(body: unknown): string | null {
	if (typeof body !== 'string') return 'The text is missing.';
	const trimmed = body.trim();
	if (!trimmed) return 'Write something first.';
	if (trimmed.length > NOTE_MAX_LENGTH)
		return `Keep it under ${NOTE_MAX_LENGTH.toLocaleString('en-IN')} characters.`;
	return null;
}
