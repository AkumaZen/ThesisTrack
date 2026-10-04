<script lang="ts">
	import { gapTo200, type PricePoint } from '$lib/valuation/priceChart';

	// Daily close with 50- and 200-day moving averages and a volume strip. Hover or use the arrow
	// keys to read any session. The averages are drawn from the full history, so the 200-day line
	// is complete across the visible range whenever the stock has 200+ sessions behind it.
	let { points, range = $bindable('1Y') }: { points: PricePoint[]; range?: (typeof RANGES)[number]['label'] } =
		$props();

	const RANGES = [
		{ label: '3M', bars: 63 },
		{ label: '6M', bars: 126 },
		{ label: '1Y', bars: 252 }
	] as const;
	let hover = $state<number | null>(null);
	let frame = $state<HTMLDivElement>();

	const W = 800;
	const PRICE_H = 260;
	const VOL_H = 56;
	const GAP = 20;
	const H = PRICE_H + GAP + VOL_H;
	const PAD_L = 4;
	const PAD_R = 56;

	const shown = $derived(points.slice(-(RANGES.find((r) => r.label === range)?.bars ?? 252)));
	const n = $derived(shown.length);
	const innerW = W - PAD_L - PAD_R;

	const bounds = $derived.by(() => {
		const vals: number[] = [];
		for (const p of shown) {
			vals.push(p.close);
			if (p.sma50 != null) vals.push(p.sma50);
			if (p.sma200 != null) vals.push(p.sma200);
		}
		const lo = Math.min(...vals);
		const hi = Math.max(...vals);
		const pad = (hi - lo) * 0.06 || hi * 0.02;
		return { lo: lo - pad, hi: hi + pad };
	});
	const maxVol = $derived(Math.max(1, ...shown.map((p) => p.volume)));

	const x = (i: number) => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
	const y = (v: number) => PRICE_H - ((v - bounds.lo) / (bounds.hi - bounds.lo)) * PRICE_H;

	function path(pick: (p: PricePoint) => number | null): string {
		let d = '';
		let pen = false;
		shown.forEach((p, i) => {
			const v = pick(p);
			if (v == null) {
				pen = false;
				return;
			}
			d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
			pen = true;
		});
		return d;
	}

	const closePath = $derived(path((p) => p.close));
	const sma50Path = $derived(path((p) => p.sma50));
	const sma200Path = $derived(path((p) => p.sma200));

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const fmtMonth = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
	const fmtDate = (d: string) =>
		`${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
	const inr = (v: number | null) =>
		v == null ? 'n/a' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`;
	const compact = (v: number) =>
		v >= 1e7
			? `${(v / 1e7).toFixed(2)}Cr`
			: v >= 1e5
				? `${(v / 1e5).toFixed(2)}L`
				: v.toLocaleString('en-IN');

	const yTicks = $derived(
		[0, 1, 2, 3, 4].map((k) => {
			const v = bounds.lo + ((bounds.hi - bounds.lo) * k) / 4;
			return { v, y: y(v) };
		})
	);
	const xTicks = $derived.by(() => {
		const out: { i: number; label: string }[] = [];
		let lastMonth = '';
		shown.forEach((p, i) => {
			const month = p.date.slice(0, 7);
			if (month !== lastMonth) {
				lastMonth = month;
				if (i > 4 && i < n - 4) out.push({ i, label: fmtMonth(p.date) });
			}
		});
		return out;
	});

	const current = $derived(hover != null ? shown[hover] : shown[n - 1]);
	const gap = $derived(gapTo200(shown));
	const have200 = $derived(shown.some((p) => p.sma200 != null));

	function onMove(e: PointerEvent) {
		if (!frame || n < 2) return;
		const rect = frame.getBoundingClientRect();
		const px = ((e.clientX - rect.left) / rect.width) * W;
		hover = Math.min(n - 1, Math.max(0, Math.round(((px - PAD_L) / innerW) * (n - 1))));
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			const from = hover ?? n - 1;
			hover = Math.min(n - 1, Math.max(0, from + (e.key === 'ArrowLeft' ? -1 : 1)));
		} else if (e.key === 'Escape') hover = null;
	}
