import { describe, expect, it } from 'vitest';
import { deepLink, formatTelegramAlert, parseTelegramUpdate } from './telegram';

const msg = (text: string, type = 'private', id: number | string = 123456) => ({ message: { text, chat: { id, type } } });
const TOKEN = 'abcdefghijklmnopqrstuvwx_-12';

describe('parseTelegramUpdate', () => {
	it('reads /start with a token from a private chat', () => {
		expect(parseTelegramUpdate(msg(`/start ${TOKEN}`))).toEqual({ kind: 'start', chatId: '123456', token: TOKEN });
		expect(parseTelegramUpdate(msg(`/start@ThesisBot ${TOKEN}`))).toEqual({ kind: 'start', chatId: '123456', token: TOKEN });
	});
	it('treats a bare or malformed /start as a start without a token', () => {
		expect(parseTelegramUpdate(msg('/start'))).toEqual({ kind: 'start', chatId: '123456', token: null });
		expect(parseTelegramUpdate(msg('/start short'))).toEqual({ kind: 'start', chatId: '123456', token: null });
		expect(parseTelegramUpdate(msg(`/start ${TOKEN}<script>`))).toEqual({ kind: 'start', chatId: '123456', token: null });
	});
	it('reads /stop', () => {
		expect(parseTelegramUpdate(msg('/stop'))).toEqual({ kind: 'stop', chatId: '123456' });
	});
	it('ignores groups, other text and junk', () => {
		expect(parseTelegramUpdate(msg(`/start ${TOKEN}`, 'group'))).toBeNull();
		expect(parseTelegramUpdate(msg('hello'))).toBeNull();
		expect(parseTelegramUpdate(null)).toBeNull();
		expect(parseTelegramUpdate({ message: { text: '/stop', chat: { type: 'private' } } })).toBeNull();
	});
});

describe('deepLink and alert text', () => {
	it('builds the t.me link', () => {
		expect(deepLink('@ThesisTrackBot', TOKEN)).toBe(`https://t.me/ThesisTrackBot?start=${TOKEN}`);
	});
	it('escapes HTML in titles and bodies and only links http(s) documents', () => {
		const text = formatTelegramAlert({ title: '[Results] A&B: <b>x</b>', body: 'Profit > 5', url: '/u', tag: 't' }, 'https://x.example/a.pdf?a=1&b="2"');
		expect(text).toBe(
			'<b>[Results] A&amp;B: &lt;b&gt;x&lt;/b&gt;</b>\n\nProfit &gt; 5\n\n<a href="https://x.example/a.pdf?a=1&amp;b=&quot;2&quot;">Open document</a>'
		);
		expect(formatTelegramAlert({ title: 't', body: 'b', url: '/u', tag: 't' }, 'javascript:alert(1)')).toBe('<b>t</b>\n\nb');
	});
});
