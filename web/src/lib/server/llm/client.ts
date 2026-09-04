// Ports app/llm/client.py. Every call is logged to disk (model name, prompt
// hash, raw response) - same instrumentation requirement as the Python side.
//
// No default silently degrades to a canned answer - getLlmClient() throws
// clearly if unconfigured. A silently-fabricated "review" would be exactly
// the kind of unverified content the constitution (rule 7) exists to keep
// out of the system; tests inject a FakeLLMClient explicitly instead.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '$env/dynamic/private';

// Python's _default_log_dir() resolves to <repo_root>/logs/llm_calls (three
// parents up from app/llm/client.py) unless VERCEL is set, in which case it
// falls back to /tmp/logs/llm_calls (Vercel's deployed FS is read-only
// outside /tmp). This file lives at web/src/lib/server/llm/client.ts, so the
// equivalent "repo root" is four parents up from web/src/lib/server/llm.
function defaultLogDir(): string {
	if (env.VERCEL) return path.join('/tmp', 'logs', 'llm_calls');
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.join(here, '..', '..', '..', '..', '..', 'logs', 'llm_calls');
}

export const LOG_DIR = defaultLogDir();

export class LLMResponseError extends Error {}

export interface LLMClient {
	modelName: string;
	completeJson(system: string, user: string): Promise<unknown>;
}

async function logCall(modelName: string, system: string, user: string, rawResponse: string): Promise<void> {
	const promptHash = createHash('sha256').update(system + '\n' + user, 'utf-8').digest('hex').slice(0, 16);
	const timestamp = new Date()
		.toISOString()
		.replace(/[-:]/g, '')
		.replace('T', 'T')
		.replace('Z', '')
		.replace('.', ''); // YYYYMMDDTHHMMSSmmm, close to Python's %Y%m%dT%H%M%S%f (microseconds)
	const record = {
		model_name: modelName,
		prompt_hash: promptHash,
		system,
		user,
		raw_response: rawResponse
	};
	try {
		await mkdir(LOG_DIR, { recursive: true });
		await writeFile(path.join(LOG_DIR, `${timestamp}-${promptHash}.json`), JSON.stringify(record, null, 2), 'utf-8');
	} catch {
		// Best-effort instrumentation only - never fail a real review over a log write.
	}
}

async function parseJsonResponse(modelName: string, system: string, user: string, raw: string): Promise<unknown> {
	await logCall(modelName, system, user, raw);
	try {
		return JSON.parse(raw);
	} catch (exc) {
		throw new LLMResponseError(`non-JSON response from ${modelName}: ${raw.slice(0, 300)}`);
	}
}

/** Deterministic client for tests - no network, no API key required. */
export class FakeLLMClient implements LLMClient {
	modelName: string;
	calls: Array<[string, string]> = [];
	private response?: unknown;
	private rawText?: string;

	constructor(opts: { response?: unknown; rawText?: string; modelName?: string } = {}) {
		this.response = opts.response;
		this.rawText = opts.rawText;
		this.modelName = opts.modelName ?? 'fake-llm';
	}

	async completeJson(system: string, user: string): Promise<unknown> {
		this.calls.push([system, user]);
		const raw = this.rawText !== undefined ? this.rawText : JSON.stringify(this.response);
		return parseJsonResponse(this.modelName, system, user, raw);
	}
}

export class AnthropicLLMClient implements LLMClient {
	modelName: string;
	private apiKey: string;

	constructor(apiKey: string, model = 'claude-sonnet-5') {
		this.apiKey = apiKey;
		this.modelName = model;
	}

	async completeJson(system: string, user: string): Promise<unknown> {
		const resp = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: this.modelName,
				max_tokens: 1024,
				system,
				messages: [{ role: 'user', content: user }]
			}),
			signal: AbortSignal.timeout(60_000)
		});
		if (!resp.ok) {
			throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
		}
		const body = (await resp.json()) as { content: Array<{ text: string }> };
		const raw = body.content[0].text;
		return parseJsonResponse(this.modelName, system, user, raw);
	}
}

/** Route dependency equivalent - throws clearly if unconfigured. */
export function getLlmClient(): LLMClient {
	const apiKey = env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error(
			'ANTHROPIC_API_KEY is not set; no LLM provider is configured for /ai-review. ' +
				'(Tests should inject a FakeLLMClient instead.)'
		);
	}
	return new AnthropicLLMClient(apiKey, env.ANTHROPIC_MODEL ?? 'claude-sonnet-5');
}