</script>

{#if n > 1}
	<div class="pc" data-testid="price-chart">
		<div class="pc-head">
			<div class="pc-legend" aria-live="polite">
				<span class="pc-date">{fmtDate(current.date)}</span>
				<span class="pc-key"><i class="pc-sw pc-sw-close"></i>Close <b>{inr(current.close)}</b></span>
				<span class="pc-key"><i class="pc-sw pc-sw-50"></i>50 DMA <b>{inr(current.sma50)}</b></span>
				<span class="pc-key"><i class="pc-sw pc-sw-200"></i>200 DMA <b>{inr(current.sma200)}</b></span>
				<span class="pc-key">Volume <b>{compact(current.volume)}</b></span>
			</div>
			<div class="timeframe-bar pc-ranges" role="group" aria-label="Chart range">
				{#each RANGES as r (r.label)}
					<button
						type="button"
						class="timeframe-btn"
						class:active={range === r.label}
						aria-pressed={range === r.label}
						onclick={() => (range = r.label)}>{r.label}</button
					>
				{/each}
			</div>
		</div>

		<div
			bind:this={frame}
			class="pc-frame"
			role="slider"
			tabindex="0"
			aria-label="Session on the price chart. Left and right arrow keys move between sessions."
			aria-orientation="horizontal"
			aria-valuemin={0}
			aria-valuemax={n - 1}
			aria-valuenow={hover ?? n - 1}
			aria-valuetext="{fmtDate(current.date)}, close {inr(current.close)}, 50 DMA {inr(current.sma50)}, 200 DMA {inr(current.sma200)}"
			onpointermove={onMove}
			onpointerleave={() => (hover = null)}
			onkeydown={onKey}
			onblur={() => (hover = null)}
		>
		<svg viewBox="0 0 {W} {H}" class="pc-svg" aria-hidden="true">
			{#each yTicks as t (t.v)}
				<line x1={PAD_L} x2={W - PAD_R} y1={t.y} y2={t.y} class="pc-grid" />
				<text x={W - PAD_R + 6} y={Math.max(10, t.y + 4)} class="pc-axis">{inr(t.v)}</text>
			{/each}
			{#each xTicks as t (t.i)}
				<text x={x(t.i)} y={PRICE_H + 14} text-anchor="middle" class="pc-axis">{t.label}</text>
			{/each}

			{#if have200}<path d={sma200Path} class="pc-line pc-200" />{/if}
			<path d={sma50Path} class="pc-line pc-50" />
			<path d={closePath} class="pc-line pc-close" />

			{#each shown as p, i (p.date)}
				<rect
					x={x(i) - Math.max(0.6, innerW / n / 2 - 0.4)}
					width={Math.max(1.2, innerW / n - 0.8)}
					y={PRICE_H + GAP + VOL_H - (p.volume / maxVol) * VOL_H}
					height={(p.volume / maxVol) * VOL_H}
					class="pc-vol"
					class:pc-vol-up={i > 0 && p.close >= shown[i - 1].close}
				/>
			{/each}

			{#if hover != null}
				<line x1={x(hover)} x2={x(hover)} y1="0" y2={H} class="pc-cross" />
				<circle cx={x(hover)} cy={y(shown[hover].close)} r="3.5" class="pc-dot" />
			{/if}
		</svg>
		</div>

		<p class="pc-note">
			{#if have200 && gap != null}
				Latest close is
				<b class={gap >= 0 ? 'signal-good' : 'signal-bad'}>{Math.abs(gap).toFixed(1)}%</b>
				{gap >= 0 ? 'above' : 'below'} its 200-day average.
			{:else}
				Fewer than 200 sessions of history so far, so there is no 200-day average to draw yet.
			{/if}
			Daily closes, simple moving averages. Volume bars are green on up days.
		</p>
	</div>
{/if}
