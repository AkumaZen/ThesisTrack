import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createMetricSchema, normalizeMetricKey } from '../src/lib/server/schemas/metric';
import { db } from '../src/lib/server/db';
import { metricDefinitions } from '../src/lib/server/db/schema';
import { POST } from '../src/routes/api/metrics/+server';

const createdKeys: string[] = [];

afterAll(async () => {
	for (const key of createdKeys) await db.delete(metricDefinitions).where(eq(metricDefinitions.metricKey, key));
});

describe('normalizeMetricKey', () => {
	it('creates a stable key from any human-readable metric name', () => {
		expect(normalizeMetricKey('  Gross NPA %  ')).toBe('gross_npa');
		expect(normalizeMetricKey('Revenue / Employee')).toBe('revenue_employee');
	});

	it('rejects labels that cannot produce a usable key', () => {
		expect(() => normalizeMetricKey('%%%')).toThrow('metric name must contain');
	});
});

describe('createMetricSchema', () => {
	it('accepts a fully custom metric and unit without an operating model', () => {
		const parsed = createMetricSchema.parse({
			label: 'Patients treated per day',
			unit: 'patients/day',
			higher_is_better: true
		});

		expect(parsed.metric_key).toBe('patients_treated_per_day');
		expect(parsed.unit).toBe('patients/day');
		expect(parsed.operating_model).toBeNull();
	});

	it('normalizes an explicitly supplied key', () => {
		const parsed = createMetricSchema.parse({ label: 'Net Promoter Score', metric_key: ' NPS Score ', unit: 'score' });
		expect(parsed.metric_key).toBe('nps_score');
	});

	it('requires a label and unit', () => {
		expect(createMetricSchema.safeParse({ label: '', unit: '' }).success).toBe(false);
	});
});

describe('POST /api/metrics', () => {
	it('persists an analyst-defined metric with a free-form unit', async () => {
		const label = `Patients treated ${Date.now()}`;
		const response = await POST({
			locals: { actor: { identity: 'vitest', role: 'read_write', source: 'user' } },
			request: new Request('http://localhost/api/metrics', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ label, unit: 'patients/day' })
			})
		} as never);
		const body = await response.json();
		createdKeys.push(body.metric_key);

		expect(response.status).toBe(201);
		expect(body).toMatchObject({ label, unit: 'patients/day', operating_model: null });
	});

	it('does not let a read-only analyst create registry metrics', async () => {
		const response = await POST({
			locals: { actor: { identity: 'reader', role: 'read_only', source: 'user' } },
			request: new Request('http://localhost/api/metrics', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ label: 'Forbidden metric', unit: 'score' })
			})
		} as never);

		expect(response.status).toBe(403);
	});
});
