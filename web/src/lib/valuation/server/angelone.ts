import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loginLimiter, candlesLimiter, ltpLimiter, quoteLimiter } from './rateLimiter';

/**
 * Collapses concurrent identical requests (same function + same key, e.g. two things asking
 * for TCS's LTP at the same moment) into a single in-flight call that both awaiters share,
 * instead of each independently queuing through the rate limiter. Keyed per-function so LTP and
 * candle dedup pools never collide.
 */
function dedupe<T>(pool: Map<string, Promise<T>>, key: string, fn: () => Promise<T>): Promise<T> {
	const existing = pool.get(key);
	if (existing) return existing;
	const promise = fn().finally(() => pool.delete(key));
	pool.set(key, promise);
	return promise;
}

const ltpInFlight = new Map<string, Promise<number | null>>();
const dailyCandlesInFlight = new Map<string, Promise<Candle[] | null>>();
const marketDepthInFlight = new Map<string, Promise<MarketDepth | null>>();

// Angel One SmartAPI — https://smartapi.angelbroking.com/docs
// Auth: CLIENT_CODE + PIN + TOTP (generated from ANGEL_TOTP_SECRET) -> JWT session token.
// Verified against the official `smartapi-python` SDK source (angel-one/smartapi-python)
// for exact routes, headers and request/response shapes.
const ROOT_URL = 'https://apiconnect.angelone.in';
const LOGIN_PATH = '/rest/auth/angelbroking/user/v1/loginByPassword';
const LTP_PATH = '/rest/secure/angelbroking/order/v1/getLtpData';
const HISTORICAL_PATH = '/rest/secure/angelbroking/historical/v1/getCandleData';
const QUOTE_PATH = '/rest/secure/angelbroking/market/v1/quote';
const SCRIP_MASTER_URL =
	'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

// Angel One documents a 1 request/second limit on the quote endpoint and similarly tight
// limits on historical data; both new fetchers below go through this so a page that needs
// several calls (e.g. sector rotation's 14 index lookups) doesn't get itself rate-limited.
// Per-endpoint pacing used to be one shared gate sized for the scarcest endpoint (candles),
// which over-throttled the much more generous LTP/quote endpoints. Each endpoint now has its
// own RateLimiter (rateLimiter.ts) enforcing Angel One's actual documented sec/min/hour caps at
// ~75% headroom — see requestWithAuthRetry below and each call site's `await <endpoint>Limiter.
// acquire()`. A real incident (concurrent watchlist row loads racing a single shared gate and
// bursting past the rate limit, silently dropping sparklines) is why RateLimiter serializes
// acquisitions through a promise chain rather than a naive read-wait-write check.

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Runs a request that needs a bearer token, retrying on failure — but 401 and 403 mean
 * different things and must not be handled the same way. A 401 means the token itself is
 * invalid/expired, so re-authenticating is the right fix. A 403 from Angel One's data/quote
 * endpoints is their rate-limit response ("Access denied because of exceeding access rate"),
 * not an auth failure — re-logging in does nothing to fix that and, worse, hammers the login
 * endpoint (which has its own, stricter rate limit) every time a data call gets rate-limited.
 * A real incident: sector-rotation's ~34 sequential candle calls occasionally hit a 403 on the
 * historical-data endpoint, each of which used to trigger a fresh login — enough repeated
 * logins in a short window to trip Angel One's login-rate-limit too, surfacing as
 * ANGEL_AUTH_FAILED even though nothing was actually wrong with the session.
 */
async function requestWithAuthRetry(
	makeRequest: (token: string) => Promise<Response>
): Promise<Response> {
	let token = await getAccessToken();
	let res = await makeRequest(token);

	if (res.status === 401) {
		cachedToken = null;
		token = await getAccessToken();
		res = await makeRequest(token);
		return res;
	}

	if (res.status === 403) {
		for (const backoffMs of [1000, 2000, 4000]) {
			await sleep(backoffMs);
			res = await makeRequest(token);
			if (res.status !== 403) break;
		}
	}

	return res;
}

