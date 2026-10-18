/** 5337584 -> "53.4 lakh", 12000000 -> "1.2 crore", 4500 -> "4,500". (Kept apart from deals.ts, which
 *  hashes with node:crypto, so the browser can import it.) */
export function formatQty(n: number): string {
	if (n >= 1e7) return `${+(n / 1e7).toFixed(2)} crore`;
	if (n >= 1e5) return `${+(n / 1e5).toFixed(1)} lakh`;
	return n.toLocaleString('en-IN');
}
