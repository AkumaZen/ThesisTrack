import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { parseSmtpConfig, sendAlertEmail } from './alertEmail';

// A minimal in-process SMTP server (just enough of RFC 5321 for one message) so the REAL
// nodemailer SMTP transport is exercised end to end - connection, EHLO, MAIL FROM, RCPT TO,
// DATA - rather than only the message builder. No network, no credentials.
function startSmtpSink() {
	const received: { from: string; to: string[]; data: string }[] = [];
	const server = net.createServer((socket) => {
		let buffer = '';
		let inData = false;
		let current = { from: '', to: [] as string[], data: '' };
		socket.write('220 sink ESMTP\r\n');
		socket.on('data', (chunk) => {
			buffer += chunk.toString('utf8');
			for (;;) {
				if (inData) {
					const end = buffer.indexOf('\r\n.\r\n');
					if (end === -1) return;
					current.data = buffer.slice(0, end);
					buffer = buffer.slice(end + 5);
					inData = false;
					received.push(current);
					current = { from: '', to: [], data: '' };
					socket.write('250 queued\r\n');
					continue;
				}
				const eol = buffer.indexOf('\r\n');
				if (eol === -1) return;
				const line = buffer.slice(0, eol);
				buffer = buffer.slice(eol + 2);
				const cmd = line.slice(0, 4).toUpperCase();
				if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250 sink\r\n');
				else if (cmd === 'MAIL') {
					current.from = line.match(/<([^>]*)>/)?.[1] ?? '';
					socket.write('250 ok\r\n');
				} else if (cmd === 'RCPT') {
					current.to.push(line.match(/<([^>]*)>/)?.[1] ?? '');
					socket.write('250 ok\r\n');
				} else if (cmd === 'DATA') {
					inData = true;
					socket.write('354 go\r\n');
				} else if (cmd === 'QUIT') {
					socket.write('221 bye\r\n');
					socket.end();
				} else socket.write('250 ok\r\n');
			}
		});
	});
	return new Promise<{ port: number; received: typeof received; close: () => Promise<void> }>(
		(resolve) => {
			server.listen(0, '127.0.0.1', () => {
				const { port } = server.address() as net.AddressInfo;
				resolve({
					port,
					received,
					close: () => new Promise((r) => server.close(() => r()))
				});
			});
		}
	);
}

let closeSink: (() => Promise<void>) | null = null;
afterEach(async () => {
	await closeSink?.();
	closeSink = null;
});

describe('sendAlertEmail over real SMTP', () => {
	it('delivers one message to every configured recipient', async () => {
		const sink = await startSmtpSink();
		closeSink = sink.close;
		const cfg = parseSmtpConfig({
			SMTP_HOST: '127.0.0.1',
			SMTP_PORT: String(sink.port),
			SMTP_FROM: 'Dashboard <alerts@example.com>',
			ALERT_EMAIL_TO: 'a@example.com, b@example.org'
		})!;

		await sendAlertEmail(
			{
				type: 'near_breakout',
				subjectLabel: 'Infosys Ltd',
				message:
					'Infosys Ltd entered Near Stage 2 Breakout (was Stage 1 Base). 2.1% below resistance.',
				href: '/valuation/company/INFY'
			},
			cfg
		);

		expect(sink.received).toHaveLength(1);
		const mail = sink.received[0];
		expect(mail.from).toBe('alerts@example.com');
		expect(mail.to).toEqual(['a@example.com', 'b@example.org']);
		expect(mail.data).toContain('Subject: [ThesisTrack] Near breakout: Infosys Ltd');
		expect(mail.data).toContain('entered Near Stage 2 Breakout');
		expect(mail.data).toContain('http://localhost:5173/valuation/company/INFY');
	});

	it('rejects (so callers can report it) when the server is unreachable', async () => {
		const cfg = parseSmtpConfig({
			SMTP_HOST: '127.0.0.1',
			SMTP_PORT: '1', // nothing listens here
			SMTP_FROM: 'a@example.com',
			ALERT_EMAIL_TO: 'b@example.com'
		})!;
		await expect(
			sendAlertEmail({ type: 'near_breakout', subjectLabel: 'X', message: 'm', href: null }, cfg)
		).rejects.toThrow();
	});
});
