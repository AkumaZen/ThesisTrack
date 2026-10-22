import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Angel One answers a dead session with HTTP 200 and "Invalid Token" in the body. The candles call must
// drop the cached session, log in again and retry once; a second failure surfaces as before.
let logins = 0;
let candleBodies: object[] = [];
let candleTokens: string[] = [];

function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
	if (url.includes('loginByPassword')) {
		logins++;
		return Promise.resolve(Response.json({ status: true, data: { jwtToken: `jwt${logins}` } }));
	}
	if (url.includes('getCandleData')) {
		candleTokens.push(String((init!.headers as Record<string, string>).Authorization));
		const next = candleBodies.shift() ?? { status: false, message: 'Invalid Token' };
		return Promise.resolve(Response.json(next));
	}
	return Promise.resolve(new Response('{}', { status: 404 }));
}

const ok = { status: true, data: [['2026-10-16T00:00:00+05:30', 1, 2, 0.5, 1.5, 10]] };
let fetchScripCandles: typeof import('./angelone').fetchScripCandles;

beforeAll(async () => {
	process.env.ENV_FILE = 'does-not-exist.env';
	Object.assign(process.env, { ANGEL_CLIENT_CODE: 'x', ANGEL_PIN: 'x', ANGEL_TOTP_SECRET: 'JBSWY3DPEHPK3PXP', ANGEL_API_KEY: 'x' });
	vi.stubGlobal('fetch', vi.fn(fakeFetch));
	({ fetchScripCandles } = await import('./angelone'));
});
beforeEach(() => {
	candleBodies = [];
	candleTokens = [];
});

const from = new Date('2026-10-01T00:00:00Z');
const to = new Date('2026-10-17T00:00:00Z');

describe('fetchScripCandles session recovery', () => {
	it('retries once with a fresh login after an Invalid Token body', async () => {
		candleBodies = [ok];
		await fetchScripCandles('NSE', '1', from, to); // warms the session cache
		const before = logins;
		candleBodies = [{ status: false, message: 'Invalid Token', errorcode: 'AG8001' }, ok];
		const candles = await fetchScripCandles('NSE', '2', from, to);
		expect(candles).toHaveLength(1);
		expect(logins).toBe(before + 1);
		expect(candleTokens.slice(-2)[0]).not.toBe(candleTokens.slice(-1)[0]); // the retry used the new session
	}, 30_000);

	it('surfaces the error when the retry fails too (one retry only)', async () => {
		const before = candleTokens.length;
		candleBodies = [
			{ status: false, message: 'Invalid Token' },
			{ status: false, message: 'Invalid Token' }
		];
		await expect(fetchScripCandles('NSE', '3', from, to)).rejects.toThrow(/ANGEL_HISTORICAL_FAILED: Invalid Token/);
		expect(candleTokens.length - before).toBe(2);
	}, 30_000);

	it('does not retry other failures', async () => {
		candleBodies = [{ status: false, message: 'Something else' }];
		await expect(fetchScripCandles('NSE', '4', from, to)).rejects.toThrow(/Something else/);
		expect(candleTokens).toHaveLength(1);
	}, 30_000);
});

describe('sessionExpiry', () => {
	it('expires just before midnight IST for an evening login, else after 6h', async () => {
		const { sessionExpiry } = await import('./angelone');
		const ist = (iso: string) => Date.parse(`${iso}+05:30`);
		expect(sessionExpiry(ist('2026-10-20T21:00:00'))).toBe(ist('2026-10-20T23:59:00'));
		expect(sessionExpiry(ist('2026-10-20T10:00:00'))).toBe(ist('2026-10-20T16:00:00'));
	});
});
