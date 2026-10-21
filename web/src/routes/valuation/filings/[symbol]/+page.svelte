<script lang="ts">
	import CompanyFilings from '$lib/valuation/components/CompanyFilings.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.symbol} filings - ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>{data.symbol}: corporate actions and holding changes</h1>
		<div class="sub">
			Corporate actions and holding changes, from NSE.
			<a href="/valuation/company/{encodeURIComponent(data.symbol)}">Back to the company</a>
		</div>
	</div>
</div>

<div class="wrap">
	<CompanyFilings symbol={data.symbol} />
</div>
