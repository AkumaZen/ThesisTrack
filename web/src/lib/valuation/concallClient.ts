// Browser side of the explicit Refresh / Analyse actions: repeats a small server batch until it is
// done, stops on an error or when a pass makes no progress, and reports plain-language status.

export interface RunSummary { ok: boolean; message: string; changed: boolean }

async function post(body: Record<string, unknown>) {
	const response = await fetch('/api/valuation/concalls/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : `The request failed (HTTP ${response.status}).`);
	return data;
}

export async function runBatches(mode: 'refresh' | 'analyse', symbols: string[] | undefined, progress: (text: string) => void): Promise<RunSummary> {
	let total = 0, input = 0, output = 0;
	const failures: string[] = [];
	try {
		for (let pass = 0; pass < 12; pass++) {
			progress(mode === 'refresh' ? `Refreshing checks... ${total} done` : `Analysing transcripts... ${total} done`);
			const r = await post({ mode, symbols, limit: mode === 'refresh' ? 5 : 3 });
			const done = mode === 'refresh' ? r.done.length : r.analysed.length;
			total += done;
			for (const a of r.analysed ?? []) { input += a.inputTokens; output += a.outputTokens; }
			for (const f of r.failed) failures.push(f.message);
			if (!r.remaining || (!done && !r.cached)) break;
		}
	} catch (e) {
		return { ok: false, changed: total > 0, message: e instanceof Error ? e.message : 'The run failed.' };
	}
	const unique = [...new Set(failures)];
	const base = mode === 'refresh' ? `Refreshed ${total} ${total === 1 ? 'company' : 'companies'}.` : `Analysed ${total} ${total === 1 ? 'transcript' : 'transcripts'} (${input.toLocaleString('en-IN')} input and ${output.toLocaleString('en-IN')} output tokens).`;
	return { ok: !unique.length, changed: total > 0, message: unique.length ? `${base} ${unique.slice(0, 2).join(' ')}` : base };
}