// Read directly from the raw .env file rather than $env/dynamic/private: Vite's env loader
// runs every value through dotenv-expand, which treats bare `$` as variable-interpolation
// syntax and can silently mangle secrets that contain one (confirmed with the Groww secret
// this app used previously). A minimal, non-expanding parser avoids that class of bug.
// ENV_FILE names the file explicitly; otherwise it is the .env next to package.json. Where there
// is no file at all (Vercel - secrets come from the project settings, unexpanded), the process
// environment is used as-is.
let rawEnvCache: Record<string, string | undefined> | null = null;

function readRawEnvFile(): Record<string, string | undefined> {
	if (rawEnvCache) return rawEnvCache;

	const file = process.env.ENV_FILE || path.join(process.cwd(), '.env');
	if (!existsSync(file)) {
		rawEnvCache = process.env;
		return rawEnvCache;
	}
	const text = readFileSync(file, 'utf-8');
	const values: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		values[key] = value;
	}

	rawEnvCache = values;
	return values;
}

function base32Decode(input: string): Buffer {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const clean = input.toUpperCase().replace(/=+$/, '');
	let bits = '';
	for (const char of clean) {
		const val = alphabet.indexOf(char);
		if (val === -1) throw new Error('ANGEL_TOTP_INVALID: bad base32 character');
		bits += val.toString(2).padStart(5, '0');
	}
	const bytes: number[] = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		bytes.push(parseInt(bits.slice(i, i + 8), 2));
	}
	return Buffer.from(bytes);
}

/** RFC 6238 TOTP: 30s step, 6 digits, SHA-1 — verified against `pyotp` for correctness. */
function generateTotp(secret: string): string {
	const key = base32Decode(secret);
	const counter = Math.floor(Date.now() / 1000 / 30);
	const counterBuf = Buffer.alloc(8);
	counterBuf.writeBigUInt64BE(BigInt(counter));

	const hmac = createHmac('sha1', key).update(counterBuf).digest();
	const offset = hmac[hmac.length - 1] & 0x0f;
	const binCode =
		((hmac[offset] & 0x7f) << 24) |
		((hmac[offset + 1] & 0xff) << 16) |
		((hmac[offset + 2] & 0xff) << 8) |
		(hmac[offset + 3] & 0xff);

	return (binCode % 1_000_000).toString().padStart(6, '0');
}

function buildHeaders(jwtToken: string | null, apiKey: string | undefined): HeadersInit {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json',
		'X-ClientLocalIP': '127.0.0.1',
		'X-ClientPublicIP': '106.193.147.98',
		'X-MACAddress': '00:00:00:00:00:00',
		'X-PrivateKey': apiKey ?? '',
		'X-UserType': 'USER',
		'X-SourceID': 'WEB'
	};
	if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;
	return headers;
}

interface CachedToken {
	token: string;
	expiresAt: number;
}

let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
	if (cachedToken && Date.now() < cachedToken.expiresAt) {
		return cachedToken.token;
	}

	const env = readRawEnvFile();
	const clientCode = env.ANGEL_CLIENT_CODE;
	const pin = env.ANGEL_PIN;
	const totpSecret = env.ANGEL_TOTP_SECRET;
	const apiKey = env.ANGEL_API_KEY;
	if (!clientCode || !pin || !totpSecret || !apiKey) {
		throw new Error('ANGEL_CREDENTIALS_MISSING');
	}

	await loginLimiter.acquire();
	const res = await fetch(`${ROOT_URL}${LOGIN_PATH}`, {
		method: 'POST',
		headers: buildHeaders(null, apiKey),
		body: JSON.stringify({
			clientcode: clientCode,
			password: pin,
			totp: generateTotp(totpSecret)
		})
	});

	if (!res.ok) {
		throw new Error(`ANGEL_AUTH_FAILED: HTTP ${res.status} ${await res.text()}`);
	}

	const body = (await res.json()) as {
		status?: boolean;
		message?: string;
		data?: { jwtToken?: string };
	};
	if (!body.status || !body.data?.jwtToken) {
		throw new Error(`ANGEL_AUTH_FAILED: ${body.message ?? JSON.stringify(body)}`);
	}

	// "Session established via SmartAPI remains active till 12 midnight" per Angel One docs;
	// cache conservatively and re-login on any 401 regardless.
	cachedToken = { token: body.data.jwtToken, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
	return cachedToken.token;
}

