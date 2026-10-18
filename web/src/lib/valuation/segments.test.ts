import { describe, expect, it } from 'vitest';
import { parseCompanyInfo, parseSegmentHtml, salesShares } from './segments';

/** The shape Screener returns without a premium session (seen live for RELIANCE: names, no numbers). */
const GATED = `
<table class="data-table">
  <thead><tr><th class="text"></th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
  <tbody class="hidden" data-segment-line="Sales"><tr>
    <td style="padding: 0;"><table class="no-margin">
      <tr class="strong stripe"><td class="text">Sales</td></tr>
      <tr><td class="text">Retail</td></tr><tr><td class="text">Digital Services</td></tr>
    </table></td>
    <td colspan="2" style="text-align: center">Please <a href="/premium/">upgrade to premium</a> for segment results.</td>
  </tr></tbody>
</table>`;

/** Assumed premium layout: the same name column, then one cell per year with one number per segment. The
 *  premium markup was not available to check against, so this fixture follows the layout the free page implies. */
const PREMIUM = `
<table class="data-table">
  <thead><tr><th class="text"></th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
  <tbody data-segment-line="Sales"><tr>
    <td><table class="no-margin"><tr><td class="text">Sales</td></tr>
      <tr><td class="text">Retail</td></tr><tr><td class="text">Digital Services</td></tr><tr><td class="text">Less: Intersegment</td></tr></table></td>
    <td>1,000 400 -50</td><td>1,200 500 -60</td>
  </tr></tbody>
  <tbody data-segment-line="ROCE %"><tr>
    <td><table class="no-margin"><tr><td class="text">ROCE %</td></tr>
      <tr><td class="text">Retail</td></tr><tr><td class="text">Digital Services</td></tr><tr><td class="text">Less: Intersegment</td></tr></table></td>
    <td>12 - -</td><td>13 9 -</td>
  </tr></tbody>
</table>`;

describe('parseSegmentHtml', () => {
  it('reports names only when Screener withholds the numbers', () => {
    const d = parseSegmentHtml(GATED, true);
    expect(d).toEqual({ status: 'premium', consolidated: true, segments: ['Retail', 'Digital Services'] });
  });

  it('parses a table with numbers, one row per segment and one value per year', () => {
    const d = parseSegmentHtml(PREMIUM, true);
    if (d.status !== 'ok') throw new Error('expected ok');
    expect(d.years).toEqual(['Mar 2025', 'Mar 2026']);
    expect(d.segments).toEqual(['Retail', 'Digital Services', 'Less: Intersegment']);
    expect(d.lines['Sales']).toEqual([[1000, 1200], [400, 500], [-50, -60]]);
    expect(d.lines['ROCE %']).toEqual([[12, 13], [null, 9], [null, null]]);
  });

  it('is none for a page without segment rows or with misaligned cells', () => {
    expect(parseSegmentHtml('<p>nothing</p>', true).status).toBe('none');
    expect(parseSegmentHtml(PREMIUM.replace('1,000 400 -50', '1,000 400'), true).status).toBe('none');
  });
});

describe('salesShares', () => {
  it('shares the latest sales across positive segments and ignores the negative elimination row', () => {
    const d = parseSegmentHtml(PREMIUM, true);
    if (d.status !== 'ok') throw new Error('expected ok');
    const shares = salesShares(d);
    expect(shares[0].sharePct).toBeCloseTo((1200 / 1700) * 100, 8);
    expect(shares[1].sharePct).toBeCloseTo((500 / 1700) * 100, 8);
    expect(shares[2].sharePct).toBeNull();
  });
});

describe('parseCompanyInfo', () => {
  it('reads the Screener company id and the consolidated flag', () => {
    expect(parseCompanyInfo('<div data-company-id="2726" data-consolidated="true" id="company-info"></div>')).toEqual({
      companyId: '2726',
      consolidated: true
    });
    expect(parseCompanyInfo('<div data-company-id="9" id="company-info"></div>')?.consolidated).toBe(false);
    expect(parseCompanyInfo('<p></p>')).toBeNull();
  });
});
