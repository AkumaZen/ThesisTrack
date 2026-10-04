export interface PegInput {
	stockPE: number | null;
	history: { label: string; sales: number | null; netProfit: number | null }[];
}

export interface PegResult {
	peg: number | null;
	patCagrPct: number | null;
	label: 'Attractive' | 'Fair' | 'Expensive' | null;
	detail: string;
}

function cagrPct(first: number, last: number, periods: number): number | null {
	if (first <= 0 || last <= 0 || periods <= 0) return null;
	return (Math.pow(last / first, 1 / periods) - 1) * 100;
}

/**
 * Peter Lynch's PEG heuristic (P/E ÷ earnings growth%): PEG < 1 reads as attractively priced
 * relative to its own growth, > 2 as expensive. Deliberately uses the company's own historical
 * PAT CAGR rather than peer or forward-estimate growth, since neither is available from
 * Screener without full browser automation — see the peer-comparison dead end documented for
 * valuationDiagnosis.ts. Only meaningful for earnings-multiple businesses with positive,
 * calculable growth; returns a null label otherwise rather than forcing a misleading number.
 */
export function analyzePeg(input: PegInput): PegResult {
	const years = input.history.filter((y) => y.netProfit != null);
	if (years.length < 3 || input.stockPE == null || input.stockPE <= 0) {
		return {
			peg: null,
			patCagrPct: null,
			label: null,
			detail: 'Not enough profit history or a live Stock P/E to compute a PEG read.'
		};
	}

	const first = years[0];
	const last = years[years.length - 1];
	const periods = years.length - 1;
	const patCagrPct =
		first.netProfit != null && last.netProfit != null
			? cagrPct(first.netProfit, last.netProfit, periods)
			: null;

	if (patCagrPct == null || patCagrPct <= 0) {
		return {
			peg: null,
			patCagrPct,
			label: null,
			detail:
				'Profit CAGR over the available history is flat or negative — PEG is not meaningful here.'
		};
	}

	const peg = input.stockPE / patCagrPct;
	let label: PegResult['label'] = 'Fair';
	if (peg < 1) label = 'Attractive';
	else if (peg > 2) label = 'Expensive';

	const readOut =
		label === 'Attractive'
			? 'below 1, classically read as attractively priced relative to its own growth'
			: label === 'Expensive'
				? 'above 2, priced well ahead of its own historical growth'
				: 'in the 1–2 "fair value" range (Peter Lynch heuristic)';

	return {
		peg,
		patCagrPct,
		label,
		detail: `P/E of ${input.stockPE} ÷ ${patCagrPct.toFixed(1)}% profit CAGR (${years.length}yr history) = PEG ${peg.toFixed(2)} — ${readOut}.`
	};
}
