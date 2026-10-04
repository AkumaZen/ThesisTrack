import { env } from '$env/dynamic/private';
import { parseSmtpConfig, sendAlertEmail, buildAlertEmail, createTransport } from './alertEmail';
import type { AlertRecord } from '../alerts';

/** Read live from env each call so a changed .env value is picked up after a restart without
 *  any module-level caching to invalidate. */
function config() {
	return parseSmtpConfig(env);
}

export function emailStatus(): { configured: boolean; recipients: string[] } {
	const cfg = config();
	return { configured: cfg != null, recipients: cfg?.to ?? [] };
}

/** Best-effort: a mail failure is logged and swallowed - it must never block or lose the
 *  in-app alert, which has already been written by the time this is called. */
export async function notifyByEmail(alert: AlertRecord): Promise<void> {
	const cfg = config();
	if (!cfg) return;
	try {
		await sendAlertEmail(alert, cfg);
	} catch (e) {
		console.error('[alerts] email send failed:', e instanceof Error ? e.message : e);
	}
}

/** For the "Send test email" button: unlike notifyByEmail this surfaces the error. */
export async function sendTestEmail(): Promise<{ ok: true } | { ok: false; message: string }> {
	const cfg = config();
	if (!cfg) return { ok: false, message: 'Email is not configured (see SMTP_* in .env).' };
	try {
		const transport = createTransport(cfg);
		await transport.sendMail(
			buildAlertEmail(
				{
					type: 'price_fair_value',
					subjectLabel: 'Test email',
					message: 'This is a test email from ThesisTrack. Email alerts are working.',
					href: null
				},
				cfg
			)
		);
		return { ok: true };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : 'Could not send the email.' };
	}
}
