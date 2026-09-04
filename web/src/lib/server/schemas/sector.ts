// Zod schemas for the Sectors feature (grouping companies for a rollup view).
import { z } from 'zod';

const OPERATING_MODELS = ['factory', 'subscription', 'money_lending', 'retail_stores', 'services'] as const;

export const createSectorSchema = z.object({
	name: z.string().min(2).max(100),
	description: z.string().max(500).optional().default(''),
	operating_model: z.enum(OPERATING_MODELS).nullable().optional(),
	company_ids: z.array(z.string()).optional().default([])
});

export const updateSectorSchema = z.object({
	name: z.string().min(2).max(100).optional(),
	description: z.string().max(500).optional(),
	operating_model: z.enum(OPERATING_MODELS).nullable().optional()
});

export const addCompaniesSchema = z.object({
	company_ids: z.array(z.string()).min(1)
});
