export const trackerSteps = [
	{ id: 'financials', label: 'Check company financials', detail: 'Read reported quarters, financial statements and market data.' },
	{ id: 'documents', label: 'Read calls and presentations', detail: 'Reuse downloaded documents or fetch the selected quarter’s files.' },
	{ id: 'analysis', label: 'Analyse guidance and scenarios', detail: 'Review growth drivers and build the requested valuation. This step may take a little while.' },
	{ id: 'validation', label: 'Verify figures and sources', detail: 'Check historical results, source references and scenario inputs.' },
	{ id: 'draft', label: 'Prepare your review draft', detail: 'Save a draft for review. Your accepted work stays unchanged until you save.' }
] as const;
export type TrackerStep = typeof trackerSteps[number]['id'];
export type TrackerProgress = (step: TrackerStep) => void;

export async function readTrackerResponse(response: Response, progress: TrackerProgress): Promise<Record<string, unknown>> {
	if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return response.json();
	if (!response.body) throw new Error('The progress connection did not open. Retry analysis.');
	const reader = response.body.getReader(), decoder = new TextDecoder();
	let buffer = '', result: Record<string, unknown> | undefined;
	const frame = (line: string) => {
		if (!line.trim()) return;
		const value = JSON.parse(line);
		if (value.type === 'error') throw new Error(value.message);
		if (value.type === 'progress' && trackerSteps.some((s) => s.id === value.step)) progress(value.step);
		if (value.type === 'result') result = value;
	};
	try {
		while (true) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let newline: number;
			while ((newline = buffer.indexOf('\n')) >= 0) { frame(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
			if (done) { frame(buffer); break; }
		}
	} finally { reader.releaseLock(); }
	if (!result) throw new Error('The analysis connection ended before the draft was ready. Retry; accepted work has not changed.');
	return result;
}
