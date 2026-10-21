import { describe, expect, it } from 'vitest';
import { toNamedWatchlist } from './watchlists';

describe('toNamedWatchlist', () => {
	it('lists the symbols and keeps flags only for flagged companies', () => {
		const list = toNamedWatchlist({
			id: 7,
			name: 'Defence',
			items: [
				{ nseSymbol: 'HAL', companyName: 'Hindustan Aeronautics', flagColor: 'red', flagLabel: 'Check pledge' },
				{ nseSymbol: 'BEL', companyName: 'Bharat Electronics', flagColor: null, flagLabel: null },
				{ nseSymbol: 'BDL', companyName: 'Bharat Dynamics', flagColor: null, flagLabel: 'Wait' }
			]
		});
		expect(list.symbols).toEqual(['HAL', 'BEL', 'BDL']);
		expect(list.flags).toEqual({ HAL: { color: 'red', label: 'Check pledge' }, BDL: { color: null, label: 'Wait' } });
	});
});
