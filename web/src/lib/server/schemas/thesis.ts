// Ports app/schemas/thesis.py's Pydantic contract to Zod.
import { z } from 'zod';
import { PILLAR_KEYS } from '../pillars';

const THESIS_STATUSES = ['on_track', 'watch_closely', 'broken'] as const;

const normalizeEnum = (v: string) => v.trim().toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
const stripMarkdownLink = (v: string) => {
	const m = v.trim().match(/^\[.*?\]\((.*?)\)$/);
	return m ? m[1] : v.trim();
};

export const revenueSplitItem = z.object({
	segment: z.string(),
	share_pct: z.number().min(0).max(100)
});

// A thesis gets built up incrementally - nothing in it is required to save,
// including a revenue split that doesn't (yet) sum to 100. That used to be
// enforced; it isn't anymore, on purpose - a partial split the analyst is
// still mid-typing must save exactly as-is, not get rejected.
export const theBusiness = z.object({
	what_it_does: z.string().default(''),
	revenue_split: z.array(revenueSplitItem).default([])
});

export const theBigChange = z.object({
	summary: z.string().default(''),
	expected_completion: z.string().default('')
});

export const proofPoints = z.object({
	hard_evidence: z.array(z.string()).default([]),
	model_specific_metrics: z.record(z.string(), z.number()).default({})
});

// A half-filled trigger row (label typed, threshold not yet decided) is a
// normal mid-draft state, not an error - saves exactly as typed. A trigger
// left half-configured (metric_key set but no operator/threshold yet) simply
// won't evaluate against anything until the analyst finishes it; that's the
// rule engine's problem to skip over, not a reason to block the save.
export const killTrigger = z.object({
	label: z.string().default(''),
	metric_key: z.string().nullable().optional(),
	operator: z.enum(['<', '<=', '>', '>=', '==', '!=']).nullable().optional(),
	threshold: z.number().nullable().optional(),
	unit: z.string().nullable().optional(),
	action: z.string().default(''),
	severity: z.enum(['warn', 'kill']).default('kill'),
	grace_periods: z.number().int().min(1).default(1),
	manual_check: z.boolean().default(false)
});

export const healthCheckHistoryItem = z.object({
	quarter: z.string(),
	verdict: z.string(),
	note: z.string()
});

export const healthCheckPillar = z.object({
	latest_quarter_review: z.string().default(''),
	historical_checks: z.array(healthCheckHistoryItem).default([])
});

// No format check on url - a reference the analyst hasn't finished pasting a
// link into yet (or never will) still needs to save. stripMarkdownLink still
// runs so a properly-formed `[text](url)` paste keeps working as before.
export const referenceItem = z.object({
	title: z.string().default(''),
	url: z.string().default('').transform(stripMarkdownLink)
});

// A pillar_notes entry ("Additional Notes") is a small document, not one
// string - an ordered mix of free text and table references the analyst
// builds up with "+ Add Text"/"+ Add Table" in whatever order they want.
// Accepts the old plain-string shape too (pre-blocks data) and normalizes it
// to a single text block, so nothing already saved breaks.
const pillarNoteBlock = z.union([
	z.object({ type: z.literal('text'), text: z.string() }),
	z.object({ type: z.literal('table'), table_id: z.number() })
]);
const pillarNoteEntry = z.union([
	z.string().transform((text) => ({ blocks: [{ type: 'text' as const, text }] })),
	z.object({ blocks: z.array(pillarNoteBlock).default([]) })
]);

export const thesisData = z
	.object({
		the_business: theBusiness.default({ what_it_does: '', revenue_split: [] }),
		the_growth_engine: z.array(z.string()).default([]),
		the_big_change: theBigChange.default({ summary: '', expected_completion: '' }),
		proof_points: proofPoints.default({ hard_evidence: [], model_specific_metrics: {} }),
		what_can_kill_it: z.array(killTrigger).default([]),
		why_we_believe_it: z.array(z.string()).default([]),
		health_check: healthCheckPillar.default({ latest_quarter_review: '', historical_checks: [] }),
		trackables: z.array(z.string().refine((value) => !!value.trim(), 'Trackable cannot be blank')).default([]),
		buy_sell_decision: z.string().default(''),
		references: z.array(referenceItem).default([]),
		pillar_notes: z.record(z.string(), z.array(pillarNoteEntry)).default({})
	})
	.superRefine((v, ctx) => {
		// The only thing still checked here is internal consistency of data
		// that *was* provided (an unknown pillar_notes key is a bug, not an
		// incomplete thesis) - nothing about the thesis being incomplete is an
		// error. A thesis builds up over time; every pillar can be empty and
		// filled in later.
		const unknown = Object.keys(v.pillar_notes).filter((k) => !(PILLAR_KEYS as readonly string[]).includes(k));
		if (unknown.length) {
			ctx.addIssue({
				code: 'custom',
				message: `pillar_notes has unknown key(s) ${JSON.stringify(unknown)}; must be one of ${JSON.stringify(PILLAR_KEYS)}`
			});
		}
	});

export type ThesisData = z.infer<typeof thesisData>;

export const classification = z.object({
	broad_industry: z.string(),
	specific_niche: z.string(),
	// operating_model used to be checked against a fixed list here; it's now
	// an open, user-extensible lookup table (operating_models) - existence is
	// validated in versioning.ts's resolveOperatingModel, same place
	// broad_industry/specific_niche get validated against their tables.
	operating_model: z.string().min(1).transform(normalizeEnum),
	currency: z
		.string()
		.regex(/^[A-Z]{3}$/)
		.default('INR')
});

const tickerField = z
	.string()
	.trim()
	.toUpperCase()
	.regex(/^[A-Z0-9&.-]{1,20}$/, 'must be a short alphanumeric ticker/scrip code')
	.optional()
	.or(z.literal(''))
	.transform((v) => (v ? v : undefined));

export const thesisCreate = z
	.object({
		// company_id is optional on input - createCompany() derives it from
		// whichever ticker is present when omitted, since the form no longer
		// asks the user to type an internal ID directly (see ingest/+page.svelte).
		company_id: z
			.string()
			.regex(/^[A-Z0-9_]{2,50}$/)
			.optional(),
		nse_ticker: tickerField,
		bse_ticker: tickerField,
		name: z.string(),
		classification,
		status: z.string().transform((v, ctx) => {
			const n = normalizeEnum(v);
			if (!(THESIS_STATUSES as readonly string[]).includes(n)) {
				ctx.addIssue({ code: 'custom', message: `unknown status '${v}'` });
				return z.NEVER;
			}
			return n as (typeof THESIS_STATUSES)[number];
		}).default('on_track'),
		// Defaults to today rather than requiring the analyst to pick a date
		// just to save a still-empty thesis.
		last_reviewed: z.string().default(() => new Date().toISOString().slice(0, 10)),
		thesis_data: thesisData.default(() => thesisData.parse({}))
	})
	.superRefine((v, ctx) => {
		if (!v.nse_ticker && !v.bse_ticker && !v.company_id) {
			ctx.addIssue({ code: 'custom', message: 'at least one of nse_ticker or bse_ticker is required' });
		}
	});

export type ThesisCreate = z.infer<typeof thesisCreate>;
