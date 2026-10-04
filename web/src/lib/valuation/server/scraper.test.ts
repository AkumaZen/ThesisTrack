import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { detectBasis } from './scraper';

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
