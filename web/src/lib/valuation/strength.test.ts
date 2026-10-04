import { describe, expect, it } from 'vitest';
import {
	DEFAULT_REPEAT,
	DEFAULT_STRENGTH_CONFIG,
	alignMember,
	detectStrengthEntry,
	describeStrengthConfig,
	emptyStrengthView,
	isStrengthActive,
	passesStrength,
	evaluateStrength,
	gradualStrength,
	lastCompleteSessionDate,
	parseRepeat,
	parseRuleState,
	parseStrengthConfig,
	spreadingStrength,
	suddenStrength,
	volumeConfirmation,
	type Member,
	type StrengthConfig,
	type StrengthInput
} from './strength';

const N = 200;
const calendar = Array.from({ length: N }, (_, i) => {
	const d = new Date(Date.UTC(2026, 0, 1 + i));
	return d.toISOString().slice(0, 10);
});

/** Deterministic noise in [-1, 1]. */
const noise = (i: number, seed = 1) => Math.sin(i * 12.9898 * seed) * 0.5 + Math.cos(i * 78.233 * seed) * 0.5;

/** Builds a price series from daily % returns. */
function series(dailyPct: (i: number) => number, start = 100): number[] {
	const out = [start];
	for (let i = 1; i < N; i++) out.push(out[i - 1] * (1 + dailyPct(i) / 100));
	return out;
}

const flatBench = series(() => 0);
const noisy = (seed: number, extra: (i: number) => number = () => 0) =>
	series((i) => noise(i, seed) * 0.4 + extra(i));

function input(price: (number | null)[], members: Member[] = [], kind: 'group' | 'company' = 'group'): StrengthInput {
	return { calendar, benchmark: flatBench, price, members, kind };
}

const cfg = (patch: Partial<StrengthConfig>): StrengthConfig => ({
	...DEFAULT_STRENGTH_CONFIG,
	...patch
});
const withSudden = (extra: Partial<StrengthConfig['sudden']> = {}) =>
	cfg({ sudden: { ...DEFAULT_STRENGTH_CONFIG.sudden, enabled: true, ...extra } });

describe('suddenStrength', () => {
	it('fires on a jump that is large against the subject own history', () => {
		const price = noisy(1, (i) => (i > N - 4 ? 2 : 0)); // +2%/day for the last 3 sessions
		const r = suddenStrength(input(price), withSudden());
		expect(r.status).toBe('ok');
		expect(r.matched).toBe(true);
		expect(r.metrics.z).toBeGreaterThanOrEqual(2);
	});

	it('does not fire for a subject that is simply always strong (high level, no change)', () => {
		const price = noisy(2, () => 0.3); // +0.3%/day vs flat Nifty, every day
		const r = suddenStrength(input(price), withSudden());
		expect(r.status).toBe('ok');
		expect(r.matched).toBe(false);
	});

	it('uses a fixed threshold in explicit mode', () => {
		const price = noisy(3, (i) => (i > N - 6 ? 2 : 0));
		const hit = suddenStrength(input(price), withSudden({ mode: 'explicit', explicitRsPct: 5 }));
		const miss = suddenStrength(input(price), withSudden({ mode: 'explicit', explicitRsPct: 40 }));
		expect(hit.matched).toBe(true);
		expect(miss.matched).toBe(false);
	});

	it('excludes the measured window from its own baseline', () => {
		// If the current window leaked into the baseline the median/MAD would shift toward it.
		const price = noisy(4, (i) => (i > N - 4 ? 3 : 0));
		const r = suddenStrength(input(price), withSudden());
		const early = noisy(4)[N - 1 - 5]; // price just before the window is irrelevant to the baseline median
		expect(early).toBeGreaterThan(0);
		expect(Math.abs(r.metrics.baselineMedian)).toBeLessThan(2);
	});

	it('reports unavailable, never a match, when history is short', () => {
		const short: StrengthInput = {
			calendar: calendar.slice(0, 100),
			benchmark: flatBench.slice(0, 100),
			price: noisy(5).slice(0, 100),
			members: [],
			kind: 'group'
		};
		const r = suddenStrength(short, withSudden());
		expect(r.status).toBe('unavailable');
		expect(r.matched).toBe(false);
		expect(r.detail).toMatch(/Needs 136 sessions/);
	});

	it('reports unavailable when the latest price is missing (stale series)', () => {
		const price: (number | null)[] = noisy(6);
		price[N - 1] = null;
		expect(suddenStrength(input(price), withSudden()).status).toBe('unavailable');
	});

	it('does not let a near-flat baseline turn a tiny move into a huge z', () => {
		const price = series((i) => (i > N - 4 ? 0.1 : 0)); // perfectly flat history, then +0.1%/day
		const r = suddenStrength(input(price), withSudden({ minRsPct: 0 }));
		expect(r.metrics.z).toBeLessThan(2);
		expect(r.matched).toBe(false);
	});
});

