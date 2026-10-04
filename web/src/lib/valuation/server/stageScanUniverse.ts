import { listAllSymbols } from './sectorStore';

/** The Stage 2 Breakout Scanner's universe of stocks: every unique ticker across the sector
 *  rotation baskets (each verified against Screener.in, either by hand originally or by the
 *  Sector Manager at add time) rather than a separately-sourced NIFTY 500 constituent list,
 *  which doesn't exist anywhere in this codebase or its data sources. Read from the database
 *  each time so baskets edited in the Sector Manager are picked up without a restart. */
export function getStageScanUniverse(): Promise<string[]> {
	return listAllSymbols();
}
