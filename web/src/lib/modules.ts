// Which module of the app a path belongs to. Drives the module switch, the tools row and the drawer.
// URLs stay under /valuation; only the nav grouping differs. The most specific prefix wins.
export type ModuleKey = 'thesis' | 'valuation' | 'markets' | 'filings' | 'alerts';

export const MODULES: { key: ModuleKey; label: string; landing: string }[] = [
	{ key: 'thesis', label: 'Thesis', landing: '/' },
	{ key: 'valuation', label: 'Valuation', landing: '/valuation' },
	{ key: 'markets', label: 'Markets', landing: '/valuation/sector-rotation' },
	{ key: 'filings', label: 'Filings', landing: '/valuation/announcements' },
	{ key: 'alerts', label: 'Alerts', landing: '/valuation/alerts' }
];

// Longest prefix wins, so these beat the general '/valuation' entry.
const PREFIXES: [string, ModuleKey][] = [
	['/valuation/sector-rotation', 'markets'],
	['/valuation/sectors', 'markets'],
	['/valuation/stage-scanner', 'markets'],
	['/valuation/results', 'markets'],
	['/valuation/returns', 'markets'],
	['/valuation/breadth', 'markets'],
	['/valuation/scans', 'markets'],
	['/valuation/settings', 'markets'],
	['/valuation/announcements', 'filings'],
	['/valuation/filings', 'filings'],
	['/valuation/insider-trades', 'filings'],
	['/valuation/corporate-actions', 'filings'],
	['/valuation/alerts', 'alerts'],
	['/valuation/tracking', 'alerts'],
	['/valuation/price-alerts', 'alerts'],
	['/valuation', 'valuation']
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/');

export function moduleOf(path: string): ModuleKey {
	let best: [string, ModuleKey] | null = null;
	for (const entry of PREFIXES)
		if (under(path, entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
	return best ? best[1] : 'thesis';
}
