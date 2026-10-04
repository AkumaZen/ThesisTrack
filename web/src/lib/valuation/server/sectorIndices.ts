/**
 * NSE sectoral index tokens for Angel One's SmartAPI, confirmed against a live pull of their
 * scrip master (OpenAPIScripMaster.json, instrumenttype "AMXIDX"). Indices don't carry
 * -EQ/-BE suffixes like equities, so they can't be resolved through the normal scrip lookup
 * used for stocks — these are hardcoded because index tokens are stable NSE constants, not
 * something that needs a fresh daily lookup.
 */
export interface SectorIndex {
	key: string;
	label: string;
	token: string;
}

export const BENCHMARK_INDEX: SectorIndex = {
	key: 'nifty50',
	label: 'Nifty 50',
	token: '99926000'
};

/** Confirmed 2026-09-22 against a live pull of the scrip master (instrumenttype "AMXIDX",
 *  exch_seg "NSE", name "NIFTY 500") — the Stage 2 Breakout Scanner's Mansfield RS benchmark. */
export const NIFTY500_INDEX: SectorIndex = {
	key: 'nifty500',
	label: 'Nifty 500',
	token: '99926004'
};

export const SECTOR_INDICES: SectorIndex[] = [
	{ key: 'bank', label: 'Nifty Bank', token: '99926009' },
	{ key: 'it', label: 'Nifty IT', token: '99926008' },
	{ key: 'auto', label: 'Nifty Auto', token: '99926029' },
	{ key: 'pharma', label: 'Nifty Pharma', token: '99926023' },
	{ key: 'fmcg', label: 'Nifty FMCG', token: '99926021' },
	{ key: 'metal', label: 'Nifty Metal', token: '99926030' },
	{ key: 'realty', label: 'Nifty Realty', token: '99926018' },
	{ key: 'energy', label: 'Nifty Energy', token: '99926020' },
	{ key: 'finservice', label: 'Nifty Fin Service', token: '99926037' },
	{ key: 'media', label: 'Nifty Media', token: '99926031' },
	{ key: 'psubank', label: 'Nifty PSU Bank', token: '99926025' },
	{ key: 'pvtbank', label: 'Nifty Pvt Bank', token: '99926047' },
	{ key: 'infra', label: 'Nifty Infra', token: '99926019' },
	{ key: 'commodities', label: 'Nifty Commodities', token: '99926035' },
	{ key: 'midcap100', label: 'Nifty Midcap 100', token: '99926011' }
];
