import { beforeEach, describe, expect, it, vi } from 'vitest';
const stubs = vi.hoisted(() => ({ env: { DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test', OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'must-not-be-used', AI_FEATURES: 'on' } }));
vi.mock('$env/dynamic/private', () => stubs);
import { summariseDocument } from '../src/lib/server/services/companyDocuments';

describe('PDF summaries', () => {
	const filing = { subject: 'Receipt of orders', details: 'Exchange notice', pdfUrl: 'https://nsearchives.nseindia.com/corporate/order.pdf' };
	beforeEach(() => { stubs.env.AI_FEATURES = 'on'; });
	it('sends the original PDF to Luna and validates its summary', async () => {
		const analysis = { important: true, category: 'Order wins', takeaway: 'A new contract was awarded.', summary: 'The contract is subject to conditions (page 1).' };
		const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }] }));
		expect(await summariseDocument(filing, fetcher)).toEqual(analysis);
		const input = JSON.parse(fetcher.mock.calls[0][1].body);
		expect(input.model).toBe('gpt-5.6-luna'); expect(input.store).toBe(false);
		expect(input.text.format.type).toBe('json_schema'); expect(input.text.format.strict).toBe(true);
		expect(input.text.format.schema.additionalProperties).toBe(false);
		expect(input.input[0].content[1]).toEqual({ type: 'input_file', file_url: filing.pdfUrl });
	});
	it('does not replace failed or unreadable PDFs with a title summary', async () => {
		const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'unreadable' }, { status: 400 }));
		await expect(summariseDocument(filing, fetcher)).rejects.toThrow('HTTP 400');
		fetcher.mockResolvedValue(Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Unreadable' }] }] }));
		await expect(summariseDocument(filing, fetcher)).rejects.toThrow();
	});
	it('honours the AI kill switch and rejects unsafe URLs without a network call', async () => {
		const fetcher = vi.fn(); stubs.env.AI_FEATURES = 'off';
		await expect(summariseDocument(filing, fetcher)).rejects.toThrow('turned off');
		stubs.env.AI_FEATURES = 'on';
		await expect(summariseDocument({ ...filing, pdfUrl: 'https://localhost/a.pdf' }, fetcher)).rejects.toThrow('supported exchange PDF');
		expect(fetcher).not.toHaveBeenCalled();
	});
});
