import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer';
import { ALERT_TYPE_LABELS, type AlertRecord } from '../alerts';

// Pure (no $env import) so config parsing and message building are unit-testable; the env
// wiring lives in alertNotify.ts. Email is strictly optional: with no SMTP settings,
// parseSmtpConfig returns null and nothing here is ever called.

export interface SmtpConfig {
	host: string;
	port: number;
	secure: boolean;
	user: string | null;
	pass: string | null;
	from: string;
	to: string[];
	/** Used to build the link back into the app inside each email. */
	appUrl: string;
}

type Env = Record<string, string | undefined>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns null (email disabled) unless host, from and at least one valid recipient are set. */
export function parseSmtpConfig(env: Env): SmtpConfig | null {
	const host = env.SMTP_HOST?.trim();
	const from = env.SMTP_FROM?.trim();
	const to = (env.ALERT_EMAIL_TO ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter((s) => EMAIL_RE.test(s));
	if (!host || !from || to.length === 0) return null;

	const port = Number(env.SMTP_PORT) || 587;
	const user = env.SMTP_USER?.trim() || null;
	const pass = env.SMTP_PASS || null;
	return {
		host,
		port,
		secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
		user: user && pass ? user : null,
		pass: user && pass ? pass : null,
		from,
		to,
		appUrl: (env.APP_BASE_URL?.trim() || 'http://localhost:5173').replace(/\/+$/, '')
	};
}

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildAlertEmail(
	alert: Pick<AlertRecord, 'type' | 'subjectLabel' | 'message' | 'href'>,
	cfg: Pick<SmtpConfig, 'from' | 'to' | 'appUrl'>
): SendMailOptions {
	const typeLabel = ALERT_TYPE_LABELS[alert.type];
	const link = alert.href ? `${cfg.appUrl}${alert.href}` : `${cfg.appUrl}/valuation/alerts`;
	return {
		from: cfg.from,
		to: cfg.to,
		subject: `[ThesisTrack] ${typeLabel}: ${alert.subjectLabel}`,
		text: `${alert.message}\n\nOpen: ${link}\n`,
		html:
			`<p style="font:14px/1.5 sans-serif">${esc(alert.message)}</p>` +
			`<p style="font:13px sans-serif"><a href="${esc(link)}">Open in ThesisTrack</a></p>`
	};
}

export function createTransport(cfg: SmtpConfig): Transporter {
	return nodemailer.createTransport({
		host: cfg.host,
		port: cfg.port,
		secure: cfg.secure,
		auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined
	});
}

export async function sendAlertEmail(
	alert: Pick<AlertRecord, 'type' | 'subjectLabel' | 'message' | 'href'>,
	cfg: SmtpConfig,
	transport: Transporter = createTransport(cfg)
): Promise<void> {
	await transport.sendMail(buildAlertEmail(alert, cfg));
}
