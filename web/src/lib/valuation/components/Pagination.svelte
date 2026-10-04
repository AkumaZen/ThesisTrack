<script lang="ts">
	import { PAGE_SIZES } from '$lib/viewMemory';

	// Page controls under a card grid: which page, and how many cards per page. Hidden while the
	// whole list would fit on one page at the smallest size. `page` is 1-based and always valid.
	let {
		total,
		page = $bindable(1),
		pageSize = $bindable(24),
		noun = 'items'
	}: { total: number; page?: number; pageSize?: number; noun?: string } = $props();

	const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const first = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
	const last = $derived(Math.min(total, page * pageSize));

	// Page numbers to show: the first, the last and a window around the current one.
	const numbers = $derived.by(() => {
		const keep = new Set([1, pages, page - 1, page, page + 1]);
		const list = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
		const out: (number | 'gap')[] = [];
		list.forEach((n, i) => {
			if (i > 0 && n - list[i - 1] > 1) out.push('gap');
			out.push(n);
		});
		return out;
	});

	function go(n: number) {
		page = Math.min(pages, Math.max(1, n));
	}
	function setSize(value: string) {
		pageSize = Number(value);
		page = 1;
	}
</script>

{#if total > PAGE_SIZES[0]}
	<nav class="pg" aria-label="{noun} pages" data-testid="pagination">
		<span class="pg-count" role="status">Showing {first}-{last} of {total} {noun}</span>
		<label class="pg-size"
			>Per page
			<select value={String(pageSize)} onchange={(e) => setSize(e.currentTarget.value)}>
				{#each PAGE_SIZES as n (n)}<option value={String(n)}>{n}</option>{/each}
			</select>
		</label>
		{#if pages > 1}
			<div class="pg-pages">
				<button type="button" class="pg-btn" disabled={page <= 1} onclick={() => go(page - 1)}
					>&larr; Prev</button
				>
				{#each numbers as n, i (typeof n === 'number' ? n : `gap${i}`)}
					{#if n === 'gap'}
						<span class="pg-gap" aria-hidden="true">&hellip;</span>
					{:else}
						<button
							type="button"
							class="pg-btn"
							class:active={n === page}
							aria-current={n === page ? 'page' : undefined}
							aria-label="Page {n}"
							onclick={() => go(n)}>{n}</button
						>
					{/if}
				{/each}
				<button type="button" class="pg-btn" disabled={page >= pages} onclick={() => go(page + 1)}
					>Next &rarr;</button
				>
			</div>
		{/if}
	</nav>
{/if}
