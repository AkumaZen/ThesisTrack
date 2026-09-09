import { z } from 'zod';

export function normalizeMetricKey(value: string): string {
	const key = value
		.trim()
		.toLowerCase()
		.replace(/%/g, '')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 60);
	if (!key || !/[a-z0-9]/.test(key)) throw new Error('metric name must contain a letter or number');
	return key;
}

export const createMetricSchema = z
	.object({
		metric_key: z.string().optional(),
		label: z.string().trim().min(1).max(120),
		unit: z.string().trim().min(1).max(40),
		higher_is_better: z.boolean().nullable().optional().default(null),
		operating_model: z.string().trim().min(1).nullable().optional().default(null),
		help_text: z.string().trim().max(500).nullable().optional().default(null)
	})
	.transform((value, ctx) => {
		try {
			return { ...value, metric_key: normalizeMetricKey(value.metric_key || value.label) };
		} catch (error) {
			ctx.addIssue({ code: 'custom', path: ['metric_key'], message: String((error as Error).message) });
			return z.NEVER;
		}
	});

