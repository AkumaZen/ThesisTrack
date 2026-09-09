import { describe, expect, it } from 'vitest';
import { filterCompaniesByName } from '../src/lib/companySearch';

const companies = [
	{ company_id: 'NEOGEN', name: 'Neogen Chemicals Ltd' },
	{ company_id: 'GFL', name: 'Gujarat Fluorochemicals Ltd' },
	{ company_id: 'TESTCO', name: 'Test Co' }
];

describe('filterCompaniesByName', () => {
	it('matches a case-insensitive part of the company name', () => {
		expect(filterCompaniesByName(companies, 'CHEMICALS').map((company) => company.company_id)).toEqual(['NEOGEN', 'GFL']);
	});

	it('trims the query and returns all companies when it is blank', () => {
		expect(filterCompaniesByName(companies, '   ')).toEqual(companies);
		expect(filterCompaniesByName(companies, '  test  ')).toEqual([companies[2]]);
	});

	it('does not match unrelated company ids', () => {
		expect(filterCompaniesByName(companies, 'GFL')).toEqual([]);
	});
});
