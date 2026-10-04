import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
	schema: ['./src/lib/server/db/schema.ts', './src/lib/server/db/valuationSchema.ts'],
	schemaFilter: ['public', 'valuation'],
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL!
	}
});
