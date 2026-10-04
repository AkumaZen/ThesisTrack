import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { benchmarkSeriesCache, companyGrowthSeriesCache } from '$lib/server/db/valuationSchema';
import { getBenchmarkCandles } from './benchmarkSeries';
import { getCompanySeries } from './companyGrowthSeries';
import { getSymbolNames, listAllBaskets, listAllMajorSectors } from './sectorStore';
import type { CustomSector, MajorSector } from './customSectors';
import { buildEqualWeightedIndex, type Candle } from '../sectorRotation';
import {
	alignMember,
	evaluateStrength,
	lastCompleteSessionDate,
	type Member,
	type StrengthConfig,
	type StrengthInput,
	type StrengthLevel,
	type StrengthResult,
	type StrengthRow
} from '../strength';

export type { StrengthLevel, StrengthResult, StrengthRow };

// Reads the candle caches the background warmer already keeps fresh and evaluates the shared
// strength maths over them. It never waits on Angel One for the sector views: a symbol that is
// not cached yet simply reports "unavailable". The filter API and the alert checks both come
// through here, so they use identical data and identical calculations.

interface Universe {
	cutoff: string;
	calendar: string[];
	benchmark: (number | null)[];
	stocks: Map<string, Member>;
	majors: MajorSector[];
	baskets: CustomSector[];
	basketPrice: Map<string, (number | null)[]>;
	majorPrice: Map<string, (number | null)[]>;
}

const TTL_MS = 90_000;
let cached: { at: number; universe: Universe } | null = null;

const upTo = (candles: Candle[], cutoff: string) => candles.filter((c) => c.date.slice(0, 10) <= cutoff);

async function readBenchmark(): Promise<Candle[]> {
	const [row] = await db.select().from(benchmarkSeriesCache).where(eq(benchmarkSeriesCache.id, 'nifty50'));
	return row ? (row.candles as Candle[]) : getBenchmarkCandles();
}

async function readStockCache(): Promise<Map<string, Candle[]>> {
	const rows = await db.select().from(companyGrowthSeriesCache);
	return new Map(rows.map((r) => [r.symbol, r.candles as Candle[]]));
}

async function loadUniverse(): Promise<Universe> {
	const cutoff = lastCompleteSessionDate();
	if (cached && Date.now() - cached.at < TTL_MS && cached.universe.cutoff === cutoff)
		return cached.universe;

	const [niftyRaw, stockRaw, majors, baskets] = await Promise.all([
		readBenchmark(),
		readStockCache(),
		listAllMajorSectors(),
		listAllBaskets()
	]);
	const nifty = upTo(niftyRaw, cutoff);
	const calendar = nifty.map((c) => c.date.slice(0, 10));
	const benchmark = nifty.map((c) => (c.close > 0 ? c.close : null));

	const stocks = new Map<string, Member>();
	const stockCandles = new Map<string, Candle[]>();
	for (const b of baskets) {
		for (const symbol of b.symbols) {
			if (stocks.has(symbol)) continue;
			const raw = stockRaw.get(symbol);
			if (!raw) continue;
			const candles = upTo(raw, cutoff);
			stockCandles.set(symbol, candles);
			stocks.set(symbol, alignMember(candles, calendar));
		}
	}

	// A basket's price is the equal-weighted index the rotation page already uses; a major sector's
	// is the equal-weighted index of its baskets, built the same way one layer up.
	const basketCandles = new Map<string, Candle[]>();
	const basketPrice = new Map<string, (number | null)[]>();
	for (const b of baskets) {
		const members = b.symbols.map((s) => stockCandles.get(s)).filter((c): c is Candle[] => !!c);
		const idx = buildEqualWeightedIndex(members);
		basketCandles.set(b.key, idx);
		basketPrice.set(b.key, alignMember(idx, calendar).closes);
	}
	const majorPrice = new Map<string, (number | null)[]>();
	for (const m of majors) {
		const parts = m.subsectorKeys.map((k) => basketCandles.get(k)).filter((c): c is Candle[] => !!c && c.length > 0);
		majorPrice.set(m.key, alignMember(buildEqualWeightedIndex(parts), calendar).closes);
	}

	const universe: Universe = { cutoff, calendar, benchmark, stocks, majors, baskets, basketPrice, majorPrice };
	cached = { at: Date.now(), universe };
	return universe;
}