describe('gradualStrength', () => {
	const gradual = (extra: Partial<StrengthConfig['gradual']> = {}) =>
		cfg({ gradual: { ...DEFAULT_STRENGTH_CONFIG.gradual, enabled: true, ...extra } });

	it('matches steady improvement across many sessions', () => {
		const price = series((i) => (i > N - 11 ? 0.3 + (i % 2 ? 0.05 : -0.05) : 0));
		const r = gradualStrength(input(price), gradual());
		expect(r.status).toBe('ok');
		expect(r.matched).toBe(true);
		expect(r.metrics.improving).toBeGreaterThanOrEqual(6);
	});

	it('rejects one isolated jump even though the gain is large', () => {
		const price = series((i) => (i === N - 3 ? 6 : 0));
		const r = gradualStrength(input(price), gradual());
		expect(r.metrics.gain).toBeGreaterThan(5);
		expect(r.matched).toBe(false);
	});

	it('rejects a window where the subject beat Nifty on too few sessions', () => {
		const price = series((i) => (i > N - 11 ? (i % 3 === 0 ? 1.2 : -0.1) : 0));
		const r = gradualStrength(input(price), gradual());
		expect(r.metrics.improving).toBeLessThan(6);
		expect(r.matched).toBe(false);
	});

	it('is unavailable if a session in the window has no price', () => {
		const price: (number | null)[] = series(() => 0.2);
		price[N - 5] = null;
		expect(gradualStrength(input(price), gradual()).status).toBe('unavailable');
	});
});

/** Stocks whose latest `days` sessions outperform (or not) a flat Nifty. */
function stock(opts: { riseFrom: number; rise: number; volume?: (i: number) => number | null }): Member {
	const closes = series((i) => (i >= opts.riseFrom ? opts.rise : 0));
	return {
		closes,
		volumes: closes.map((_, i) => (opts.volume ? opts.volume(i) : 1000))
	};
}

describe('spreadingStrength', () => {
	const spread = (extra: Partial<StrengthConfig['spreading']> = {}) =>
		cfg({ spreading: { ...DEFAULT_STRENGTH_CONFIG.spreading, enabled: true, ...extra } });

	it('measures breadth and its change over the same number of sessions', () => {
		// 10 stocks: all flat until 10 sessions ago when 7 begin to outperform.
		const members = [
			...Array.from({ length: 7 }, () => stock({ riseFrom: N - 10, rise: 0.5 })),
			...Array.from({ length: 3 }, () => stock({ riseFrom: N, rise: 0 }))
		];
		const r = spreadingStrength(input(flatBench, members), spread());
		expect(r.status).toBe('ok');
		expect(r.metrics.breadth).toBeCloseTo(70, 5);
		expect(r.metrics.before).toBeCloseTo(0, 5);
		expect(r.matched).toBe(true);
	});

	it('does not match when breadth is high but did not grow', () => {
		const members = Array.from({ length: 10 }, () => stock({ riseFrom: 1, rise: 0.2 }));
		const r = spreadingStrength(input(flatBench, members), spread());
		expect(r.metrics.breadth).toBe(100);
		expect(r.metrics.change).toBe(0);
		expect(r.matched).toBe(false);
	});

	it('is unavailable when too few constituents have complete data', () => {
		const good = stock({ riseFrom: N - 10, rise: 0.5 });
		const stale: Member = { closes: good.closes.map((c, i) => (i > N - 4 ? null : c)), volumes: good.volumes };
		const r = spreadingStrength(input(flatBench, [good, good, stale, stale, stale, stale]), spread());
		expect(r.status).toBe('unavailable');
		expect(r.detail).toMatch(/Only 2 of 6/);
	});

	it('counts the same stocks in both snapshots', () => {
		const rising = stock({ riseFrom: N - 10, rise: 0.5 });
		const newListing: Member = {
			closes: rising.closes.map((c, i) => (i < N - 12 ? null : c)),
			volumes: rising.volumes
		};
		const r = spreadingStrength(
			input(flatBench, [rising, rising, rising, rising, rising, newListing]),
			spread()
		);
		expect(r.metrics.valid).toBe(5);
		expect(r.metrics.total).toBe(6);
	});
});

