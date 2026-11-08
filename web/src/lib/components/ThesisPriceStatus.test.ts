import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ThesisPriceStatus from './ThesisPriceStatus.svelte';
import type { PriceTargetData } from '../../routes/company/[id]/+page';

const html = (priceTarget: PriceTargetData | undefined, currentPrice: number | null = 120) =>
	render(ThesisPriceStatus, { props: { priceTarget, stale: undefined, entryPrice: 100, currentPrice } }).body;

// The card reads top-left first: target price, then current price right below it, before anything else.
const order = (body: string) => ['pt-target', 'pt-current', 'pt-upside', 'pt-entry'].map((id) => body.indexOf(`data-testid="${id}"`));

describe('ThesisPriceStatus', () => {
	it('puts the target price first and the current price directly after it', () => {
		const body = html({
			state: 'in_progress',
			target: 250,
			symbol: 'ABC',
			method: 'pe',
			upside_pct: 108.3,
			progress_pct: 13.3,
			bar_pct: 13.3,
			required_annual_pct: 44.3
		});
		const [target, current, upside, entry] = order(body);
		expect(target).toBeGreaterThan(-1);
		expect(target).toBeLessThan(current);
		expect(current).toBeLessThan(upside);
		expect(current).toBeLessThan(entry);
		expect(body).toMatch(/data-testid="pt-target">₹250</);
		expect(body).toMatch(/data-testid="pt-current">₹120</);
	});

	it('still shows the target slot and current price when there is no valuation', () => {
		const body = html({ state: 'no_valuation', symbol: 'ABC' });
		const [target, current, upside, entry] = order(body);
		expect(body).toMatch(/data-testid="pt-target">Not set</);
		expect(target).toBeLessThan(current);
		expect(upside).toBe(-1);
		expect(entry).toBe(-1);
		expect(body).toContain('data-testid="target-none"');
	});

	it('says so when no current price is stored', () => {
		expect(html({ state: 'no_target', symbol: 'ABC', reason: 'no_company_data' }, null)).toMatch(
			/data-testid="pt-current">No stored price yet</
		);
	});
});
