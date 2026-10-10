import * as cheerio from 'cheerio';

/** In-process Screener adapter: complete statements, preserving reported labels and blanks. */
export function parseTrackerFinancials(html: string, url: string) {
	const $ = cheerio.load(html);
	const table = (section: string) => {
		const element = $(`#${section} table`).first();
		const years = element.find('thead th').toArray().slice(1).map((cell) => $(cell).text().trim());
		const rows = element.find('tbody tr').toArray().map((row) => ({
			label: $(row).find('td').first().text().replace(/\s+/g, ' ').trim(),
			values: $(row).find('td').toArray().slice(1).map((cell) => $(cell).text().replace(/\s+/g, ' ').trim())
		})).filter((row) => row.label && row.values.length);
		return { years, rows };
	};
	const metrics = $('#top-ratios li').toArray().map((item) => $(item).text().replace(/\s+/g, ' ').trim());
	const links = $('#company-info a, .company-links a').toArray().map((a) => ({ title: $(a).text().trim(), url: $(a).attr('href') ?? '' }));
	// Screener's exchange links sit in responsive header rows, outside company-info.
	const bse = $('a[href*="bseindia.com/stock-share-price/"]').first().attr('href')?.match(/\b(\d{6})\b/)?.[1];
	return {
		get_company_overview: { name: $('h1').first().text().trim(), bse_code: bse, url, metrics, basis: $('#profit-loss .sub').text().trim(), fetchedAt: new Date().toISOString() },
		get_quarterly_results: table('quarters'),
		get_financials_profit_loss: table('profit-loss'),
		get_financials_balance_sheet: table('balance-sheet'),
		get_financials_cash_flow: table('cash-flow'),
		get_document_list: { links }
	};
}

export async function nativeTrackerFinancials(symbol: string) {
	if (!/^[A-Z0-9&_.-]{1,40}$/i.test(symbol)) throw new Error('Invalid company identifier');
	const base = `https://www.screener.in/company/${encodeURIComponent(symbol)}/`;
	for (const url of [base + 'consolidated/', base]) {
		const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
		if (response.status === 404) continue;
		if (!response.ok) throw new Error(`Financial source returned HTTP ${response.status}`);
		const result = parseTrackerFinancials(await response.text(), url);
		if (result.get_quarterly_results.years.length && result.get_financials_profit_loss.years.length) return result;
	}
	throw new Error('No reported financial statements found for this company');
}