describe('volumeConfirmation', () => {
	const vol = (extra: Partial<StrengthConfig['volume']> = {}) =>
		cfg({ volume: { ...DEFAULT_STRENGTH_CONFIG.volume, enabled: true, ...extra } });
	const rising = (volume: (i: number) => number | null) => stock({ riseFrom: N - 5, rise: 0.5, volume });

	it('confirms when recent volume is well above the previous average and price outperforms', () => {
		const m = rising((i) => (i >= N - 5 ? 2000 : 1000));
		const r = volumeConfirmation(input(m.closes, [m], 'company'), vol());
		expect(r.metrics.ratio).toBeCloseTo(2, 5);
		expect(r.matched).toBe(true);
	});

	it('excludes the measured window from its baseline', () => {
		// Baseline is the 20 sessions BEFORE the 5-session window: 1000 each. If the window leaked
		// in, the baseline would be higher and the ratio lower than 2.
		const m = rising((i) => (i >= N - 5 ? 2000 : 1000));
		const r = volumeConfirmation(input(m.closes, [m], 'company'), vol());
		expect(r.metrics.ratio).toBeCloseTo(2, 5);
	});

	it('does not confirm high volume on a falling price (high-volume weakness)', () => {
		const closes = series((i) => (i >= N - 5 ? -1 : 0));
		const m: Member = { closes, volumes: closes.map((_, i) => (i >= N - 5 ? 3000 : 1000)) };
		const r = volumeConfirmation(input(closes, [m], 'company'), vol());
		expect(r.metrics.ratio).toBeGreaterThanOrEqual(1.5);
		expect(r.matched).toBe(false);
		expect(r.detail).toMatch(/high-volume weakness/);
	});

	it('normalises each stock against its own history instead of summing raw volume', () => {
		// A huge-volume stock that is flat plus three small stocks that doubled. Raw totals would
		// read ~1.0x; per-stock ratios then the median read 2x.
		const big: Member = stock({ riseFrom: N - 5, rise: 0.5, volume: () => 50_000_000 });
		const small = () => rising((i) => (i >= N - 5 ? 200 : 100));
		const r = volumeConfirmation(input(big.closes, [big, small(), small(), small()]), vol());
		expect(r.metrics.ratio).toBeCloseTo(2, 5);
	});

	it('uses the median so one spiking stock cannot carry a group', () => {
		const calm = () => rising(() => 1000);
		const spike = rising((i) => (i >= N - 5 ? 100_000 : 1000));
		const r = volumeConfirmation(input(spike.closes, [calm(), calm(), calm(), spike]), vol());
		expect(r.metrics.ratio).toBeCloseTo(1, 5);
		expect(r.matched).toBe(false);
	});

	it('treats missing volume as missing, not zero, and flags thin coverage', () => {
		const m = rising((i) => (i >= N - 5 ? 2000 : i % 2 === 0 ? null : 1000));
		const r = volumeConfirmation(input(m.closes, [m], 'company'), vol());
		expect(r.status).toBe('unavailable');
	});

	it('is unavailable when history is shorter than window plus baseline', () => {
		const m = rising(() => 1000);
		const short: StrengthInput = {
			calendar: calendar.slice(0, 20),
			benchmark: flatBench.slice(0, 20),
			price: m.closes.slice(0, 20),
			members: [{ closes: m.closes.slice(0, 20), volumes: m.volumes.slice(0, 20) }],
			kind: 'company'
		};
		expect(volumeConfirmation(short, vol()).status).toBe('unavailable');
	});
});

