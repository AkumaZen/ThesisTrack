// Ports app/schemas/thesis.py's Pydantic contract to Zod.
import { z } from 'zod';
import { PILLAR_KEYS } from '../pillars';

const OPERATING_MODELS = ['factory', 'subscription', 'money_lending', 'retail_stores', 'services'] as const;
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

export const theBusiness = z
	.object({
		what_it_does: z.string(),
		revenue_split: z.array(revenueSplitItem)
	})
	.refine((v) => Math.abs(v.revenue_split.reduce((s, i) => s + i.share_pct, 0) - 100) <= 0.5, {
		message: 'revenue_split.share_pct must sum to 100 +/- 0.5'
	});

export const theBigChange = z.object({
	summary: z.string(),
	expected_completion: z.string()
});

export const proofPoints = z.object({
	hard_evidence: z.array(z.string()).default([]),
	model_specific_metrics: z.record(z.string(), z.number()).default({})
});

export const killTrigger = z
	.object({
		label: z.string(),
		metric_key: z.string().nullable().optional(),
		operator: z.enum(['<', '<=', '>', '>=', '==', '!=']).nullable().optional(),
		threshold: z.number().nullable().optional(),
		unit: z.string().nullable().optional(),
		action: z.string(),
		severity: z.enum(['warn', 'kill']).default('kill'),
		grace_periods: z.number().int().min(1).default(1),
		manual_check: z.boolean().default(false)
	})
	.refine((v) => v.manual_check || (v.metric_key != null && v.operator != null && v.threshold != null), {
		message: 'kill trigger must set manual_check=true, or provide metric_key, operator, and threshold'
	});

export const healthCheckHistoryItem = z.object({
	quarter: z.string(),
	verdict: z.string(),
	note: z.string()
});

export const healthCheckPillar = z.object({
	latest_quarter_review: z.string(),
	historical_checks: z.array(healthCheckHistoryItem).default([])
});

export const referenceItem = z.object({
	title: z.string(),
	url: z
		.string()
		.transform(stripMarkdownLink)
		.refine(
			(v) => {
				try {
					const u = new URL(v);
					return u.protocol === 'http:' || u.protocol === 'https:';
				} catch {
					return false;
				}
			},
			{ message: 'references[].url is not a valid absolute URL' }
		)
});

export const thesisData = z
	.object({
		the_business: theBusiness,
		the_growth_engine: z.array(z.string()).default([]),
		the_big_change: theBigChange,
		proof_points: proofPoints,
		what_can_kill_it: z.array(killTrigger),
		why_we_believe_it: z.array(z.string()),
		health_check: healthCheckPillar,
		references: z.array(referenceItem).default([]),
		pillar_notes: z.record(z.string(), z.array(z.string())).default({})
	})
	.superRefine((v, ctx) => {
		const unknown = Object.keys(v.pillar_notes).filter((k) => !(PILLAR_KEYS as readonly string[]).includes(k));
		if (unknown.length) {
			ctx.addIssue({
				code: 'custom',
				message: `pillar_notes has unknown key(s) ${JSON.stringify(unknown)}; must be one of ${JSON.stringify(PILLAR_KEYS)}`
			});
		}
		if (!v.what_can_kill_it.some((t) => t.severity === 'kill')) {
			ctx.addIssue({
				code: 'custom',
				message: "what_can_kill_it must contain at least one entry with severity='kill'"
			});
		}
		const entries = v.why_we_believe_it;
		if (entries.length < 3) {
			ctx.addIssue({ code: 'custom', message: `why_we_believe_it needs >= 3 entries, got ${entries.length}` });
		}
		const premises = entries.filter((e) => e.trim().toLowerCase().startsWith('premise'));
		const conclusions = entries.filter((e) => e.trim().toLowerCase().startsWith('conclusion'));
		if (premises.length < 1) {
			ctx.addIssue({ code: 'custom', message: "why_we_believe_it must contain at least one entry starting with 'Premise'" });
		}
		if (conclusions.length !== 1) {
			ctx.addIssue({
				code: 'custom',
				message: `why_we_believe_it must contain exactly one 'Conclusion' entry, found ${conclusions.length}`
			});
		}
	});

export type ThesisData = z.infer<typeof thesisData>;

export const classification = z.object({
	broad_industry: z.string(),
	specific_niche: z.string(),
	operating_model: z.string().transform((v, ctx) => {
		const n = normalizeEnum(v);
		if (!(OPERATING_MODELS as readonly string[]).includes(n)) {
			ctx.addIssue({ code: 'custom', message: `unknown operating_model '${v}'` });
			return z.NEVER;
		}
		return n as (typeof OPERATING_MODELS)[number];
	}),
	currency: z
		.string()
		.regex(/^[A-Z]{3}$/)
		.default('INR')
});

export const thesisCreate = z.object({
	company_id: z.string().regex(/^[A-Z0-9_]{2,50}$/),
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
	last_reviewed: z.string(),
	thesis_data: thesisData
});

export type ThesisCreate = z.infer<typeof thesisCreate>;
