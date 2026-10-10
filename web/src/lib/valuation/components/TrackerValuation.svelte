<script lang="ts">
	import { scenarioYears, projectedLabels, annualizedReturn, type TrackerModel } from '../masterTracker';
	import { METHOD_LABELS, METHOD_MULTIPLE_LABEL } from '../valuationEngine';
	import TrackerSources from './TrackerSources.svelte';
	let { model }: { model: TrackerModel } = $props();
	const labels = $derived(projectedLabels(model));
	const fmt = (v: number | null) => v === null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
	const rows = ['Sales', 'Expenses', 'Operating Profit', 'OPM %', 'Other Income', 'Interest', 'Depreciation', 'Profit before tax', 'Tax %', 'Net Profit', 'PAT attributable to owners', 'EPS', 'PAT Growth %', 'PAT Margin %', 'Shares (Cr)', 'Multiple', 'Target Price ₹', 'Return vs CMP %', 'Stock Price CAGR %'];
	function values(s: 'bear' | 'base' | 'bull') {
		const forecast = scenarioYears(model, s);
		return [...model.history.map((h, i) => [h.sales, h.expenses, h.sales-h.expenses, (h.sales-h.expenses)/h.sales*100, h.otherIncome,h.interest,h.depreciation,h.pbt,h.pbt ? h.tax/h.pbt*100 : null,h.netProfit,h.ownersPAT,h.eps,
			i ? (h.ownersPAT/model.history[0].ownersPAT-1)*100 : null,h.ownersPAT/h.sales*100,null,null,null,null,null]),
			...forecast.map((y, i) => { const a=model.scenarios[s][i]; const prior=i ? forecast[i-1].netProfit-model.scenarios[s][i-1].minorityPAT : model.history[1].ownersPAT; const owners=y.netProfit-a.minorityPAT;
				return [y.sales,y.expenses,y.ebitda,y.ebitda/y.sales*100,y.otherIncome,y.interest,y.depreciation,y.pbt,a.taxPct,y.netProfit,owners,y.eps,prior>0 ? (owners/prior-1)*100 : null,owners/y.sales*100,a.shares,a.targetMultiple,y.impliedPrice>0 ? y.impliedPrice : null,y.impliedPrice>0 ? (y.impliedPrice/model.cmp-1)*100 : null,annualizedReturn(y.impliedPrice,model.cmp,labels[i].endDate,model.priceDate)]; })];
	}
</script>
<section aria-label="Valuation scenarios" class="valuation">
	<h3>{METHOD_LABELS[model.method]} scenario model {#if model.manual}<small>Manually edited</small>{/if}</h3>
	<p>{model.diagnosis}</p><p class="muted">₹ crore except per-share prices and EPS. CMP ₹{fmt(model.cmp)} as of {model.priceDate}. Recommended: {METHOD_LABELS[model.recommendedMethod]}.</p>
	{#if Object.values(model.scenarios).some((years)=>years.some((a)=>a.shares!==model.shares))}<p class="muted">Pre-dilution comparisons hold operating and debt assumptions fixed and exclude new equity capital. Post-dilution book value includes disclosed new equity capital; these are illustrative per-share comparisons.</p>{/if}
	{#each ['bear', 'base', 'bull'] as raw}
		{@const s = raw as 'bear' | 'base' | 'bull'}
		{@const columns = values(s)}
		<section aria-label={`${s[0].toUpperCase()+s.slice(1)} scenario`}>
			<h4>{s[0].toUpperCase()+s.slice(1)} case</h4>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard users must scroll the wide financial table) -->
			<div class="table-scroll" tabindex="0" role="region" aria-label={`${s} financial table`}>
				<table><thead><tr><th scope="col">Metric</th>{#each model.history as h}<th scope="col">{h.label}</th>{/each}{#each labels as l}<th scope="col">{l.label}</th>{/each}</tr></thead>
					<tbody>{#each rows as row, i}<tr><th scope="row">{row === 'Multiple' ? METHOD_MULTIPLE_LABEL[model.method] : row}</th>{#each columns as column}<td>{fmt(column[i])}</td>{/each}</tr>{/each}
					{#if model.scenarios[s].some((a)=>a.shares!==model.shares)}
						<tr><th scope="row">Pre-dilution EPS</th><td>—</td><td>—</td>{#each scenarioYears(model,s,true) as y}<td>{fmt(y.eps)}</td>{/each}</tr>
						<tr><th scope="row">Pre-dilution target ₹</th><td>—</td><td>—</td>{#each scenarioYears(model,s,true) as y}<td>{fmt(y.impliedPrice)}</td>{/each}</tr>
					{/if}</tbody></table>
			</div>
			<details><summary>{s[0].toUpperCase()+s.slice(1)} assumptions and reasoning</summary>{#each model.scenarios[s] as y, i}<p><strong>{labels[i].label}:</strong> Growth {fmt(y.revenueGrowthPct)}%; operating margin {fmt(100-y.expensePct)}%; multiple {fmt(y.targetMultiple)}×. {y.reasoning}</p><TrackerSources sources={y.sources}/>{/each}</details>
		</section>
	{/each}
	<details><summary>Historical financial sources</summary>{#each model.history as h}<h4>{h.label}</h4><TrackerSources sources={h.sources}/>{/each}</details>
	<h4>Key assumptions & caveats</h4><ul>{#each model.caveats as caveat}<li>{caveat}</li>{/each}</ul>
	<p class="muted">These are scenario bands, not forecasts. Not investment advice; the modeler is not a licensed financial advisor.</p>
</section>
<style>.valuation{margin-top:20px}h3,h4{margin:16px 0 8px}small,.muted{color:var(--muted);font-size:12px}p,li{font-size:13px;line-height:1.6}.table-scroll{overflow:auto;border:1px solid var(--rule)}table{border-collapse:collapse;width:100%;font-size:12px;min-width:630px}th,td{padding:8px 12px;border-bottom:1px solid var(--rule);text-align:right;white-space:nowrap}th:first-child{text-align:left}thead{background:var(--surface)}tbody th{font-weight:500}details{font-size:13px;margin:12px 0}summary{cursor:pointer;color:var(--accent)}</style>
