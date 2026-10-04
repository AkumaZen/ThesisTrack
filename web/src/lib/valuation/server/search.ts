const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface SearchResult {
	name: string;
	symbol: string;
}

export async function searchCompanies(query: string): Promise<SearchResult[]> {
	const trimmed = query.trim();
	if (trimmed.length < 2) return [];

	const url = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(trimmed)}`;
	const res = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`Screener search failed (${res.status})`);

	const results = (await res.json()) as Array<{ name?: string; url?: string }>;
	return results
		.filter((r) => r.name && r.url)
		.slice(0, 8)
		.map((r) => {
			const match = r.url!.match(/\/company\/([^/]+)/i);
			const symbol = (match?.[1] ?? r.name!.replace(/\W+/g, '')).toUpperCase();
			return { name: r.name!, symbol };
		});
}
