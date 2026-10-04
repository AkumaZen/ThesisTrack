export interface IntegrityCheck {
	label: string;
	expected: number | null;
	actual: number | null;
	deltaPct: number | null;
	status: 'ok' | 'warn' | 'fail';
	detail: string;
}

interface IntegrityYear {
	label: string;
	sales: number | null;
	expenses: number | null;
	operatingProfit: number | null;
	otherIncome: number | null;
	interest: number | null;
	depreciation: number | null;
	pbt: number | null;
	tax: number | null;
	netProfit: number | null;
	eps: number | null;
}

export interface IntegrityInput {
	cmp: number | null;
	marketCap: number | null;
	shares: number;
	stockPE: number | null;
	years: IntegrityYear[];
	shareholding: {
		promoters: number | null;
		fiis: number | null;
		diis: number | null;
		public: number | null;
	} | null;
}

function pctDelta(expected: number, actual: number): number {
	if (expected === 0) return actual === 0 ? 0 : 100;
	return ((actual - expected) / Math.abs(expected)) * 100;
}

function statusFor(deltaPct: number, warnAt: number, failAt: number): 'ok' | 'warn' | 'fail' {
	const a = Math.abs(deltaPct);
	if (a >= failAt) return 'fail';
	if (a >= warnAt) return 'warn';
	return 'ok';
}

/**
 * Cross-checks independently scraped/entered figures against each other using basic
 * accounting identities (Sales − Expenses = Operating Profit, etc). Tolerances are wide
 * enough to absorb Screener's own display rounding — a flagged check means the deviation
 * is bigger than rounding could explain, not that the underlying business is wrong.
 */
export function runIntegrityChecks(input: IntegrityInput): IntegrityCheck[] {
	const checks: IntegrityCheck[] = [];

	if (input.cmp != null && input.marketCap != null && input.shares > 0) {
		const expected = input.marketCap;
		const actual = input.cmp * input.shares;
		const deltaPct = pctDelta(expected, actual);
		checks.push({
			label: 'CMP × Shares ≈ Market Cap',
			expected,
			actual,
			deltaPct,
			status: statusFor(deltaPct, 5, 15),
			detail: `₹${input.cmp} × ${input.shares}cr shares = ₹${actual.toFixed(0)}cr vs reported ₹${expected}cr market cap`
		});
	}

	const latestWithEps = [...input.years].reverse().find((y) => y.eps != null);
	if (latestWithEps?.eps != null && input.stockPE != null && input.cmp != null) {
		const expected = input.cmp;
		const actual = latestWithEps.eps * input.stockPE;
		const deltaPct = pctDelta(expected, actual);
		checks.push({
			label: 'EPS × Stock P/E ≈ CMP',
			expected,
			actual,
			deltaPct,
			status: statusFor(deltaPct, 8, 25),
			detail: `₹${latestWithEps.eps} EPS (${latestWithEps.label}) × ${input.stockPE}x = ₹${actual.toFixed(1)} vs CMP ₹${expected} (approximate — Stock P/E is usually TTM, not last annual EPS)`
		});
	}

	for (const y of input.years.slice(-2)) {
		if (y.sales != null && y.expenses != null && y.operatingProfit != null) {
			const expected = y.sales - y.expenses;
			const actual = y.operatingProfit;
			const deltaPct = pctDelta(expected, actual);
			checks.push({
				label: `Sales − Expenses = Operating Profit (${y.label})`,
				expected,
				actual,
				deltaPct,
				status: statusFor(deltaPct, 3, 10),
				detail: `₹${y.sales}cr − ₹${y.expenses}cr = ₹${expected.toFixed(0)}cr vs reported ₹${actual}cr`
			});
		}
		if (
			y.operatingProfit != null &&
			y.otherIncome != null &&
			y.interest != null &&
			y.depreciation != null &&
			y.pbt != null
		) {
			const expected = y.operatingProfit + y.otherIncome - y.interest - y.depreciation;
			const actual = y.pbt;
			const deltaPct = pctDelta(expected, actual);
			checks.push({
				label: `Operating Profit + Other Income − Interest − Depreciation = PBT (${y.label})`,
				expected,
				actual,
				deltaPct,
				status: statusFor(deltaPct, 3, 10),
				detail: `= ₹${expected.toFixed(0)}cr vs reported PBT ₹${actual}cr`
			});
		}
		if (y.pbt != null && y.tax != null && y.netProfit != null) {
			const expected = y.pbt - y.tax;
			const actual = y.netProfit;
			const deltaPct = pctDelta(expected, actual);
			checks.push({
				label: `PBT − Tax = Net Profit (${y.label})`,
				expected,
				actual,
				deltaPct,
				status: statusFor(deltaPct, 3, 10),
				detail: `₹${y.pbt}cr − ₹${y.tax}cr = ₹${expected.toFixed(0)}cr vs reported ₹${actual}cr`
			});
		}
	}

	if (input.shareholding) {
		const { promoters, fiis, diis, public: pub } = input.shareholding;
		const parts = [promoters, fiis, diis, pub].filter((v): v is number => v != null);
		if (parts.length > 0) {
			const sum = parts.reduce((a, b) => a + b, 0);
			checks.push({
				label: 'Shareholding categories sum ≤ 100%',
				expected: 100,
				actual: sum,
				deltaPct: null,
				status: sum > 101 ? 'fail' : sum < 60 ? 'warn' : 'ok',
				detail:
					sum > 101
						? `Promoters+FIIs+DIIs+Public = ${sum.toFixed(1)}% exceeds 100% — likely a scraping error`
						: sum < 60
							? `Only ${sum.toFixed(1)}% captured across tracked categories — Govt/Others/mutual funds aren't broken out separately, so this is expected, not a fault`
							: `${sum.toFixed(1)}% across tracked categories`
			});
		}
	}

	return checks;
}

export function worstIntegrityStatus(checks: IntegrityCheck[]): 'ok' | 'warn' | 'fail' {
	if (checks.some((c) => c.status === 'fail')) return 'fail';
	if (checks.some((c) => c.status === 'warn')) return 'warn';
	return 'ok';
}
