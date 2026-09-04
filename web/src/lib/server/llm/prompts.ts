// Ports app/llm/prompts.py. Same version tag gets written into every export
// row's metadata (see exporter.ts) - keep this string in lockstep with the
// Python REVIEWER_PROMPT_VERSION if the prompt ever changes.
export const REVIEWER_PROMPT_VERSION = 'v1';

export const REVIEWER_SYSTEM_PROMPT =
	'You are an investment thesis auditor. You are given a written thesis and the ' +
	'latest verified operating data. Decide whether the thesis is intact. You must ' +
	'reason only from the data provided; if the data does not settle a question, say ' +
	'so and lower your confidence rather than assuming. Return JSON only.';

interface ThesisDataLike {
	the_business?: { what_it_does?: string };
	the_big_change?: { summary?: string };
	why_we_believe_it?: string[];
	what_can_kill_it?: Array<{ label?: string }>;
}

export function buildReviewerUserPrompt(opts: {
	companyName: string;
	broadIndustry: string;
	specificNiche: string;
	operatingModel: string;
	authoredAt: string;
	thesisData: ThesisDataLike;
	period: string;
	metrics: unknown[];
	narrative: string | null | undefined;
	ruleEngineFindings: unknown[];
}): string {
	const { companyName, broadIndustry, specificNiche, operatingModel, authoredAt, thesisData, period, metrics, narrative, ruleEngineFindings } =
		opts;
	const redlines = (thesisData.what_can_kill_it ?? []).map((t) => t.label);
	return (
		`COMPANY: ${companyName} | ${broadIndustry} > ${specificNiche} | ${operatingModel}\n` +
		`THESIS (as written on ${authoredAt}):\n` +
		`  The Business: ${thesisData.the_business?.what_it_does ?? ''}\n` +
		`  The Big Change: ${thesisData.the_big_change?.summary ?? ''}\n` +
		`  Why We Believe It: ${JSON.stringify(thesisData.why_we_believe_it ?? [])}\n` +
		`  Invalidation Redlines: ${JSON.stringify(redlines)}\n` +
		`NEW EVIDENCE (${period}):\n` +
		`  metrics: ${JSON.stringify(metrics)}\n` +
		`  narrative: ${narrative || ''}\n` +
		`RULE ENGINE FINDINGS: ${JSON.stringify(ruleEngineFindings)}\n\n` +
		'Return: {"verdict": "on_track|watch_closely|broken", "confidence": 0.0-1.0, ' +
		'"reasoning_chain": ["Premise 1: ...","Premise 2: ...","Inference: ...","Conclusion: ..."], ' +
		'"evidence_used": ["metric_key", ...], "unresolved_questions": ["..."]}'
	);
}
