<script lang="ts">
	// A single-series SVG line chart — deliberately axis-free and minimal, matching the app's
	// existing sparkline style (dashboard.css .sparkline) but sized for standalone display
	// rather than an inline table cell.
	let {
		points,
		height = 120,
		positiveTone = null,
		sma200 = undefined
	}: {
		points: number[];
		height?: number;
		// 200-day average, one entry per point (null where there is not yet a full 200 sessions).
		sma200?: (number | null)[];
		// Overrides the auto tone (last >= first -> green) — useful when the series represents
		// something else (e.g. always render neutral).
		positiveTone?: boolean | null;
	} = $props();

	const width = 100; // viewBox units; scales to container via CSS width:100%
	// Both lines share one scale, so the average is never drawn outside the chart.
	const bounds = $derived.by(() => {
		const vals = [...points, ...(sma200 ?? []).filter((v): v is number => v != null)];
		const min = Math.min(...vals);
		const max = Math.max(...vals);
		return { min, range: max - min || 1 };
	});
	const xAt = (i: number) => (i / (points.length - 1)) * width;
	const yAt = (v: number) => height - ((v - bounds.min) / bounds.range) * height;

	const path = $derived(
		points.length < 2 ? '' : points.map((v, i) => `${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`).join(' ')
	);
	const smaPath = $derived(
		points.length < 2 || !sma200
			? ''
			: sma200
					.map((v, i) => (v == null ? null : `${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`))
					.filter((p): p is string => p != null)
					.join(' ')
	);
	const hasSma = $derived(smaPath.includes(' '));

	const tone = $derived(
		positiveTone ?? (points.length >= 2 ? points[points.length - 1] >= points[0] : true)
	);

	const changePct = $derived(
		points.length >= 2 && points[0] !== 0
			? ((points[points.length - 1] - points[0]) / points[0]) * 100
			: null
	);
</script>

<div class="line-chart">
	{#if points.length < 2}
		<div class="line-chart-empty">Not enough data to chart</div>
	{:else}
		<svg
			viewBox="0 0 {width} {height}"
			preserveAspectRatio="none"
			style:height="{height}px"
			class:pos={tone}
			class:neg={!tone}
		>
			{#if hasSma}<polyline points={smaPath} class="sma" />{/if}
			<polyline points={path} class="price" />
		</svg>
		{#if changePct != null}
			<div class="line-chart-change" class:pos={tone} class:neg={!tone}>
				{changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}% over this range
				{#if hasSma}<span class="line-chart-key"><i aria-hidden="true"></i>200 DMA</span>{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.line-chart {
		width: 100%;
	}
	/* Full width, fixed height (the `height` prop): the line stretches horizontally rather than
	   the chart growing taller as the card gets wider. */
	.line-chart svg {
		width: 100%;
		display: block;
	}
	.line-chart polyline {
		fill: none;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}
	.line-chart svg.pos polyline.price {
		stroke: var(--green);
	}
	.line-chart svg.neg polyline.price {
		stroke: var(--red);
	}
	/* The 200-day average: a dashed neutral line behind the price. */
	.line-chart polyline.sma {
		stroke: var(--ink);
		stroke-width: 1.25;
		stroke-dasharray: 4 3;
		opacity: 0.7;
	}
	.line-chart-key {
		margin-left: 10px;
		color: var(--ink);
	}
	.line-chart-key i {
		display: inline-block;
		width: 16px;
		border-top: 1.5px dashed var(--ink);
		margin-right: 5px;
		vertical-align: middle;
	}
	.line-chart-change {
		font-family: var(--font-mono);
		font-size: 12px;
		margin-top: 6px;
	}
	.line-chart-change.pos {
		color: var(--green);
	}
	.line-chart-change.neg {
		color: var(--red);
	}
	.line-chart-empty {
		font-size: 12px;
		color: var(--muted);
		padding: 12px 0;
	}
</style>
