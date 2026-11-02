import { z } from 'zod';

export const IMAGE_CATEGORIES = ['PPT snapshot', 'Product', 'Key update', 'Other'] as const;
export const imageDetailsSchema = z.object({
	title: z.string().trim().min(1).max(120),
	category: z.enum(IMAGE_CATEGORIES),
	caption: z.string().trim().max(2000).default(''),
	sourceUrl: z.string().trim().max(2000).default('').refine((value) => {
		if (!value) return true;
		try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
	}, 'Use an HTTPS source link.')
});
export type ThesisImage = z.infer<typeof imageDetailsSchema> & { id: number; createdAt: string };

// Only raster formats: SVG/HTML can execute active content and are never accepted.
export function validImageData(value: string): boolean {
	if (value.length > 1_400_000) return false;
	const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
	if (!match || match[2].length % 4 !== 0) return false;
	const bytes = Uint8Array.from(atob(match[2].slice(0, 32)), (char) => char.charCodeAt(0));
	if (match[1] === 'jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	if (match[1] === 'png') return [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b);
	return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}