export interface ScripEntry {
	token: string;
	symbol: string;
	name: string;
	exch_seg: string;
	instrumenttype?: string;
}

let scripIndex: Map<string, ScripEntry> | null = null;
let scripIndexFetchedAt = 0;
const SCRIP_INDEX_TTL_MS = 24 * 60 * 60 * 1000;

/** NSE series we can read daily candles for, best first. EQ is the normal board; BE is
 *  trade-to-trade; SM is the SME board (SAHASRA-SM and friends); RR and IV are REITs and InvITs
 *  (EMBASSY-RR); BZ is a surveillance series some listed names sit in (RAJESHEXPO-BZ). */
const NSE_SERIES_RANK: Record<string, number> = { EQ: 0, BE: 1, SM: 2, RR: 3, IV: 3, BZ: 4 };

/** Maps a ticker to the one listing the app reads prices from: the best NSE series, and for a
 *  name Angel One lists only on BSE (SPICEJET, ASMTEC) that BSE equity listing. Exported so the
 *  resolution rules can be tested without the network. */
export function buildScripIndex(entries: ScripEntry[]): Map<string, ScripEntry> {
	const index = new Map<string, ScripEntry>();
	const rank = (symbol: string) => NSE_SERIES_RANK[symbol.split('-').pop() ?? ''] ?? -1;
	for (const entry of entries) {
		if (entry.exch_seg !== 'NSE' || !entry.symbol.includes('-')) continue;
		const r = rank(entry.symbol);
		if (r === -1) continue;
		const key = entry.name.toUpperCase();
		const existing = index.get(key);
		if (!existing || r < rank(existing.symbol)) index.set(key, entry);
	}
	// BSE only fills names with no NSE listing. A BSE equity row has no suffix and no instrument type.
	for (const entry of entries) {
		if (entry.exch_seg !== 'BSE' || entry.symbol.includes('-') || entry.instrumenttype) continue;
		if (entry.symbol !== entry.name) continue;
		const key = entry.name.toUpperCase();
		if (!index.has(key)) index.set(key, entry);
	}
	return index;
}

async function getScripIndex(): Promise<Map<string, ScripEntry>> {
	if (scripIndex && Date.now() - scripIndexFetchedAt < SCRIP_INDEX_TTL_MS) {
		return scripIndex;
	}

	const res = await fetch(SCRIP_MASTER_URL);
	if (!res.ok) {
		throw new Error(`ANGEL_SCRIP_MASTER_FAILED: HTTP ${res.status}`);
	}
	const entries = (await res.json()) as ScripEntry[];

	const index = buildScripIndex(entries);

	scripIndex = index;
	scripIndexFetchedAt = Date.now();
	return index;
}

/** Whether Angel One's scrip master has a live NSE listing for `symbol` (i.e. whether charts and
 *  rotation data can actually be fetched for it). Used by the Sector Manager's verification. */
export async function isListedOnAngelOne(symbol: string): Promise<boolean> {
	const index = await getScripIndex();
	return index.has(symbol.toUpperCase());
}

/** Last traded price for an NSE-listed equity, or null if Angel One has no listing for the symbol. */
export function fetchLtp(symbol: string): Promise<number | null> {
	return dedupe(ltpInFlight, symbol.toUpperCase(), () => fetchLtpUncached(symbol));
}

