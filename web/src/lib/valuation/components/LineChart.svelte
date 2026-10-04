<script lang="ts">
	// A single-series SVG line chart — deliberately axis-free and minimal, matching the app's
	// existing sparkline style (dashboard.css .sparkline) but sized for standalone display
	// rather than an inline table cell.
	let {
		points,
		height = 120,
		positiveTone = null
	}: {
		points: number[];
		height?: number;
		// Overrides the auto tone (last >= first -> green) — useful when the series represents
		// something else (e.g. always render neutral).
		positiveTone?: boolean | null;
	} = $props();

	const width = 100; // viewBox units; scales to container via CSS width:100%
	const path = $derived.by(() => {
		if (points.length < 2) return '';
		const min = Math.min(...points);
		const max = Math.max(...points);
		const range = max - min || 1;
		return points
			.map((v, i) => {
				const x = (i / (points.length - 1)) * width;
				const y = height - ((v - min) / range) * height;
				return `${x.toFixed(2)},${y.toFixed(2)}`;
			})
			.join(' ');
	});

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
			class:pos={tone}
			class:neg={!tone}
		>
			<polyline points={path} />
		</svg>
		{#if changePct != null}
			<div class="line-chart-change" class:pos={tone} class:neg={!tone}>
				{changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}% over this range
			</div>
		{/if}
	{/if}
</div>

<style>
	.line-chart {
		width: 100%;
	}
	.line-chart svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.line-chart polyline {
		fill: none;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}
	.line-chart svg.pos polyline {
		stroke: var(--green);
	}
	.line-chart svg.neg polyline {
		stroke: var(--red);
	}
	.line-chart-change {
		font-family: 'IBM Plex Mono', monospace;
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
