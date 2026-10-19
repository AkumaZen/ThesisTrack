<script lang="ts">
	// Whole-market "% below 50 DMA" (or 200 DMA) breadth: a dark line chart with a red zone above 50%
	// (most stocks weak), a green zone below it, the area under the line, a dashed 50% reference and
	// a hover/keyboard readout. Plain SVG measured to its container, like the app's other charts.
	import { isoToDay, pctOf } from '../breadthDma';

	interface Point {
		asOf: string;
		eligible50: number;
		below50: number;
		eligible200: number;
		below200: number;
	}

	let { points, computedAt }: { points: Point[]; computedAt: string | null } = $props();

	type Range = '6M' | '1Y' | 'All';
	const RANGES: { id: Range; months: number | null }[] = [
		{ id: '6M', months: 6 },
		{ id: '1Y', months: 12 },
		{ id: 'All', months: null }
	];
	let range = $state<Range>('All');
	let basis = $state<50 | 200>(50);
	let width = $state(0);
	let hover = $state<number | null>(null);

	const MS_DAY = 86_400_000;
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const num = new Intl.NumberFormat('en-IN');

	// One value per day for the chosen average; a day with nothing eligible is dropped.
	const series = $derived(
		points
			.map((p) => {
				const eligible = basis === 50 ? p.eligible50 : p.eligible200;
				const below = basis === 50 ? p.below50 : p.below200;
				const value = pctOf(below, eligible);
				return value == null ? null : { asOf: p.asOf, day: isoToDay(p.asOf), value, eligible, below };
			})
			.filter((p): p is NonNullable<typeof p> => p != null)
	);

	const visible = $derived.by(() => {
		const months = RANGES.find((r) => r.id === range)?.months;
		if (!months || series.length === 0) return series;
		const last = new Date(series[series.length - 1].day * MS_DAY);
		last.setUTCMonth(last.getUTCMonth() - months);
		const from = Math.floor(last.getTime() / MS_DAY);
		return series.filter((p) => p.day >= from);
	});

	// Layout in CSS pixels: the SVG is exactly as wide as its container, so text stays crisp at 390px.
	const height = $derived(width < 520 ? 260 : 340);
	const M = $derived({ top: 10, right: width < 520 ? 38 : 48, bottom: 26, left: width < 520 ? 36 : 44 });
	const plotW = $derived(Math.max(0, width - M.left - M.right));
	const plotH = $derived(height - M.top - M.bottom);

	// Auto range like the reference (data min to max), widened only to keep the 50% line inside.
	const domain = $derived.by(() => {
		if (visible.length === 0) return { min: 0, max: 100 };
		let min = Math.min(...visible.map((p) => p.value), 50);
		let max = Math.max(...visible.map((p) => p.value), 50);
		if (max - min < 1) {
			min -= 0.5;
			max += 0.5;
		}
		return { min, max };
	});
	const x0 = $derived(visible[0]?.day ?? 0);
	const x1 = $derived(visible[visible.length - 1]?.day ?? 1);
	const xAt = (day: number) => M.left + (x1 === x0 ? 0 : ((day - x0) / (x1 - x0)) * plotW);
	const yAt = (v: number) => M.top + plotH - ((v - domain.min) / (domain.max - domain.min)) * plotH;

	const yTicks = $derived(Array.from({ length: 6 }, (_, i) => domain.min + ((domain.max - domain.min) * i) / 5));

	const linePath = $derived(visible.map((p, i) => `${i ? 'L' : 'M'}${xAt(p.day).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(''));
	const areaPath = $derived(
		visible.length < 2
			? ''
			: `${linePath}L${xAt(x1).toFixed(1)},${(M.top + plotH).toFixed(1)}L${xAt(x0).toFixed(1)},${(M.top + plotH).toFixed(1)}Z`
	);
	const y50 = $derived(yAt(50));

	// Month ticks, thinned so labels are at least ~62px apart; aligned to calendar quarters, halves, years.
	const xTicks = $derived.by(() => {
		if (visible.length < 2) return [];
		const first = new Date(x0 * MS_DAY);
		const maxTicks = Math.max(2, Math.floor(plotW / 62));
		const build = (step: number) => {
			const ticks: { x: number; label: string }[] = [];
			let y = first.getUTCFullYear();
			let m = first.getUTCMonth();
			for (let guard = 0; guard < 400; guard++) {
				const day = Math.floor(Date.UTC(y, m, 1) / MS_DAY);
				if (day > x1) break;
				if (day >= x0 && m % step === 0) ticks.push({ x: xAt(day), label: `${MONTHS[m]} ${y}` });
				if (++m === 12) {
					m = 0;
					y++;
				}
			}
			return ticks;
		};
		// The densest month step whose labels still fit.
		let ticks = build(12);
		for (const step of [1, 2, 3, 4, 6, 12]) {
			const t = build(step);
			if (t.length <= maxTicks) {
				ticks = t;
				break;
			}
		}
		return ticks;
	});

	const latest = $derived(visible.length ? visible[visible.length - 1] : null);
	const shown = $derived(hover != null && visible[hover] ? visible[hover] : latest);

	const fmtDate = (iso: string) => {
		const [y, m, d] = iso.split('-').map(Number);
		return `${d} ${MONTHS[m - 1]} ${y}`;
	};
	const weekday = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
	const stamp = $derived(
		computedAt
			? new Intl.DateTimeFormat('en-GB', {
					timeZone: 'Asia/Kolkata',
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					hour: '2-digit',
					minute: '2-digit',
					hour12: false
				}).format(new Date(computedAt))
			: null
	);

	function pointer(e: PointerEvent) {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const px = e.clientX - box.left - M.left;
		if (visible.length === 0 || plotW <= 0) return;
		const day = x0 + (Math.min(Math.max(px, 0), plotW) / plotW) * (x1 - x0);
		let best = 0;
		for (let i = 1; i < visible.length; i++) if (Math.abs(visible[i].day - day) < Math.abs(visible[best].day - day)) best = i;
		hover = best;
	}
	function key(e: KeyboardEvent) {
		if (visible.length === 0) return;
		const cur = hover ?? visible.length - 1;
		const step = e.shiftKey ? 10 : 1;
		if (e.key === 'ArrowLeft') hover = Math.max(0, cur - step);
		else if (e.key === 'ArrowRight') hover = Math.min(visible.length - 1, cur + step);
		else if (e.key === 'Home') hover = 0;
		else if (e.key === 'End') hover = visible.length - 1;
		else if (e.key === 'Escape') hover = null;
		else return;
		e.preventDefault();
	}

	// Tooltip box next to the hovered point, kept inside the plot.
	const TIP_W = 168;
	const tipX = $derived.by(() => {
		if (hover == null || !visible[hover]) return 0;
		const x = xAt(visible[hover].day);
		// Stay inside the plot so the 50% label on the right is never covered.
		return x + 12 + TIP_W > M.left + plotW ? x - 12 - TIP_W : x + 12;
	});
</script>

<figure class="dma" data-testid="dma-chart">
	<div class="dma-head">
		<div class="dma-titles">
			<h2 class="dma-title">% Below {basis} DMA</h2>
			{#if shown}
				<p class="dma-legend" data-testid="dma-legend">
					<span class="dma-swatch" aria-hidden="true"></span>
					% below {basis} dma: <strong>{shown.value.toFixed(1)}</strong>
				</p>
			{/if}
		</div>
		<div class="dma-controls">
			<div class="dma-group" role="group" aria-label="Moving average">
				<button type="button" aria-pressed={basis === 50} onclick={() => (basis = 50)}>50 DMA</button>
				<button type="button" aria-pressed={basis === 200} onclick={() => (basis = 200)}>200 DMA</button>
			</div>
			<div class="dma-group" role="group" aria-label="Date range">
				{#each RANGES as r (r.id)}
					<button type="button" aria-pressed={range === r.id} onclick={() => (range = r.id)}>{r.id}</button>
				{/each}
			</div>
		</div>
	</div>
	{#if stamp}<p class="dma-stamp">Updated {stamp} IST</p>{/if}

	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="dma-plot"
		bind:clientWidth={width}
		style:height="{height}px"
		tabindex="0"
		role="group"
		aria-label="% below {basis} day average chart. Use the left and right arrow keys to read each day."
		onpointermove={pointer}
		onpointerleave={() => (hover = null)}
		onkeydown={key}
		onblur={() => (hover = null)}
	>
		{#if width > 0 && visible.length >= 2}
			<svg {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
				<rect x={M.left} y={M.top} width={plotW} height={Math.max(0, y50 - M.top)} class="zone-red" />
				<rect x={M.left} y={y50} width={plotW} height={Math.max(0, M.top + plotH - y50)} class="zone-green" />
				<path d={areaPath} class="area" />
				<path d={linePath} class="line" />
				<line x1={M.left} x2={M.left + plotW} y1={y50} y2={y50} class="ref" />
				<text x={M.left + plotW + 6} y={y50} dy="0.34em" class="ref-label">50%</text>
				{#each yTicks as t, i (i)}
					<text x={M.left - 6} y={yAt(t)} dy="0.34em" text-anchor="end" class="tick">{t.toFixed(1)}</text>
				{/each}
				{#each xTicks as t (t.label)}
					<text x={t.x} y={height - 8} text-anchor={t.x - M.left < 24 ? 'start' : 'middle'} class="tick">{t.label}</text>
				{/each}
				{#if hover != null && visible[hover]}
					{@const hp = visible[hover]}
					<line x1={xAt(hp.day)} x2={xAt(hp.day)} y1={M.top} y2={M.top + plotH} class="cross" />
					<circle cx={xAt(hp.day)} cy={yAt(hp.value)} r="4.5" class="dot" />
				{/if}
			</svg>
			{#if hover != null && visible[hover]}
				{@const hp = visible[hover]}
				<div class="dma-tip" style:left="{tipX}px" style:top="{Math.min(Math.max(yAt(hp.value) - 30, M.top), M.top + plotH - 64)}px" style:width="{TIP_W}px">
					<strong>{weekday(hp.asOf)} {fmtDate(hp.asOf)}</strong>
					<span>% below {basis} dma: <b>{hp.value.toFixed(1)}</b></span>
					<span class="dma-tip-n">{num.format(hp.below)} of {num.format(hp.eligible)} stocks</span>
				</div>
			{/if}
		{:else if visible.length < 2}
			<p class="dma-empty">Not enough days stored to chart.</p>
		{/if}
	</div>

	{#if latest}
		<figcaption class="dma-note" data-testid="dma-summary" aria-live="polite">
			{#if hover != null && visible[hover]}
				{fmtDate(visible[hover].asOf)}: {visible[hover].value.toFixed(1)}% of {num.format(visible[hover].eligible)} stocks closed below their
				{basis} day average ({num.format(visible[hover].below)}).
			{:else}
				{fmtDate(latest.asOf)}: {latest.value.toFixed(1)}% of {num.format(latest.eligible)} NSE stocks closed below their {basis} day average
				({num.format(latest.below)}). Over {visible[0].asOf} to {latest.asOf} the range was {domain.min.toFixed(1)}% to {domain.max.toFixed(1)}%.
			{/if}
			Each day counts only stocks with at least {basis} closes up to that day (so the count varies).
		</figcaption>
	{/if}
</figure>

<style>
	.dma {
		margin: 0 0 16px;
		padding: 12px 14px 10px;
		background: #1f2023;
		color: #e6e6e6;
		border: var(--border-w, 2px) solid var(--ink);
		box-shadow: var(--shadow);
		min-width: 0;
	}
	.dma-head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 8px 16px;
	}
	.dma-titles {
		min-width: 0;
	}
	.dma-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: 15px;
		font-weight: 700;
		color: #fff;
	}
	.dma-legend {
		margin: 6px 0 0;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 6px;
		color: #cfcfcf;
	}
	.dma-legend strong {
		font-family: var(--font-mono);
		color: #fff;
	}
	.dma-swatch {
		width: 10px;
		height: 10px;
		background: #7ea6f5;
		display: inline-block;
	}
	.dma-stamp {
		margin: 2px 0 0;
		font-family: var(--font-mono);
		font-size: 10px;
		color: #8f8f8f;
		text-align: right;
	}
	.dma-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.dma-group {
		display: inline-flex;
		border: 1.5px solid #8f8f8f;
	}
	.dma-group button {
		appearance: none;
		background: transparent;
		color: #cfcfcf;
		border: 0;
		border-right: 1.5px solid #8f8f8f;
		padding: 5px 10px;
		min-height: 30px;
		font: 600 11px/1 var(--font-mono);
		cursor: pointer;
	}
	.dma-group button:last-child {
		border-right: 0;
	}
	.dma-group button[aria-pressed='true'] {
		background: #f2b134;
		color: #111;
	}
	.dma-group button:focus-visible,
	.dma-plot:focus-visible {
		outline: 2px solid #f2b134;
		outline-offset: 2px;
	}
	.dma-plot {
		position: relative;
		width: 100%;
		margin-top: 4px;
		touch-action: pan-y;
		overflow: hidden;
	}
	.dma-plot svg {
		display: block;
	}
	.zone-red {
		fill: rgba(205, 85, 85, 0.42);
	}
	.zone-green {
		fill: rgba(70, 150, 80, 0.45);
	}
	.area {
		fill: rgba(126, 166, 245, 0.42);
	}
	.line {
		fill: none;
		stroke: #7ea6f5;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}
	.ref {
		stroke: #f2b134;
		stroke-width: 1.4;
		stroke-dasharray: 5 4;
	}
	.ref-label {
		fill: #f2b134;
		font: 700 11px var(--font-mono);
	}
	.tick {
		fill: #b5b5b5;
		font: 10px var(--font-mono);
	}
	.cross {
		stroke: #ffffff;
		stroke-opacity: 0.55;
		stroke-width: 1;
	}
	.dot {
		fill: #7ea6f5;
		stroke: #fff;
		stroke-width: 2;
	}
	.dma-tip {
		position: absolute;
		pointer-events: none;
		background: #111;
		border: 1.5px solid #f2b134;
		padding: 6px 8px;
		font-size: 11px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: #eee;
	}
	.dma-tip b {
		font-family: var(--font-mono);
		color: #fff;
	}
	.dma-tip-n {
		color: #9a9a9a;
	}
	.dma-empty {
		margin: 0;
		padding: 40px 0;
		text-align: center;
		color: #9a9a9a;
		font-size: 12px;
	}
	.dma-note {
		margin: 6px 0 0;
		font-size: 11px;
		line-height: 1.45;
		color: #9a9a9a;
	}
</style>