async function fetchLtpUncached(symbol: string): Promise<number | null> {
	const index = await getScripIndex();
	const scrip = index.get(symbol.toUpperCase());
	if (!scrip) return null;

	const env = readRawEnvFile();
	const apiKey = env.ANGEL_API_KEY;

	const request = async (token: string) => {
		await ltpLimiter.acquire();
		return fetch(`${ROOT_URL}${LTP_PATH}`, {
			method: 'POST',
			headers: buildHeaders(token, apiKey),
			body: JSON.stringify({
				exchange: scrip.exch_seg,
				tradingsymbol: scrip.symbol,
				symboltoken: scrip.token
			})
		});
	};

	const res = await requestWithAuthRetry(request);

	if (!res.ok) {
		throw new Error(`ANGEL_LTP_FAILED: HTTP ${res.status} ${await res.text()}`);
	}

	const body = (await res.json()) as {
		status?: boolean;
		message?: string;
		data?: { ltp?: number | string };
	};
	if (!body.status) {
		throw new Error(`ANGEL_LTP_FAILED: ${body.message ?? JSON.stringify(body)}`);
	}

	const ltp = body.data?.ltp;
	if (ltp == null) return null;
	const price = typeof ltp === 'string' ? Number(ltp) : ltp;
	return Number.isFinite(price) ? price : null;
}

