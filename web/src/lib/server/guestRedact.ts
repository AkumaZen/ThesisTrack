// Guest mode: a visitor without an account must never learn who is on the team. Every response a
// guest receives passes through a redactor built here (hooks.server.ts), so a route that forgets
// to hide its author still cannot leak one. Pure: the caller supplies the team directory.
//
// Three rules, applied together:
//  - Fields that name a person (owner, author, created_by, updatedBy, actor...) are replaced by a
//    neutral label, whatever their value.
//  - Fields that point at a person's account (userId...) are dropped to null, and the team roster
//    (`members`) is emptied: a guest has no use for it.
//  - Any text that contains a team member's email or display name, or any email address at all,
//    has it replaced by the label too (notes, activity summaries, page data).
//
// A person keeps the same label everywhere ("Analyst 1", "Analyst 2", by account age), so a guest
// can still tell two theses apart; anyone not in the directory becomes "Team member".

export interface TeamIdentity {
	id: number;
	email: string;
	displayName: string;
}

export const UNKNOWN_PERSON_LABEL = 'Team member';

const norm = (key: string) => key.replace(/[_-]/g, '').toLowerCase();

/** Keys whose string value names a person. */
const PERSON_KEYS = new Set(
	[
		'owner',
		'scenarioOwner',
		'actor',
		'author',
		'authoredBy',
		'createdBy',
		'updatedBy',
		'savedBy',
		'setBy',
		'assignedBy',
		'coveredBy',
		'resolvedBy',
		'reviewedBy',
		'removedBy',
		'restoredBy',
		'deletedBy',
		'changedBy',
		'addedBy',
		'username',
		'userName',
		'displayName',
		'email',
		'identity'
	].map(norm)
);

/** Keys whose value points at a person's account. */
const ACCOUNT_ID_KEYS = new Set(['userId', 'ownerId', 'authorId', 'createdById', 'updatedById'].map(norm));

/** Keys holding the team roster. */
const ROSTER_KEYS = new Set(['members'].map(norm));

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface GuestRedactor {
	/** The label a person is shown as (stable per person). */
	label(identity: string): string;
	/** The real identity behind a label, for a guest who picks "Analyst 2"'s thesis; null if none. */
	identityFor(label: string): string | null;
	/** Free text with every team identity and email address replaced. */
	text(s: string): string;
	/** A parsed JSON value with every identity replaced (a new value; the input is not changed). */
	json(value: unknown): unknown;
}

export function createGuestRedactor(team: TeamIdentity[]): GuestRedactor {
	const people = [...team].sort((a, b) => a.id - b.id);
	const byIdentity = new Map<string, string>();
	const byLabel = new Map<string, string>();
	people.forEach((p, i) => {
		const label = `Analyst ${i + 1}`;
		if (p.email) byIdentity.set(p.email.toLowerCase(), label);
		if (p.displayName) byIdentity.set(p.displayName.toLowerCase(), label);
		// Theses are owned by email, so that is what a label leads back to.
		byLabel.set(label.toLowerCase(), p.email || p.displayName);
	});
	const names = people
		.map((p, i) => ({ name: p.displayName, label: `Analyst ${i + 1}` }))
		.filter((n) => n.name.trim().length >= 3)
		// Longest first, so "Rohit.Negi2" is not half replaced by "Rohit.Negi".
		.sort((a, b) => b.name.length - a.name.length);
	// A name with a separator or digit ("Rohit.Negi") cannot be an ordinary word, so it is matched
	// in any case. A plain one-word name ("Mark") only matches as written, so "mark to market" in a
	// note stays as it is.
	const nameRes = names.map((n) => ({
		re: new RegExp(
			`(?<![A-Za-z0-9])${escapeRe(n.name)}(?![A-Za-z0-9])`,
			/^[A-Za-z]+$/.test(n.name) ? 'g' : 'gi'
		),
		label: n.label
	}));

	const label = (identity: string): string => {
		const key = identity.trim().toLowerCase();
		// Empty, or the guest's own stand-in name: nothing to hide.
		if (!key || key === 'guest') return identity;
		if (byIdentity.has(key)) return byIdentity.get(key)!;
		// Already a label (a guest asking about "Analyst 2"): leave it.
		if (byLabel.has(key) || key === UNKNOWN_PERSON_LABEL.toLowerCase()) return identity;
		return UNKNOWN_PERSON_LABEL;
	};

	const text = (s: string): string => {
		if (!s) return s;
		let out = s.replace(EMAIL, (m) => byIdentity.get(m.toLowerCase()) ?? UNKNOWN_PERSON_LABEL);
		for (const { re, label: l } of nameRes) out = out.replace(re, l);
		return out;
	};

	const walk = (value: unknown, key: string | null): unknown => {
		const k = key === null ? null : norm(key);
		if (k !== null && ROSTER_KEYS.has(k) && Array.isArray(value)) return [];
		if (k !== null && ACCOUNT_ID_KEYS.has(k) && value !== null && typeof value !== 'object') return null;
		if (typeof value === 'string') return k !== null && PERSON_KEYS.has(k) ? label(value) : text(value);
		if (Array.isArray(value)) return value.map((v) => walk(v, null));
		if (value && typeof value === 'object') {
			const out: Record<string, unknown> = {};
			for (const [k2, v] of Object.entries(value)) out[k2] = walk(v, k2);
			return out;
		}
		return value;
	};

	return {
		label,
		identityFor: (l) => byLabel.get(l.trim().toLowerCase()) ?? null,
		text,
		json: (value) => walk(value, null)
	};
}
