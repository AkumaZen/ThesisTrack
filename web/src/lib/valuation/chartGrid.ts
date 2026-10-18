// Small pure helpers for the chart grid tiles (scanner results and watchlist).

export interface GridItem {
	symbol: string;
	name: string;
	/** Last price shown on the tile; null when unknown. */
	price: number | null;
	/** Percent change vs the previous close; null when unknown. */
	changePct: number | null;
	/** Recent closes for the mini chart, when already known (else the grid fetches them). */
	closes?: number[] | null;
}

/** Tiles drawn at first and per "Show more": a few dozen keeps 100+ results fast. */
export const GRID_PAGE = 24;

/** SVG polyline points scaled to the series' own range (shape, not magnitude), or null when there
 *  are fewer than two usable closes. */
export function sparkPoints(closes: number[] | null | undefined, w = 120, h = 40): string | null {
	const xs = (closes ?? []).filter((c) => Number.isFinite(c));
	if (xs.length < 2) return null;
	const min = Math.min(...xs);
	const max = Math.max(...xs);
	const range = max - min || 1;
	return xs
		.map((c, i) => `${((i / (xs.length - 1)) * w).toFixed(1)},${(h - ((c - min) / range) * h).toFixed(1)}`)
		.join(' ');
}

/** Percent change between the last two usable closes; null with fewer than two or a zero base. */
export function lastChangePct(closes: number[] | null | undefined): number | null {
	const xs = (closes ?? []).filter((c) => Number.isFinite(c));
	if (xs.length < 2) return null;
	const prev = xs[xs.length - 2];
	return prev > 0 ? (xs[xs.length - 1] / prev - 1) * 100 : null;
}

/** Percent change of a price against the previous close; null when either is missing or the base is zero. */
export function changeVsPrev(price: number | null | undefined, prev: number | null | undefined): number | null {
	return price != null && prev != null && prev > 0 ? (price / prev - 1) * 100 : null;
}

/** The symbols in the visible slice that still need closes, in chunks no larger than `size`. */
export function missingCloseChunks(
	items: GridItem[],
	visible: number,
	have: Record<string, number[]>,
	size = 50
): string[][] {
	const need = items
		.slice(0, visible)
		.filter((i) => !(i.closes && i.closes.length >= 2) && !(i.symbol in have))
		.map((i) => i.symbol);
	const chunks: string[][] = [];
	for (let i = 0; i < need.length; i += size) chunks.push(need.slice(i, i + size));
	return chunks;
}