export interface Candle {
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

function formatDateForAngel(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 09:15`;
}

async function fetchCandlesByToken(
	exchange: string,
	symbolToken: string,
	fromDate: string,
	toDate: string
): Promise<Candle[]> {
	const env = readRawEnvFile();
	const apiKey = env.ANGEL_API_KEY;
	if (!apiKey) throw new Error('ANGEL_CREDENTIALS_MISSING');

	const request = async (token: string) => {
		await candlesLimiter.acquire();
		return fetch(`${ROOT_URL}${HISTORICAL_PATH}`, {
			method: 'POST',
			headers: buildHeaders(token, apiKey),
			body: JSON.stringify({
				exchange,
				symboltoken: symbolToken,
				interval: 'ONE_DAY',
				fromdate: fromDate,
				todate: toDate
			})
		});
	};

	const res = await requestWithAuthRetry(request);
	if (!res.ok) {
		throw new Error(`ANGEL_HISTORICAL_FAILED: HTTP ${res.status} ${await res.text()}`);
	}

	const body = (await res.json()) as {
		status?: boolean;
		message?: string;
		data?: (string | number)[][];
	};
	if (!body.status) {
		throw new Error(`ANGEL_HISTORICAL_FAILED: ${body.message ?? JSON.stringify(body)}`);
	}

	return (body.data ?? []).map((row) => ({
		date: String(row[0]),
		open: Number(row[1]),
		high: Number(row[2]),
		low: Number(row[3]),
		close: Number(row[4]),
		volume: Number(row[5])
	}));
}

/** Daily OHLCV candles for an NSE-listed equity, or null if Angel One has no listing for the
 *  symbol. `days` is calendar days of buffer requested from Angel One — expect somewhat fewer
 *  trading days back in the actual response. */
export function fetchDailyCandles(symbol: string, days = 320): Promise<Candle[] | null> {
	return dedupe(dailyCandlesInFlight, `${symbol.toUpperCase()}:${days}`, () =>
		fetchDailyCandlesUncached(symbol, days)
	);
}

async function fetchDailyCandlesUncached(symbol: string, days: number): Promise<Candle[] | null> {
	const index = await getScripIndex();
	const scrip = index.get(symbol.toUpperCase());
	if (!scrip) return null;

	const to = new Date();
	const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
	return fetchCandlesByToken(
		scrip.exch_seg,
		scrip.token,
		formatDateForAngel(from),
		formatDateForAngel(to)
	);
}

/** Daily OHLCV candles for an NSE index by its Angel One symbol token (see
 *  `sectorIndices.ts` for the confirmed token list — indices aren't equities so they don't
 *  appear in `getScripIndex()`'s -EQ/-BE filtered lookup). */
export async function fetchIndexCandles(token: string, days = 320): Promise<Candle[]> {
	const to = new Date();
	const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
	return fetchCandlesByToken('NSE', token, formatDateForAngel(from), formatDateForAngel(to));
}

export interface DepthLevel {
	price: number;
	quantity: number;
	orders: number;
}

export interface MarketDepth {
	ltp: number;
	open: number;
	high: number;
	low: number;
	close: number;
	totBuyQuan: number;
	totSellQuan: number;
	tradeVolume: number;
	depth: { buy: DepthLevel[]; sell: DepthLevel[] };
}

interface RawQuoteItem {
	ltp?: number | string;
	open?: number | string;
	high?: number | string;
	low?: number | string;
	close?: number | string;
	totBuyQuan?: number | string;
	totSellQuan?: number | string;
	tradeVolume?: number | string;
	depth?: {
		buy?: { price?: number | string; quantity?: number | string; orders?: number | string }[];
		sell?: { price?: number | string; quantity?: number | string; orders?: number | string }[];
	};
}

function num(v: number | string | undefined): number {
	if (v == null) return 0;
	const n = typeof v === 'string' ? Number(v) : v;
	return Number.isFinite(n) ? n : 0;
}

function mapDepthLevels(
	levels: { price?: number | string; quantity?: number | string; orders?: number | string }[] = []
): DepthLevel[] {
	return levels.map((l) => ({
		price: num(l.price),
		quantity: num(l.quantity),
		orders: num(l.orders)
	}));
}

/** Live 5-level bid/ask order book for an NSE-listed equity, via the quote endpoint's FULL
 *  mode (a plain REST call — Angel One's true WebSocket depth stream isn't needed for a
 *  point-in-time snapshot). Returns null if the symbol isn't listed on Angel One. */
export function fetchMarketDepth(symbol: string): Promise<MarketDepth | null> {
	return dedupe(marketDepthInFlight, symbol.toUpperCase(), () => fetchMarketDepthUncached(symbol));
}

async function fetchMarketDepthUncached(symbol: string): Promise<MarketDepth | null> {
	const index = await getScripIndex();
	const scrip = index.get(symbol.toUpperCase());
	if (!scrip) return null;

	const env = readRawEnvFile();
	const apiKey = env.ANGEL_API_KEY;
	if (!apiKey) throw new Error('ANGEL_CREDENTIALS_MISSING');

	const request = async (token: string) => {
		await quoteLimiter.acquire();
		return fetch(`${ROOT_URL}${QUOTE_PATH}`, {
			method: 'POST',
			headers: buildHeaders(token, apiKey),
			body: JSON.stringify({ mode: 'FULL', exchangeTokens: { [scrip.exch_seg]: [scrip.token] } })
		});
	};

	const res = await requestWithAuthRetry(request);
	if (!res.ok) {
		throw new Error(`ANGEL_QUOTE_FAILED: HTTP ${res.status} ${await res.text()}`);
	}

	const body = (await res.json()) as {
		status?: boolean;
		message?: string;
		data?: { fetched?: RawQuoteItem[]; unfetched?: unknown[] };
	};
	if (!body.status) {
		throw new Error(`ANGEL_QUOTE_FAILED: ${body.message ?? JSON.stringify(body)}`);
	}

	const item = body.data?.fetched?.[0];
	if (!item) return null;

	return {
		ltp: num(item.ltp),
		open: num(item.open),
		high: num(item.high),
		low: num(item.low),
		close: num(item.close),
		totBuyQuan: num(item.totBuyQuan),
		totSellQuan: num(item.totSellQuan),
		tradeVolume: num(item.tradeVolume),
		depth: {
			buy: mapDepthLevels(item.depth?.buy),
			sell: mapDepthLevels(item.depth?.sell)
		}
	};
}
