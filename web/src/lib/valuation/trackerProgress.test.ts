import { describe, expect, it, vi } from 'vitest';
import { readTrackerResponse } from './trackerProgress';

function streamed(text: string) {
	const bytes = new TextEncoder().encode(text);
	return new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }), { headers: { 'content-type': 'application/x-ndjson' } });
}
describe('Tracker progress stream', () => {
	it('handles split lines and Unicode, reporting real stages before returning the draft', async () => {
		const progress = vi.fn();
		const result = await readTrackerResponse(streamed('{"type":"progress","step":"documents"}\n{"type":"progress","step":"analysis"}\n{"type":"result","message":"Ready ✓"}\n'), progress);
		expect(progress.mock.calls).toEqual([['documents'], ['analysis']]); expect(result.message).toBe('Ready ✓');
	});
	it('surfaces a streamed failure without returning a successful draft', async () => {
		await expect(readTrackerResponse(streamed('{"type":"error","message":"Documents unavailable"}\n'), vi.fn())).rejects.toThrow('Documents unavailable');
		await expect(readTrackerResponse(streamed('{"type":"progress","step":"analysis"}\n'), vi.fn())).rejects.toThrow('ended before the draft');
	});
});
