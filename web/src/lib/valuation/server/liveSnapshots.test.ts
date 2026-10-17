import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Angel One is faked at the network edge: login, instrument list and quote endpoint.
const SCRIPS = Array.from({ length: 120 }, (_, i) => ({
	token: String(1000 + i),
	symbol: `S${i}-EQ`,
	name: `S${i}`,
	exch_seg: 'NSE'
}));

let quoteCalls: string[][] = [];
let quoteBehaviour: (call: number, tokens: string[]) => Response = () => new Response('{}', { status: 500 });

function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
	if (url.includes('OpenAPIScripMaster')) return Promise.resolve(Response.json(SCRIPS));
	if (url.includes('loginByPassword')) return Promise.resolve(Response.json({ status: true, data: { jwtToken: 't' } }));
	if (url.includes('/market/v1/quote')) {
		const body = JSON.parse(init!.body as string) as { exchangeTokens: Record<string, string[]> };
		const tokens = body.exchangeTokens.NSE ?? [];
		quoteCalls.push(tokens);
		return Promise.resolve(quoteBehaviour(quoteCalls.length, tokens));
	}
	return Promise.resolve(new Response('{}', { status: 404 }));
}

const quoteOk = (tokens: string[]) =>
	Response.json({
		status: true,
		data: {
			fetched: tokens.map((t) => ({
				exchange: 'NSE',
				symbolToken: t,
				ltp: Number(t) / 10,
				tradeVolume: 7,
				exchFeedTime: '17-Oct-2026 15:30:00'
			})),
			unfetched: []
		}
	});

let fetchLiveSnapshots: typeof import('./angelone').fetchLiveSnapshots;

beforeAll(async () => {
	process.env.ENV_FILE = 'does-not-exist.env';
	Object.assign(process.env, {
		ANGEL_CLIENT_CODE: 'x',
		ANGEL_PIN: 'x',
		ANGEL_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
		ANGEL_API_KEY: 'x'
	});
	vi.stubGlobal('fetch', vi.fn(fakeFetch));
	({ fetchLiveSnapshots } = await import('./angelone'));
});
afterEach(() => {
	quoteCalls = [];
});

describe('fetchLiveSnapshots', () => {
	it('makes ceil(n/50) quote calls and reports unlisted symbols without a call', async () => {
		quoteBehaviour = (_c, tokens) => quoteOk(tokens);
		const symbols = [...Array.from({ length: 120 }, (_, i) => `S${i}`), 'NOSUCH'];
		const r = await fetchLiveSnapshots(symbols);
		expect(quoteCalls).toHaveLength(3);
		expect(quoteCalls.map((c) => c.length)).toEqual([50, 50, 20]);
		expect(r.snapshots.size).toBe(120);
		expect(r.snapshots.get('S3')).toEqual({ ltp: 100.3, tradeVolume: 7 });
		expect(r.unlisted).toEqual(['NOSUCH']);
		expect(r.failed).toEqual([]);
	});

	it('reports a failed request as failed for that chunk only, not as a throw', async () => {
		quoteBehaviour = (call, tokens) => (call === 2 ? new Response('nope', { status: 500 }) : quoteOk(tokens));
		const r = await fetchLiveSnapshots(Array.from({ length: 120 }, (_, i) => `S${i}`));
		expect(r.failed).toHaveLength(50);
		expect(r.failed[0]).toBe('S50');
		expect(r.snapshots.size).toBe(70);
	});

	it('lists listed symbols the quote answered nothing for as missing', async () => {
		quoteBehaviour = (_c, tokens) => quoteOk(tokens.filter((t) => t !== '1001'));
		const r = await fetchLiveSnapshots(['S0', 'S1']);
		expect(r.missing).toEqual(['S1']);
		expect(r.snapshots.has('S0')).toBe(true);
	});
});
