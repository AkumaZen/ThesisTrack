// Ports the pure parts of app/services/exporter.py's contract that don't
// need a live DB: the train/eval split hash and the per-format JSONL shape.
// (DB-backed eligibility rules are exercised indirectly through
// tests/services.integration.test.ts's health-check/thesis fixtures.)
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hashSplit, serialize, type ExportRow } from '../src/lib/server/services/exporter';

describe('hashSplit', () => {
	it('is deterministic for a given company_id', () => {
		expect(hashSplit('ACME_01')).toBe(hashSplit('ACME_01'));
	});

	it('matches sha256(company_id) % 10000 < 1500 => eval, else train', () => {
		const ids = ['ACME_01', 'BALU_FORGE', 'ZZZ_999', 'A', 'company-with-dashes_42'];
		for (const id of ids) {
			const digest = BigInt('0x' + createHash('sha256').update(id, 'utf-8').digest('hex'));
			const expected = digest % 10000n < 1500n ? 'eval' : 'train';
			expect(hashSplit(id)).toBe(expected);
		}
	});

	it('distributes roughly 15% to eval over a large sample', () => {
		let evalCount = 0;
		const n = 2000;
		for (let i = 0; i < n; i++) {
			if (hashSplit(`COMPANY_${i}`) === 'eval') evalCount++;
		}
		const pct = evalCount / n;
		expect(pct).toBeGreaterThan(0.1);
		expect(pct).toBeLessThan(0.2);
	});
});

describe('serialize', () => {
	const row: ExportRow = {
		task: 'verdict',
		company_id: 'ACME_01',
		input: { thesis_data: { foo: 'bar' }, period: 'FY26Q1', rule_engine_findings: [] },
		output: { verdict: 'on_track', reasoning_chain: ['Premise 1: x', 'Conclusion: y'], confidence: 0.8 },
		metadata: { period: 'FY26Q1', health_check_id: 1 }
	};

	it('produces the anthropic shape: system + user/assistant messages + metadata', () => {
		const out = serialize(row, 'anthropic');
		expect(out).toEqual({
			system: expect.any(String),
			messages: [
				{ role: 'user', content: row.input },
				{ role: 'assistant', content: row.output }
			],
			metadata: {
				period: 'FY26Q1',
				health_check_id: 1,
				task: 'verdict',
				company_id: 'ACME_01',
				prompt_version: 'v1'
			}
		});
	});

	it('produces the openai shape: system/user/assistant messages, no top-level system key', () => {
		const out = serialize(row, 'openai');
		expect(out.system).toBeUndefined();
		expect(out.messages).toEqual([
			{ role: 'system', content: expect.any(String) },
			{ role: 'user', content: row.input },
			{ role: 'assistant', content: row.output }
		]);
		expect((out.metadata as Record<string, unknown>).prompt_version).toBe('v1');
	});

	it('produces the llama shape: a single [INST] prompt string + completion', () => {
		const out = serialize(row, 'llama');
		expect(typeof out.prompt).toBe('string');
		expect(out.prompt as string).toMatch(/^<s>\[INST\] <<SYS>>\n.*<<\/SYS>>\n\n.*\[\/INST\]$/s);
		expect(out.completion).toEqual(row.output);
		expect(out.messages).toBeUndefined();
	});

	it('uses the verdict-task system prompt (shared with the AI reviewer) for the verdict task', () => {
		const anthropic = serialize(row, 'anthropic');
		expect(anthropic.system).toMatch(/investment thesis auditor/i);
	});

	it('uses distinct system prompts for thesis_synthesis and redline_extraction', () => {
		const synthesis = serialize({ ...row, task: 'thesis_synthesis' }, 'anthropic');
		const redline = serialize({ ...row, task: 'redline_extraction' }, 'anthropic');
		expect(synthesis.system).toMatch(/7-pillar investment thesis/i);
		expect(redline.system).toMatch(/invalidation triggers/i);
		expect(synthesis.system).not.toBe(redline.system);
	});

	it('rejects an unknown format', () => {
		expect(() => serialize(row, 'bogus')).toThrow(/unknown format/);
	});
});
