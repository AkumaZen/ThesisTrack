<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import { diagnoseValuationMethod } from '$lib/valuation/valuationDiagnosis';
	import { assessBusinessQuality } from '$lib/valuation/businessQuality';
	import { analyzePeg } from '$lib/valuation/pegAnalysis';

	let { data }: { data: PageData } = $props();

	// Writable derived: resets to the URL's symbol list whenever `data` changes (new
	// navigation), but stays as whatever the user typed in between.
	let symbolInput = $derived(data.results.map((r) => r.symbol).join(', '));

	function submit() {
		const symbols = symbolInput
			.split(',')
			.map((s) => s.trim().toUpperCase())
			.filter(Boolean)
			.slice(0, data.maxSymbols)
			.join(',');
		goto(resolve(symbols ? `/valuation/compare?symbols=${symbols}` : '/valuation/compare'));
	}

	function cagrPct(first: number, last: number, periods: number): number | null {
		if (first <= 0 || last <= 0 || periods <= 0) return null;
		return (Math.pow(last / first, 1 / periods) - 1) * 100;
	}

	const rows = $derived(
		data.results.map((r) => {
			const c = r.company;
			if (!c) return { symbol: r.symbol, company: null, errorMessage: r.errorMessage };

			const years = c.history.filter((y) => y.sales != null);
			const patYears = c.history.filter((y) => y.netProfit != null);
			const salesCagr =
				years.length >= 2
					? cagrPct(years[0].sales!, years[years.length - 1].sales!, years.length - 1)
					: null;
			const patCagr =
				patYears.length >= 2
					? cagrPct(
							patYears[0].netProfit!,
							patYears[patYears.length - 1].netProfit!,
							patYears.length - 1
						)
					: null;

			const diagnosis = diagnoseValuationMethod({
				history: c.history,
				balanceSheet: c.balanceSheet,
				cashConversionCycle: c.cashConversionCycle,
				industry: c.industry
			});
			const quality = assessBusinessQuality({
				pros: c.pros,
				cons: c.cons,
				shareholding: c.shareholding,
				balanceSheet: c.balanceSheet,
				cashConversionCycle: c.cashConversionCycle,
				roe: c.roe
			});
			const peg =
				diagnosis.method === 'pe' ? analyzePeg({ stockPE: c.stockPE, history: c.history }) : null;

			return {
				symbol: r.symbol,
				company: c,
				errorMessage: null,
				salesCagr,
				patCagr,
				diagnosis,
				quality,
				peg
			};
		})
	);

	function fmtPct(n: number | null | undefined) {
		return n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
	}
</script>

<svelte:head>
	<title>Compare Companies · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Compare companies</h1>
		<div class="sub">
			Pick up to {data.maxSymbols} companies and see their numbers side by side.
		</div>
	</div>
</div>

<div class="wrap">
	<div class="company-search" style="margin-top:20px">
		<label
			for="compareSymbols"
			class="field-label" style="display:block;margin-bottom:6px"
		>
			Symbols to compare (comma-separated, up to {data.maxSymbols})
		</label>
		<div class="compare-row">
			<input
				id="compareSymbols"
				placeholder="e.g. TCS, INFY, WIPRO"
				bind:value={symbolInput}
				onkeydown={(e) => e.key === 'Enter' && submit()}
			/>
			<button class="btn btn-primary compare-go" onclick={submit}>Compare</button>
		</div>
	</div>

	{#if rows.length > 0}
		<div class="table-scroll" style="margin-top:20px">
			<table class="compare-table">
				<thead>
					<tr>
						<th class="left">Metric</th>
						{#each rows as r (r.symbol)}
							<th>
								{#if r.company}
									<a href={resolve('/valuation/company/[symbol]', { symbol: r.symbol })}>{r.symbol}</a>
								{:else}
									{r.symbol}
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#if rows.some((r) => r.errorMessage)}
						<tr>
							<td class="left">Status</td>
							{#each rows as r (r.symbol)}
								<td class={r.errorMessage ? 'signal-bad' : 'signal-good'}
									>{r.errorMessage ?? 'OK'}</td
								>
							{/each}
						</tr>
					{/if}
					<tr>
						<td class="left">Name</td>
						{#each rows as r (r.symbol)}<td>{r.company?.name ?? '—'}</td>{/each}
					</tr>
					<tr>
						<td class="left">Sector / Industry</td>
						{#each rows as r (r.symbol)}<td>{r.company?.industry ?? r.company?.sector ?? '—'}</td
							>{/each}
					</tr>
					<tr>
						<td class="left">CMP</td>
						{#each rows as r (r.symbol)}<td>{r.company?.cmp != null ? `₹${r.company.cmp}` : '—'}</td
							>{/each}
					</tr>
					<tr>
						<td class="left">Market Cap</td>
						{#each rows as r (r.symbol)}<td
								>{r.company?.marketCap != null ? `₹${r.company.marketCap}cr` : '—'}</td
							>{/each}
					</tr>
					<tr>
						<td class="left">Stock P/E</td>
						{#each rows as r (r.symbol)}<td>{r.company?.stockPE ?? '—'}</td>{/each}
					</tr>
					<tr>
						<td class="left">PEG (vs own history)</td>
						{#each rows as r (r.symbol)}<td
								class={r.peg?.label
									? `signal-${r.peg.label === 'Attractive' ? 'good' : r.peg.label === 'Expensive' ? 'bad' : 'warn'}`
									: ''}>{r.peg?.peg != null ? `${r.peg.peg.toFixed(2)} (${r.peg.label})` : '—'}</td
							>{/each}
					</tr>
					<tr>
						<td class="left">ROE</td>
						{#each rows as r (r.symbol)}<td>{r.company?.roe != null ? `${r.company.roe}%` : '—'}</td
							>{/each}
					</tr>
					<tr>
						<td class="left">ROCE</td>
						{#each rows as r (r.symbol)}<td
								>{r.company?.roce != null ? `${r.company.roce}%` : '—'}</td
							>{/each}
					</tr>
					<tr>
						<td class="left">Dividend Yield</td>
						{#each rows as r (r.symbol)}<td
								>{r.company?.dividendYield != null ? `${r.company.dividendYield}%` : '—'}</td
							>{/each}
					</tr>
					<tr>
						<td class="left">Sales CAGR (history)</td>
						{#each rows as r (r.symbol)}<td>{fmtPct(r.salesCagr)}</td>{/each}
					</tr>
					<tr>
						<td class="left">PAT CAGR (history)</td>
						{#each rows as r (r.symbol)}<td>{fmtPct(r.patCagr)}</td>{/each}
					</tr>
					<tr>
						<td class="left">Promoter Holding</td>
						{#each rows as r (r.symbol)}<td
								>{r.company?.shareholding?.promoters != null
									? `${r.company.shareholding.promoters}%`
									: '—'}</td
							>{/each}
					</tr>
					<tr>
						<td class="left">Recommended Method</td>
						{#each rows as r (r.symbol)}<td>{r.diagnosis?.label ?? '—'}</td>{/each}
					</tr>
					<tr>
						<td class="left">Business Quality</td>
						{#each rows as r (r.symbol)}<td
								>{#if r.quality}<span class="quality-badge quality-{r.quality.rating.toLowerCase()}"
										>{r.quality.rating}</span
									>{:else}—{/if}</td
							>{/each}
					</tr>
				</tbody>
			</table>
		</div>
	{/if}
</div>