describe('evaluateStrength', () => {
	const jumper = noisy(1, (i) => (i > N - 4 ? 2 : 0));
	const members = [stock({ riseFrom: N - 10, rise: 0.5 }), stock({ riseFrom: N - 10, rise: 0.5 })];

	it('is inactive and matches everything when nothing is switched on', () => {
		const r = evaluateStrength(input(jumper, members), DEFAULT_STRENGTH_CONFIG);
		expect(r.active).toBe(false);
		expect(r.matched).toBe(true);
	});

	it('combines price signals with any / all', () => {
		const both = {
			sudden: { ...DEFAULT_STRENGTH_CONFIG.sudden, enabled: true },
			gradual: { ...DEFAULT_STRENGTH_CONFIG.gradual, enabled: true }
		};
		const oneDay = noisy(1, (i) => (i === N - 2 ? 8 : 0)); // sudden, but a single-day jump
		const any = evaluateStrength(input(oneDay, members), cfg({ ...both, match: 'any' }));
		const all = evaluateStrength(input(oneDay, members), cfg({ ...both, match: 'all' }));
		expect(any.matched).toBe(true); // sudden matches, gradual (single-jump style) does not
		expect(all.matched).toBe(false);
		expect(any.reasons).toHaveLength(1);
		expect(any.reasons[0]).toMatch(/^Suddenly strengthening/);
	});

	it('requires volume as a gate when a price signal is also on', () => {
		const m = stock({ riseFrom: N - 5, rise: 0.5, volume: () => 1000 });
		const base = {
			sudden: { ...DEFAULT_STRENGTH_CONFIG.sudden, enabled: true },
			volume: { ...DEFAULT_STRENGTH_CONFIG.volume, enabled: true }
		};
		const price = noisy(1, (i) => (i > N - 4 ? 2 : 0));
		const flatVol = evaluateStrength(input(price, [m], 'company'), cfg(base));
		expect(flatVol.signals.sudden.matched).toBe(true);
		expect(flatVol.signals.volume.matched).toBe(false);
		expect(flatVol.matched).toBe(false);

		const surge: Member = { closes: price, volumes: price.map((_, i) => (i >= N - 5 ? 2500 : 1000)) };
		expect(evaluateStrength(input(price, [surge], 'company'), cfg(base)).matched).toBe(true);
	});

	it('treats volume alone as a signal', () => {
		const m = stock({ riseFrom: N - 5, rise: 0.5, volume: (i) => (i >= N - 5 ? 2500 : 1000) });
		const r = evaluateStrength(
			input(m.closes, [m], 'company'),
			cfg({ volume: { ...DEFAULT_STRENGTH_CONFIG.volume, enabled: true } })
		);
		expect(r.matched).toBe(true);
	});

	it('never lets an unavailable signal match, and lists why', () => {
		const short: StrengthInput = {
			calendar: calendar.slice(0, 50),
			benchmark: flatBench.slice(0, 50),
			price: jumper.slice(0, 50),
			members: [],
			kind: 'group'
		};
		const r = evaluateStrength(short, withSudden());
		expect(r.matched).toBe(false);
		expect(r.unavailable).toHaveLength(1);
		expect(r.signals.sudden.status).toBe('unavailable');
	});

	it('ignores the spreading signal for a single company', () => {
		const r = evaluateStrength(
			input(jumper, [stock({ riseFrom: 1, rise: 0.1 })], 'company'),
			cfg({ spreading: { ...DEFAULT_STRENGTH_CONFIG.spreading, enabled: true } })
		);
		expect(r.signals.spreading.status).toBe('off');
		expect(r.active).toBe(false);
	});
});

describe('detectStrengthEntry', () => {
	const cal = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10'];
	const policy = { mode: 'rearm', cooldownSessions: 3 } as const;

	it('seeds silently on the first reading, even when already true', () => {
		const r = detectStrengthEntry(null, true, 'd1', policy, cal);
		expect(r.fire).toBe(false);
		expect(r.next).toEqual({ matched: true, firedOn: null });
	});

	it('fires on entry, not while the condition stays true', () => {
		const enter = detectStrengthEntry({ matched: false, firedOn: null }, true, 'd2', policy, cal);
		expect(enter.fire).toBe(true);
		const stay = detectStrengthEntry(enter.next, true, 'd3', policy, cal);
		expect(stay.fire).toBe(false);
	});

	it('does not fire on exit', () => {
		const r = detectStrengthEntry({ matched: true, firedOn: 'd1' }, false, 'd5', policy, cal);
		expect(r.fire).toBe(false);
		expect(r.next.matched).toBe(false);
	});

	it('suppresses a re-entry inside the cooldown, and allows it after', () => {
		const prev = { matched: false, firedOn: 'd2' };
		expect(detectStrengthEntry(prev, true, 'd4', policy, cal).fire).toBe(false); // 2 sessions
		expect(detectStrengthEntry(prev, true, 'd5', policy, cal).fire).toBe(true); // 3 sessions
	});

	it('fires only once in "once" mode', () => {
		const once = { mode: 'once', cooldownSessions: 0 } as const;
		const first = detectStrengthEntry({ matched: false, firedOn: null }, true, 'd2', once, cal);
		expect(first.fire).toBe(true);
		const again = detectStrengthEntry({ matched: false, firedOn: first.next.firedOn }, true, 'd9', once, cal);
		expect(again.fire).toBe(false);
	});

	it('is idempotent when re-checked within the same session', () => {
		const prev = detectStrengthEntry({ matched: false, firedOn: null }, true, 'd2', policy, cal).next;
		expect(detectStrengthEntry(prev, true, 'd2', policy, cal).fire).toBe(false);
	});
});

