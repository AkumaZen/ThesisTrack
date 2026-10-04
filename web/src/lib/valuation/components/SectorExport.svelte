<script lang="ts">
	import { downloadWorkbook, FORMATS, todayStamp } from '$lib/exportXlsx';
	import type { SectorReturn } from '$lib/sectorRotation';

	// Excel and Print / PDF for a grid of sector cards, in the order the grid shows them.
	let {
		title,
		filename,
		rows,
		countLabel
	}: {
		title: string;
		filename: string;
		rows: { label: string; data: SectorReturn | 'error' | undefined }[];
		/** What `constituents` counts on this page, e.g. "Sub-sectors" or "Companies". */
		countLabel: string;
	} = $props();

	let busy = $state(false);
	let failed = $state(false);
	const pending = $derived(rows.filter((r) => r.data === undefined).length);

	async function exportExcel() {
		busy = true;
		failed = false;
		try {
			await downloadWorkbook(`${filename}-${todayStamp()}`, [
				{
					name: title,
					notes: [
						`${title}, exported ${new Date().toLocaleString('en-IN')}.`,
						'Returns are price returns in %; RS is the sector return minus Nifty 50 over the same window.' +
							(pending ? ` ${pending} sector(s) had not loaded yet and are blank.` : '')
					],
					columns: [
						{ header: 'Sector', width: 40 },
						{ header: 'Signal', width: 14 },
						{ header: '1W', format: FORMATS.pct },
						{ header: '1M', format: FORMATS.pct },
						{ header: '3M', format: FORMATS.pct },
						{ header: '6M', format: FORMATS.pct },
						{ header: 'RS 1W', format: FORMATS.pct },
						{ header: 'RS 1M', format: FORMATS.pct },
						{ header: 'RS 3M', format: FORMATS.pct },
						{ header: 'RS 6M', format: FORMATS.pct },
						{ header: countLabel, format: FORMATS.int }
					],
					rows: rows.map(({ label, data }) => {
						const d = data && data !== 'error' ? data : null;
						return [
							label,
							d ? d.signal : data === 'error' ? 'Failed to load' : null,
							d?.return1w,
							d?.return1m,
							d?.return3m,
							d?.return6m,
							d?.rs1w,
							d?.rs1m,
							d?.rs3m,
							d?.rs6m,
							d?.constituents?.length
						];
					})
				}
			]);
		} catch {
			failed = true;
		} finally {
			busy = false;
		}
	}
</script>

<span class="sector-export no-print">
	<button
		class="sector-export-btn"
		type="button"
		data-testid="export-excel"
		disabled={busy}
		title={pending ? `${pending} still loading; they will be blank in the file` : undefined}
		onclick={exportExcel}>{busy ? 'Exporting…' : 'Excel'}</button
	>
	<button class="sector-export-btn" type="button" onclick={() => window.print()}>Print / PDF</button>
	{#if failed}<span class="team-error" role="alert">Could not build the Excel file.</span>{/if}
</span>
