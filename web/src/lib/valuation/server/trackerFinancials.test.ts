import { expect, it } from 'vitest';
import { parseTrackerFinancials } from './trackerFinancials';

it('preserves financial periods, blanks, percentages and the company BSE identifier', () => {
	const result = parseTrackerFinancials(`<h1>HFCL</h1><div class="show-from-tablet-landscape"><a href="https://www.bseindia.com/stock-share-price/hfcl/500183/">BSE</a></div><section id="profit-loss"><table><thead><tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr></thead><tbody><tr><td>Tax %</td><td>20%</td><td></td></tr></tbody></table></section>`, 'https://www.screener.in/company/HFCL/');
	expect(result.get_company_overview.bse_code).toBe('500183');
	expect(result.get_financials_profit_loss).toEqual({ years: ['Mar 2025', 'Mar 2026'], rows: [{ label: 'Tax %', values: ['20%', ''] }] });
});
