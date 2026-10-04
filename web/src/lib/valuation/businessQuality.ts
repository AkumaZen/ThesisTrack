export interface QualityInput {
	pros: string[];
	cons: string[];
	shareholding: { promoters: number | null; promotersPrevQuarter: number | null } | null;
	balanceSheet: { borrowings: number | null; totalAssets: number | null } | null;
	cashConversionCycle: number | null;
	roe: number | null;
}

export interface QualityFlag {
	tone: 'good' | 'warn' | 'bad';
	text: string;
}

export interface QualityAssessment {
	rating: 'Strong' | 'Watch' | 'Caution';
	flags: QualityFlag[];
}

const PROMOTER_SELLING_THRESHOLD_PP = 0.5; // percentage-point drop between quarters

/**
 * Rule-based, fully transparent business-quality read — every flag cites the exact number
 * behind it. Deliberately does not attempt sector-specific checks (bank/NBFC asset quality,
 * etc.) that the scraped data can't support; it only flags what it can actually see.
 */
export function assessBusinessQuality(input: QualityInput): QualityAssessment {
	const flags: QualityFlag[] = [];

	for (const p of input.pros) flags.push({ tone: 'good', text: p });
	for (const c of input.cons) flags.push({ tone: 'warn', text: c });

	const { promoters, promotersPrevQuarter } = input.shareholding ?? {};
	if (promoters != null && promotersPrevQuarter != null) {
		const delta = promoters - promotersPrevQuarter;
		if (delta <= -PROMOTER_SELLING_THRESHOLD_PP) {
			flags.push({
				tone: 'bad',
				text: `Promoter holding fell ${Math.abs(delta).toFixed(2)} percentage points quarter-on-quarter (${promotersPrevQuarter}% → ${promoters}%).`
			});
		} else if (delta >= PROMOTER_SELLING_THRESHOLD_PP) {
			flags.push({
				tone: 'good',
				text: `Promoter holding rose ${delta.toFixed(2)} percentage points quarter-on-quarter (${promotersPrevQuarter}% → ${promoters}%).`
			});
		}
	}

	const leverage =
		input.balanceSheet?.borrowings != null && input.balanceSheet?.totalAssets
			? input.balanceSheet.borrowings / input.balanceSheet.totalAssets
			: null;
	if (leverage != null && leverage > 0.5) {
		flags.push({
			tone: 'bad',
			text: `Borrowings are ${(leverage * 100).toFixed(0)}% of total assets — highly leveraged balance sheet.`
		});
	}

	if (input.cashConversionCycle != null && input.cashConversionCycle > 180) {
		flags.push({
			tone: 'bad',
			text: `Cash conversion cycle is ${input.cashConversionCycle} days — cash is tied up in working capital for a long stretch.`
		});
	}

	if (input.roe != null && input.roe < 10) {
		flags.push({ tone: 'warn', text: `ROE of ${input.roe}% is below a typical 10-15%+ bar.` });
	}

	const badCount = flags.filter((f) => f.tone === 'bad').length;
	const warnCount = flags.filter((f) => f.tone === 'warn').length;

	let rating: QualityAssessment['rating'] = 'Strong';
	if (badCount > 0 || warnCount >= 3) rating = 'Caution';
	else if (warnCount > 0) rating = 'Watch';

	return { rating, flags };
}