describe('config and helpers', () => {
	it('clamps and sanitises stored configs', () => {
		const c = parseStrengthConfig({
			periodDays: 9999,
			baselineDays: -5,
			match: 'weird',
			sudden: { enabled: true, z: 'abc' },
			gradual: { days: 10, minImprovingSessions: 99 },
			bogus: 1
		});
		expect(c.periodDays).toBe(63);
		expect(c.baselineDays).toBe(30);
		expect(c.match).toBe('any');
		expect(c.sudden.enabled).toBe(true);
		expect(c.sudden.z).toBe(DEFAULT_STRENGTH_CONFIG.sudden.z);
		expect(c.gradual.minImprovingSessions).toBe(10);
		expect(parseStrengthConfig(null)).toEqual(DEFAULT_STRENGTH_CONFIG);
	});

	it('parses repeat policy and stored rule state defensively', () => {
		expect(parseRepeat(undefined)).toEqual(DEFAULT_REPEAT);
		expect(parseRepeat({ mode: 'once', cooldownSessions: 2 })).toEqual({ mode: 'once', cooldownSessions: 2 });
		expect(parseRuleState('not json')).toBeNull();
		expect(parseRuleState('{"matched":true,"firedOn":"2026-01-02"}')).toEqual({
			matched: true,
			firedOn: '2026-01-02'
		});
	});

	it('aligns candles to the calendar, treating zero volume and bad closes as missing', () => {
		const m = alignMember(
			[
				{ date: '2026-01-01T00:00:00+05:30', close: 10, volume: 5 },
				{ date: '2026-01-03T00:00:00+05:30', close: 0, volume: 0 }
			],
			['2026-01-01', '2026-01-02', '2026-01-03']
		);
		expect(m.closes).toEqual([10, null, null]);
		expect(m.volumes).toEqual([5, null, null]);
	});

	it('only trusts today bar after 16:00 IST', () => {
		// 2026-10-05 is a Monday. 15:00 IST = 09:30Z; 16:30 IST = 11:00Z.
		expect(lastCompleteSessionDate(new Date('2026-10-05T09:30:00Z'))).toBe('2026-10-04');
		expect(lastCompleteSessionDate(new Date('2026-10-05T11:00:00Z'))).toBe('2026-10-05');
	});
});

describe('saved filters and alerts share one config', () => {
	it('round-trips a configured filter through storage unchanged, so a saved alert equals the filter', () => {
		const configured = parseStrengthConfig({
			periodDays: 21,
			baselineDays: 100,
			match: 'all',
			sudden: { enabled: true, mode: 'explicit', explicitRsPct: 7 },
			gradual: { enabled: true, days: 8, minImprovingSessions: 5 },
			spreading: { enabled: true, minBreadthPct: 70, minChangePts: 12 },
			volume: { enabled: true, minRatio: 2 }
		});
		const stored = parseStrengthConfig(JSON.parse(JSON.stringify(configured)));
		expect(stored).toEqual(configured);
		const price = noisy(1, (i) => (i > N - 4 ? 2 : 0));
		const a = evaluateStrength(input(price, [stock({ riseFrom: N - 10, rise: 0.5 })]), configured);
		const b = evaluateStrength(input(price, [stock({ riseFrom: N - 10, rise: 0.5 })]), stored);
		expect(b).toEqual(a);
	});

	it('knows when a config filters nothing, and describes the active signals', () => {
		expect(isStrengthActive(DEFAULT_STRENGTH_CONFIG)).toBe(false);
		const c = parseStrengthConfig({ spreading: { enabled: true } });
		expect(isStrengthActive(c, 'group')).toBe(true);
		expect(isStrengthActive(c, 'company')).toBe(false); // spreading does not apply to one stock
		expect(describeStrengthConfig(c, 'group')).toEqual(['Spreading: ≥ 60%, +10 pts']);
	});

	it('hides non-matches only once a result has arrived without error', () => {
		const ev = (matched: boolean) => ({ matched }) as never;
		const view = {
			...emptyStrengthView(),
			active: true,
			byKey: { a: ev(true), b: ev(false) }
		};
		expect(passesStrength(view, 'b')).toBe(true); // still loading: nothing hidden
		const ready = { ...view, ready: true };
		expect(passesStrength(ready, 'a')).toBe(true);
		expect(passesStrength(ready, 'b')).toBe(false);
		expect(passesStrength(ready, 'missing')).toBe(false);
		expect(passesStrength({ ...ready, error: 'x' }, 'b')).toBe(true); // failed: show everything
		expect(passesStrength(emptyStrengthView(), 'b')).toBe(true); // no filter
	});
});
