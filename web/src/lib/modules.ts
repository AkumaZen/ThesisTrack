// Which module of the app a path belongs to. Drives the module switch, the tools row and the drawer.
// URLs stay under /valuation; only the nav grouping differs. The most specific prefix wins.
export type ModuleKey = 'thesis' | 'valuation' | 'sector' | 'analysis';

export const MODULES: { key: ModuleKey; label: string; landing: string }[] = [
	{ key: 'thesis', label: 'Thesis', landing: '/' },
	{ key: 'valuation', label: 'Valuation', landing: '/valuation' },
	{ key: 'sector', label: 'Sector', landing: '/valuation/sector-rotation' },
	{ key: 'analysis', label: 'Analysis', landing: '/valuation/stage-scanner' }
];

// Longest prefix wins, so these beat the general '/valuation' entry.
const PREFIXES: [string, ModuleKey][] = [
	['/valuation/sector-rotation', 'sector'],
	['/valuation/sectors', 'sector'],
	['/valuation/stage-scanner', 'analysis'],
	['/valuation/compare', 'analysis'],
	['/valuation', 'valuation']
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/');

export function moduleOf(path: string): ModuleKey {
	let best: [string, ModuleKey] | null = null;
	for (const entry of PREFIXES)
		if (under(path, entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
	return best ? best[1] : 'thesis';
}
