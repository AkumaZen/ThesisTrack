import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { detectBasis, extractAnnual } from './scraper';

const page = (sub: string) =>
	cheerio.load(`<section id="profit-loss"><h2>Profit &amp; Loss</h2><p class="sub">${sub}</p></section>`);

describe('detectBasis', () => {
	it('reads the basis even when Screener wraps the text across lines', () => {
		expect(detectBasis(page('\n    \n      Consolidated\n      Figures in Rs. Crores / <a>View Standalone</a>'))).toBe(
			'consolidated'
		);
		expect(detectBasis(page('Standalone\n Figures in Rs. Crores / <a>View Consolidated</a>'))).toBe('standalone');
	});
	it('treats a page with no basis marker as standalone only', () => {
		expect(detectBasis(page('Figures in Rs. Crores'))).toBe('standalone_only');
	});
});

const table = (id: string, labels: string[], rows: [string, (string | number)[]][]) =>
	`<section id="${id}"><table><thead><tr><th></th>${labels.map((l) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${rows
		.map(([name, cells]) => `<tr><td class="text">${name}</td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`)
		.join('')}</tbody></table></section>`;

describe('extractAnnual', () => {
	const $ = cheerio.load(
		table('profit-loss', ['Mar 2024', 'Mar 2025', 'TTM'], [
			['Sales&nbsp;+', ['1,000', '1,200', '1,300']],
			['OPM %', ['20%', '22%', '23%']],
			['Net Profit&nbsp;+', ['100', '150', '160']]
		]) +
			table('balance-sheet', ['Mar 2024', 'Mar 2025'], [
				['Equity Capital', [10, 10]],
				['Reserves', [490, 590]],
				['Borrowings&nbsp;+', [200, '150']],
				['Fixed Assets&nbsp;+', [300, 330]],
				['CWIP', [20, '40']]
			]) +
			table('ratios', ['Mar 2024', 'Mar 2025'], [['ROCE %', ['18%', '21%']]])
	);
	it('joins the three tables by year label and leaves TTM out', () => {
		expect(extractAnnual($)).toEqual([
			{ label: 'Mar 2024', sales: 1000, opmPct: 20, netProfit: 100, equity: 500, borrowings: 200, fixedAssets: 300, cwip: 20, roce: 18 },
			{ label: 'Mar 2025', sales: 1200, opmPct: 22, netProfit: 150, equity: 600, borrowings: 150, fixedAssets: 330, cwip: 40, roce: 21 }
		]);
	});
	it('leaves lines null when a table is absent', () => {
		const rows = extractAnnual(cheerio.load(table('profit-loss', ['Mar 2025'], [['Sales', [5]]])));
		expect(rows).toEqual([
			{ label: 'Mar 2025', sales: 5, opmPct: null, netProfit: null, equity: null, borrowings: null, fixedAssets: null, cwip: null, roce: null }
		]);
	});
});
