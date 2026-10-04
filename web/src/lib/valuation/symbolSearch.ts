/** One suggestion in the company picker. */
export interface SymbolHit {
	/** NSE ticker (or a BSE scrip code for a company listed only on BSE). */
	symbol: string;
	name: string;
	/** Angel One lists it, so it has price charts; null while that is not known yet. */
	priceable: boolean | null;
	/** Already in a sector basket or on the watchlist. */
	tracked: boolean;
}
