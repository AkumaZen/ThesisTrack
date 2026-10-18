// Pure rules for personal watchlist sections and company flags. No network or database in here.

export const FLAG_COLORS = [
	{ key: 'red', label: 'Red', css: '#ff6b6b' },
	{ key: 'orange', label: 'Orange', css: '#ffa94d' },
	{ key: 'yellow', label: 'Yellow', css: '#ffe066' },
	{ key: 'green', label: 'Green', css: '#69db7c' },
	{ key: 'blue', label: 'Blue', css: '#74c0fc' },
	{ key: 'purple', label: 'Purple', css: '#b197fc' }
] as const;

export type FlagColor = (typeof FLAG_COLORS)[number]['key'];

export const isFlagColor = (v: unknown): v is FlagColor => FLAG_COLORS.some((c) => c.key === v);
export const flagCss = (key: string | null | undefined): string | null => FLAG_COLORS.find((c) => c.key === key)?.css ?? null;

export const MAX_SECTIONS = 20;
export const MAX_SECTION_ITEMS = 200;
export const MAX_NAME = 40;
export const MAX_FLAG_LABEL = 24;

const squash = (v: string) => v.replace(/\s+/g, ' ').trim();

export function validateSectionName(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
	const name = typeof raw === 'string' ? squash(raw) : '';
	if (!name) return { ok: false, message: 'Give the section a name.' };
	if (name.length > MAX_NAME) return { ok: false, message: `Keep the name to ${MAX_NAME} characters.` };
	return { ok: true, value: name };
}

export interface Flag {
	color: FlagColor | null;
	label: string | null;
}

/** A flag from a request: a colour from the palette and/or a short label; both empty clears it. */
export function validateFlag(body: unknown): { ok: true; value: Flag } | { ok: false; message: string } {
	const b = (body ?? {}) as Record<string, unknown>;
	const rawColor = b.color == null || b.color === '' ? null : b.color;
	if (rawColor != null && !isFlagColor(rawColor)) return { ok: false, message: 'Pick one of the listed colours.' };
	const label = typeof b.label === 'string' ? squash(b.label) : '';
	if (label.length > MAX_FLAG_LABEL) return { ok: false, message: `Keep the label to ${MAX_FLAG_LABEL} characters.` };
	return { ok: true, value: { color: rawColor as FlagColor | null, label: label || null } };
}
