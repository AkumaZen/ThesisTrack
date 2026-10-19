<script lang="ts">
	import { resolve } from '$app/paths';
	import { canWrite } from '$lib/auth';
	import ConcallPanel from '$lib/valuation/components/ConcallPanel.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.panel.company.name} concalls - ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>{data.panel.company.name}</h1>
		<div class="sub">
			{data.panel.company.symbol}{data.panel.company.sector ? ` · ${data.panel.company.sector}` : ''}
		</div>
	</div>
</div>

<div class="wrap pg">
	<nav class="pg-links" aria-label="Related pages">
		<a href={resolve('/valuation/concalls')}>All concalls</a>
		<a href={resolve('/valuation/red-flags')}>Red flags</a>
		<a href={resolve('/valuation/master-tracker')}>Master Tracker</a>
	</nav>
	<ConcallPanel symbol={data.panel.company.symbol} writable={canWrite(data.user?.role)} initial={data.panel} />
</div>

<style>
	.pg {
		display: grid;
		gap: 0.9rem;
		padding-top: 1rem;
	}
	.pg-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.2rem;
		font-weight: 600;
	}
	.pg-links a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
</style>
