import { describe, expect, it } from 'vitest';
import { createMetricSchema, normalizeMetricKey } from '../src/lib/server/schemas/metric';

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
