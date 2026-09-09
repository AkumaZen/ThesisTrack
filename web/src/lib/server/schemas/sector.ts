// Zod schemas for the Sectors feature (grouping companies for a rollup view).
import { z } from 'zod';

// operating_model is validated against the operating_models table where it's
// actually consumed (sectors.ts service), not with a fixed enum here - see
// thesis.ts's classification.operating_model for the same reasoning.
export const createSectorSchema = z.object({
	name: z.string().min(2).max(100),
	description: z.string().max(500).optional().default(''),
	operating_model: z.string().min(1).nullable().optional(),
	company_ids: z.array(z.string()).optional().default([])
});

export const updateSectorSchema = z.object({
	name: z.string().min(2).max(100).optional(),
	description: z.string().max(500).optional(),
	operating_model: z.string().min(1).nullable().optional()
});

export const addCompaniesSchema = z.object({
	company_ids: z.array(z.string()).min(1)
});
