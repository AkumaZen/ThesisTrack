import * as cheerio from 'cheerio';

// Latest quarterly shareholding pattern. NSE's own shareholding endpoint only gives promoter and public
// (FII/DII sit inside an XBRL file) and its pledge endpoint answered empty, so Screener's pattern table
// is the source: it has Promoters, FIIs, DIIs and Public for every quarter, plus the pledge sentence.

export interface ShareholdingParsed {
	period: string;
	promoters: number | null;
	fiis: number | null;
	diis: number | null;
	public: number | null;
	/** Percent of the promoter holding that is pledged; null when Screener says nothing. */
	pledgedPct: number | null;
	prevPeriod: string | null;
	prevPromoters: number | null;
	prevFiis: number | null;
	prevDiis: number | null;
	prevPublic: number | null;
}

const pct = (t: string): number | null => {
	const n = parseFloat(t.replace(/[,%\s]/g, ''));
	return Number.isFinite(n) ? n : null;
};

/** Reads the first table of Screener's #shareholding section: the last column is the latest quarter. */
export function parseScreenerShareholding(html: string): ShareholdingParsed | null {
	const $ = cheerio.load(html);
	const table = $('#shareholding table').first();
	const labels = table
		.find('thead th')
		.slice(1)
		.map((_, th) => $(th).text().replace(/\s+/g, ' ').trim())
		.get();
	if (labels.length === 0) return null;
	const rows = new Map<string, (number | null)[]>();
	table.find('tbody tr').each((_, tr) => {
		const cells = $(tr).find('td');
		const name = cells.first().text().replace(/[+\s]+$/g, '').trim().toLowerCase();
		rows.set(
			name,
			cells
				.slice(1)
				.map((_, td) => pct($(td).text()))
				.get()
		);
	});
	const at = (row: string, fromEnd: number): number | null => {
		const r = rows.get(row);
		return r?.[r.length - 1 - fromEnd] ?? null;
	};
	const latest = { promoters: at('promoters', 0), fiis: at('fiis', 0), diis: at('diis', 0), public: at('public', 0) };
	if (Object.values(latest).every((v) => v == null)) return null;
	const pledge = /pledged\s+([\d.]+)\s*%/i.exec($('body').text().replace(/\s+/g, ' '));
	return {
		period: labels[labels.length - 1],
		...latest,
		pledgedPct: pledge ? parseFloat(pledge[1]) : null,
		prevPeriod: labels.length > 1 ? labels[labels.length - 2] : null,
		prevPromoters: at('promoters', 1),
		prevFiis: at('fiis', 1),
		prevDiis: at('diis', 1),
		prevPublic: at('public', 1)
	};
}

const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function getPage(url: string, fetcher: typeof fetch): Promise<string | null> {
	const res = await fetcher(url, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
		signal: AbortSignal.timeout(8000)
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`Screener shareholding failed (HTTP ${res.status})`);
	return res.text();
}

/** Consolidated page first, then the standalone page for companies with no consolidated figures. */
export async function fetchShareholding(symbol: string, fetcher: typeof fetch = fetch): Promise<ShareholdingParsed | null> {
	const base = `https://www.screener.in/company/${encodeURIComponent(symbol)}/`;
	for (const url of [`${base}consolidated/`, base]) {
		const html = await getPage(url, fetcher);
		const parsed = html ? parseScreenerShareholding(html) : null;
		if (parsed) return parsed;
	}
	return null;
}
