export function filterCompaniesByName<T extends { name: string }>(companies: T[], query: string): T[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return companies;
	return companies.filter((company) => company.name.toLocaleLowerCase().includes(normalizedQuery));
}
