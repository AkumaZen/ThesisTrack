import { describe, expect, it } from 'vitest';
import nodemailer from 'nodemailer';
import { buildAlertEmail, parseSmtpConfig, sendAlertEmail } from './alertEmail';

const FULL = {
	SMTP_HOST: 'smtp.example.com',
	SMTP_FROM: 'Dashboard <alerts@example.com>',
	ALERT_EMAIL_TO: 'a@x.com, b@y.org'
};

describe('parseSmtpConfig', () => {
	it('is disabled (null) unless host, from and a valid recipient are all set', () => {
		expect(parseSmtpConfig({})).toBeNull();
		expect(parseSmtpConfig({ ...FULL, SMTP_HOST: '' })).toBeNull();
		expect(parseSmtpConfig({ ...FULL, SMTP_FROM: undefined })).toBeNull();
		expect(parseSmtpConfig({ ...FULL, ALERT_EMAIL_TO: 'not-an-email, , ' })).toBeNull();
	});

	it('parses recipients, defaults the port, and infers TLS from 465', () => {
		const c = parseSmtpConfig(FULL)!;
		expect(c.to).toEqual(['a@x.com', 'b@y.org']);
		expect(c.port).toBe(587);
		expect(c.secure).toBe(false);
		expect(parseSmtpConfig({ ...FULL, SMTP_PORT: '465' })!.secure).toBe(true);
	});

	it('only uses credentials when both user and password are given', () => {
		expect(parseSmtpConfig({ ...FULL, SMTP_USER: 'u' })!.user).toBeNull();
		const c = parseSmtpConfig({ ...FULL, SMTP_USER: 'u', SMTP_PASS: 'p' })!;
		expect([c.user, c.pass]).toEqual(['u', 'p']);
	});

	it('drops invalid recipients but keeps valid ones', () => {
		expect(parseSmtpConfig({ ...FULL, ALERT_EMAIL_TO: 'bad, ok@x.com' })!.to).toEqual(['ok@x.com']);
	});
});

describe('buildAlertEmail / sendAlertEmail', () => {
	const cfg = parseSmtpConfig({ ...FULL, APP_BASE_URL: 'https://dash.example.com/' })!;
	const alert = {
		type: 'price_fair_value' as const,
		subjectLabel: 'Acme <Ltd>',
		message: 'Acme <Ltd> reached fair value: ₹512.00 is at or above ₹500.00.',
		href: '/valuation/company/ACME'
	};

	it('builds a subject, deep link and escaped html', () => {
		const m = buildAlertEmail(alert, cfg);
		expect(m.subject).toBe('[ThesisTrack] Price vs fair value: Acme <Ltd>');
		expect(m.text).toContain('https://dash.example.com/valuation/company/ACME');
		expect(String(m.html)).toContain('Acme &lt;Ltd&gt;');
		expect(String(m.html)).not.toContain('<Ltd>');
	});

	it('falls back to the alerts page when there is no href', () => {
		expect(buildAlertEmail({ ...alert, href: null }, cfg).text).toContain('/valuation/alerts');
	});

	it('actually sends through a transport (in-memory JSON transport, no network)', async () => {
		const transport = nodemailer.createTransport({ jsonTransport: true });
		await expect(sendAlertEmail(alert, cfg, transport)).resolves.toBeUndefined();
		const info = await transport.sendMail(buildAlertEmail(alert, cfg));
		const sent = JSON.parse(info.message as string);
		expect(sent.subject).toContain('Price vs fair value');
		expect(sent.to.map((t: { address: string }) => t.address)).toEqual(['a@x.com', 'b@y.org']);
	});
});
