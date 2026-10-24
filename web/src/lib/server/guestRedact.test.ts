import { describe, expect, it } from 'vitest';
import { createGuestRedactor, UNKNOWN_PERSON_LABEL } from './guestRedact';

const team = [
	{ id: 3, email: 'shishir.bhat@rdc.in', displayName: 'Shishir.Bhat' },
	{ id: 1, email: 'rohit.negi@rdc.in', displayName: 'Rohit.Negi' },
	{ id: 2, email: 'siddhesh.dige@rdc.in', displayName: 'Siddhesh.Dige' }
];
const r = createGuestRedactor(team);

describe('createGuestRedactor', () => {
	it('gives each person a stable label by account age, for email and display name alike', () => {
		expect(r.label('rohit.negi@rdc.in')).toBe('Analyst 1');
		expect(r.label('ROHIT.NEGI@RDC.IN')).toBe('Analyst 1');
		expect(r.label('Rohit.Negi')).toBe('Analyst 1');
		expect(r.label('Siddhesh.Dige')).toBe('Analyst 2');
		expect(r.label('shishir.bhat@rdc.in')).toBe('Analyst 3');
	});

	it('hides anyone not in the directory and keeps empty, guest and existing labels', () => {
		expect(r.label('stranger@example.com')).toBe(UNKNOWN_PERSON_LABEL);
		expect(r.label('someone')).toBe(UNKNOWN_PERSON_LABEL);
		expect(r.label('')).toBe('');
		expect(r.label('Guest')).toBe('Guest');
		expect(r.label('Analyst 2')).toBe('Analyst 2');
		expect(r.label(UNKNOWN_PERSON_LABEL)).toBe(UNKNOWN_PERSON_LABEL);
	});

	it('maps a label back to the email a thesis is owned by', () => {
		expect(r.identityFor('Analyst 1')).toBe('rohit.negi@rdc.in');
		expect(r.identityFor('analyst 3')).toBe('shishir.bhat@rdc.in');
		expect(r.identityFor('rohit.negi@rdc.in')).toBeNull();
		expect(r.identityFor('Analyst 9')).toBeNull();
	});

	it('replaces emails and display names inside free text', () => {
		expect(r.text('Reviewed by rohit.negi@rdc.in and x@y.com')).toBe('Reviewed by Analyst 1 and Team member');
		expect(r.text('Note from siddhesh.dige: margins hold')).toBe('Note from Analyst 2: margins hold');
		// Only whole names: a longer word containing a name is left alone.
		expect(r.text('Rohit.Negi2 wrote')).toBe('Rohit.Negi2 wrote');
		expect(r.text('')).toBe('');
	});

	it('redacts JSON by field and leaves the input untouched', () => {
		const input = {
			scenario_owner: 'rohit.negi@rdc.in',
			other_scenarios: [{ owner: 'siddhesh.dige@rdc.in', status: 'on_track' }],
			valuation: { updatedBy: 'Shishir.Bhat', savedBy: 'Rohit.Negi', userId: 2, price: 610 },
			decisions: [{ actor: 'someone@else.org', rationale: 'Per Rohit.Negi, add more' }],
			members: [{ id: 1, username: 'Rohit.Negi' }],
			created_by: 'shishir.bhat@rdc.in',
			title: 'Balu Forge',
			nested: { author: null, count: 3 }
		};
		const before = JSON.stringify(input);
		const out = r.json(input) as typeof input;
		expect(out).toEqual({
			scenario_owner: 'Analyst 1',
			other_scenarios: [{ owner: 'Analyst 2', status: 'on_track' }],
			valuation: { updatedBy: 'Analyst 3', savedBy: 'Analyst 1', userId: null, price: 610 },
			decisions: [{ actor: UNKNOWN_PERSON_LABEL, rationale: 'Per Analyst 1, add more' }],
			members: [],
			created_by: 'Analyst 3',
			title: 'Balu Forge',
			nested: { author: null, count: 3 }
		});
		expect(JSON.stringify(input)).toBe(before);
	});

	it('handles top-level arrays and scalars', () => {
		expect(r.json([{ owner: 'rohit.negi@rdc.in' }])).toEqual([{ owner: 'Analyst 1' }]);
		expect(r.json('mail rohit.negi@rdc.in')).toBe('mail Analyst 1');
		expect(r.json(42)).toBe(42);
		expect(r.json(null)).toBeNull();
	});
});
