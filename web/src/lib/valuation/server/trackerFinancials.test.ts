import { expect, it } from 'vitest';
import { parseTrackerFinancials } from './trackerFinancials';

it('preserves financial periods, blanks, percentages and the company BSE identifier', () => {
	const result = parseTrackerFinancials(`<h1>HFCL</h1><div class="show-from-tablet-landscape"><a href="https://www.bseindia.com/stock-share-price/hfcl/500183/">BSE</a></div><section id="profit-loss"><table><thead><tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr></thead><tbody><tr><td>Tax %</td><td>20%</td><td></td></tr></tbody></table></section>`, 'https://www.screener.in/company/HFCL/');
	expect(result.get_company_overview.bse_code).toBe('500183');
	expect(result.get_financials_profit_loss).toEqual({ years: ['Mar 2025', 'Mar 2026'], rows: [{ label: 'Tax %', values: ['20%', ''] }] });
});

it('lists Screener concall transcripts and presentations with the month each call was held', () => {
	const html = `<h1>HFCL</h1><section class="documents concalls"><div class="documents concalls"><ul><li><div>Jul 2026</div><a href="https://www.bseindia.com/t.pdf" title="Raw Transcript">Transcript</a><button>AI Summary</button><a href="https://www.bseindia.com/p.pdf">PPT</a></li><li><div>May 2026</div><a href="https://www.bseindia.com/rec">REC</a></li></ul></div></section>`;
	expect(parseTrackerFinancials(html, 'https://www.screener.in/company/HFCL/').get_document_list.concalls).toEqual([
		{ date: 'Jul 2026', title: 'Concall Transcript', url: 'https://www.bseindia.com/t.pdf' },
		{ date: 'Jul 2026', title: 'Investor Presentation', url: 'https://www.bseindia.com/p.pdf' }
	]);
});
