/** Nine default thesis sections; References is supplementary, not numbered. */
export const THESIS_SECTIONS = [
	{ key: 'the_business', id: 'business', label: '1. The Business' },
	{ key: 'the_growth_engine', id: 'growth', label: '2. The Growth Engine' },
	{ key: 'the_big_change', id: 'change', label: '3. The Big Change' },
	{ key: 'proof_points', id: 'proof', label: '4. Proof Points' },
	{ key: 'what_can_kill_it', id: 'kill', label: '5. What Can Kill It' },
	{ key: 'why_we_believe_it', id: 'believe', label: '6. Why We Believe It' },
	{ key: 'health_check', id: 'health', label: '7. Quarterly Review' },
	{ key: 'trackables', id: 'trackables', label: '8. Trackables' },
	{ key: 'buy_sell_decision', id: 'decisions', label: '9. Buy / Sell Decision' }
] as const;

export const SECTION_KEYS = [...THESIS_SECTIONS.map((section) => section.key), 'references'] as const;

/** Legacy versions have no Trackables. Never substitute their kill triggers. */
export function readTrackables(thesis: unknown): string[] {
	const items = (thesis as { trackables?: unknown } | null)?.trackables;
	return Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
}
