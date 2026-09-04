// Ports the pure retry/validation behavior of app/services/ai_reviewer.py:
// verdict must be one of the known enum values, reasoning_chain must be a
// non-empty list, and a parse failure gets exactly one corrective retry
// before failing safe. (The DB-writing half - run_ai_review's proposal
// insert - is exercised indirectly through tests/services.integration.test.ts's
// status_proposals coverage; this file mocks the LLMClient boundary instead
// of standing up a live DB.)
import { describe, expect, it } from 'vitest';
import {
	AIReviewFailedError,
	completeWithRetry,
	validateReviewerResponse,
	VALID_VERDICTS
} from '../src/lib/server/services/aiReviewer';
import { FakeLLMClient, LLMResponseError, type LLMClient } from '../src/lib/server/llm/client';

describe('VALID_VERDICTS', () => {
	it('is exactly on_track, watch_closely, broken', () => {
		expect([...VALID_VERDICTS].sort()).toEqual(['broken', 'on_track', 'watch_closely']);
	});
});

describe('completeWithRetry', () => {
	it('returns the parsed response on a clean first attempt, with no retry prompt appended', async () => {
		const client = new FakeLLMClient({ response: { verdict: 'on_track', reasoning_chain: ['x'] } });
		const response = await completeWithRetry(client, 'USER PROMPT');
		expect(response).toEqual({ verdict: 'on_track', reasoning_chain: ['x'] });
		expect(client.calls).toHaveLength(1);
		expect(client.calls[0][1]).toBe('USER PROMPT');
	});

	it('retries once with a corrective "JSON only" prompt after a parse failure, then succeeds', async () => {
		let call = 0;
		const client: LLMClient = {
			modelName: 'mock',
			completeJson: async (_system: string, user: string) => {
				call++;
				if (call === 1) throw new LLMResponseError('not json');
				expect(user).toContain('Your previous response was not valid JSON');
				expect(user).toContain('USER PROMPT');
				return { verdict: 'broken', reasoning_chain: ['x', 'y'] };
			}
		};
		const response = await completeWithRetry(client, 'USER PROMPT');
		expect(response).toEqual({ verdict: 'broken', reasoning_chain: ['x', 'y'] });
		expect(call).toBe(2);
	});

	it('fails safe after MAX_ATTEMPTS (2) consecutive parse failures - no third attempt', async () => {
		let calls = 0;
		const client: LLMClient = {
			modelName: 'mock',
			completeJson: async () => {
				calls++;
				throw new LLMResponseError('still not json');
			}
		};
		await expect(completeWithRetry(client, 'USER PROMPT')).rejects.toThrow(AIReviewFailedError);
		expect(calls).toBe(2);
	});

	it('does not swallow a non-LLMResponseError (e.g. a network error) into a retry', async () => {
		const client: LLMClient = {
			modelName: 'mock',
			completeJson: async () => {
				throw new Error('network down');
			}
		};
		await expect(completeWithRetry(client, 'USER PROMPT')).rejects.toThrow('network down');
	});
});

describe('validateReviewerResponse', () => {
	it('accepts a well-formed response', () => {
		const result = validateReviewerResponse({ verdict: 'watch_closely', reasoning_chain: ['Premise 1: x', 'Conclusion: y'] });
		expect(result.verdict).toBe('watch_closely');
		expect(result.reasoningChain).toEqual(['Premise 1: x', 'Conclusion: y']);
	});

	it.each(['maybe', 'ON_TRACK', '', null, undefined, 42])(
		'rejects an unrecognized verdict %p',
		(verdict) => {
			expect(() => validateReviewerResponse({ verdict, reasoning_chain: ['x'] })).toThrow(AIReviewFailedError);
		}
	);

	it('rejects a missing reasoning_chain', () => {
		expect(() => validateReviewerResponse({ verdict: 'on_track' })).toThrow(/reasoning_chain/);
	});

	it('rejects an empty reasoning_chain', () => {
		expect(() => validateReviewerResponse({ verdict: 'on_track', reasoning_chain: [] })).toThrow(/reasoning_chain/);
	});

	it('rejects a non-array reasoning_chain', () => {
		expect(() => validateReviewerResponse({ verdict: 'on_track', reasoning_chain: 'not an array' })).toThrow(
			/reasoning_chain/
		);
	});
});