const symbolsOf = (u: Universe, basketKeys: string[]): string[] => {
	const bySet = new Set<string>();
	for (const k of basketKeys) for (const s of u.baskets.find((b) => b.key === k)?.symbols ?? []) bySet.add(s);
	return [...bySet];
};

const membersOf = (u: Universe, symbols: string[]): Member[] =>
	symbols.map((s) => u.stocks.get(s)).filter((m): m is Member => !!m);

function groupInput(u: Universe, price: (number | null)[] | undefined, symbols: string[]): StrengthInput {
	return {
		calendar: u.calendar,
		benchmark: u.benchmark,
		price: price ?? u.calendar.map(() => null),
		members: membersOf(u, symbols),
		kind: 'group'
	};
}

function companyInput(u: Universe, member: Member | undefined): StrengthInput {
	return {
		calendar: u.calendar,
		benchmark: u.benchmark,
		price: member?.closes ?? u.calendar.map(() => null),
		members: member ? [member] : [],
		kind: 'company'
	};
}

export async function evaluateLevel(
	level: StrengthLevel,
	parentKey: string | null,
	config: StrengthConfig
): Promise<StrengthResult> {
	const u = await loadUniverse();
	const rows: StrengthRow[] = [];

	if (level === 'sectors') {
		for (const m of u.majors) {
			rows.push({
				key: m.key,
				label: m.label,
				href: `/valuation/sector-rotation/${m.key}`,
				evaluation: evaluateStrength(groupInput(u, u.majorPrice.get(m.key), symbolsOf(u, m.subsectorKeys)), config)
			});
		}
	} else if (level === 'subsectors') {
		const majors = parentKey ? u.majors.filter((m) => m.key === parentKey) : u.majors;
		const seen = new Set<string>();
		for (const m of majors) {
			for (const key of m.subsectorKeys) {
				const basket = u.baskets.find((b) => b.key === key);
				if (!basket || seen.has(key)) continue;
				seen.add(key);
				rows.push({
					key,
					label: basket.label,
					href: `/valuation/sector-rotation/${m.key}/${key}`,
					evaluation: evaluateStrength(groupInput(u, u.basketPrice.get(key), basket.symbols), config)
				});
			}
		}
	} else if (level === 'companies') {
		const baskets = parentKey ? u.baskets.filter((b) => b.key === parentKey) : u.baskets;
		const symbols = [...new Set(baskets.flatMap((b) => b.symbols))];
		const names = await getSymbolNames(symbols);
		for (const symbol of symbols) {
			rows.push({
				key: symbol,
				label: names[symbol] ?? symbol,
				href: `/valuation/company/${encodeURIComponent(symbol)}`,
				evaluation: evaluateStrength(companyInput(u, u.stocks.get(symbol)), config)
			});
		}
	} else {
		const symbol = (parentKey ?? '').toUpperCase();
		let member = u.stocks.get(symbol);
		if (!member && symbol) {
			// Not in any basket: fall back to the shared (fetching) series cache for this one symbol.
			const candles = await getCompanySeries(symbol);
			if (candles) member = alignMember(upTo(candles, u.cutoff), u.calendar);
		}
		const names = await getSymbolNames([symbol]);
		rows.push({
			key: symbol,
			label: names[symbol] ?? symbol,
			href: `/valuation/company/${encodeURIComponent(symbol)}`,
			evaluation: evaluateStrength(companyInput(u, member), config)
		});
	}

	return { asOf: u.calendar.length ? u.calendar[u.calendar.length - 1] : null, calendar: u.calendar, rows };
}
