import { env } from '$env/dynamic/private';
import { AI_OFF_MESSAGE, aiEnabled } from './aiSwitch';

export const summariesEnabled = () => aiEnabled() && Boolean(env.OPEN_AI_KEY || env.OPENAI_API_KEY);

const INSTRUCTIONS =
	'You summarise Indian stock exchange announcements for an equity investor. In 2 to 3 plain-language ' +
	'sentences say what the company announced and what it could mean for shareholders (positive, negative ' +
	'or routine). Use only the text given; never invent figures. Do not use bullet points or markdown.';

/** Short investor-friendly summary of one announcement, from NSE's own subject and text.
 *  Throws on any failure; the caller leaves the announcement unsummarised and retries later. */
export async function summariseAnnouncement(
	a: { nseSymbol: string; companyName: string; subject: string; details: string },
	fetcher: typeof fetch = fetch
): Promise<string> {
	if (!aiEnabled()) throw new Error(AI_OFF_MESSAGE);
	const key = env.OPEN_AI_KEY || env.OPENAI_API_KEY;
	if (!key) throw new Error('No OpenAI key configured');
	const res = await fetcher('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
		body: JSON.stringify({
			model: env.OPENAI_MODEL || 'gpt-5.6-luna',
			store: false,
			max_output_tokens: 400,
			instructions: INSTRUCTIONS,
			input: `Company: ${a.companyName} (${a.nseSymbol})\nSubject: ${a.subject}\nDetails: ${a.details.slice(0, 4000)}`
		}),
		signal: AbortSignal.timeout(15000)
	});
	if (!res.ok) throw new Error(`OpenAI summary failed (HTTP ${res.status})`);
	const body = (await res.json()) as {
		status?: string;
		output?: { type: string; content?: { type: string; text?: string }[] }[];
	};
	if (body.status && body.status !== 'completed') throw new Error('OpenAI summary incomplete');
	const out = (body.output ?? [])
		.filter((i) => i.type === 'message')
		.flatMap((i) => i.content ?? [])
		.filter((c) => c.type === 'output_text')
		.map((c) => c.text ?? '')
		.join('')
		.trim();
	if (!out) throw new Error('OpenAI returned no summary text');
	return out;
}
