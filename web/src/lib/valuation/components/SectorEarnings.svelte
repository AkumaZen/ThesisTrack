<script lang="ts">
	import { isThinCoverage, type SectorEarnings } from '$lib/valuation/sectorEarnings';

	// Aggregate quarterly revenue and net profit of a basket's members, newest quarter first.
	let { earnings, label }: { earnings: SectorEarnings; label: string } = $props();

	const rows = $derived([...earnings.quarters].reverse());
	const thin = $derived(isThinCoverage(earnings));
	const cr = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
	const pct = (n: number | null) => (n == null ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
	const tone = (n: number | null) => (n == null ? '' : n >= 0 ? 'se-up' : 'se-down');
</script>

<section class="sector-earnings" aria-labelledby="se-heading" data-testid="sector-earnings">
	<h2 id="se-heading" class="se-heading">Earnings trend</h2>
	<p class="se-coverage" data-testid="se-coverage">
		Quarterly results stored for {earnings.coveredMembers} of {earnings.totalMembers} members of {label}.
		{#if earnings.coveredMembers === 0}
			None yet: results are stored when a company is opened or its valuation is loaded.
		{:else if thin}
			Coverage is thin, so these totals describe only the members that have results, not the whole basket.
		{/if}
	</p>

	{#if rows.length > 0}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="table-scroll" tabindex="0" role="region" aria-label="Basket quarterly earnings table">
			<table class="se-table">
				<caption class="sr-only"
					>Revenue and net profit summed over the members reporting each quarter, in Rs crore, with year
					on year growth</caption
				>
				<thead>
					<tr>
						<th scope="col">Quarter</th>
						<th scope="col" class="num">Revenue (Rs Cr)</th>
						<th scope="col" class="num">YoY</th>
						<th scope="col" class="num">Net profit (Rs Cr)</th>
						<th scope="col" class="num">YoY</th>
						<th scope="col" class="num" title="Members with this quarter stored; YoY uses those that also have the year-ago quarter"
							>Members</th
						>
					</tr>
				</thead>
				<tbody>
					{#each rows as q (q.label)}
						<tr data-testid="se-row">
							<th scope="row">{q.label}</th>
							<td class="num">{cr(q.sales)}</td>
							<td class="num {tone(q.salesYoY)}">{pct(q.salesYoY)}</td>
							<td class="num">{cr(q.netProfit)}</td>
							<td class="num {tone(q.profitYoY)}">{pct(q.profitYoY)}</td>
							<td class="num"
								>{q.reporting}{#if q.yoyMembers > 0 && q.yoyMembers !== q.reporting}<span class="se-sub">
										YoY on {q.yoyMembers}</span
									>{/if}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
