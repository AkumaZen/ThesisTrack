// Finds the concall transcripts the Master Tracker already stored, and measures them. Pure.

import { createHash } from 'node:crypto';
import { shiftMonths } from './financials';

export interface StoredSource { id: string; title: string; url: string; pages: { page: number | null; text: string }[] }

export interface TranscriptRef {
	sourceId: string;
	title: string;
	url: string;
	/** Quarter end the call discusses (YYYY-MM-DD). */
	quarter: string;
	/** sha256 of the whitespace-normalised text: the cache key of the analysis. */
	hash: string;
	chars: number;
	/** Analyst "congratulations" in the text (a plain word count, not a model output). */
	congratulations: number;
}

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();

export function transcriptText(source: StoredSource): string {
	return source.pages.map((p) => normalise(p.text)).filter(Boolean).join('\n');
}

export const transcriptHash = (text: string) => createHash('sha256').update(normalise(text)).digest('hex');

/** Number of times analysts (or anyone) congratulate in the call: "congratulations", "congrats", "congratulate". */
export function countCongratulations(text: string): number {
	return text.match(/\bcongrat\w*/gi)?.length ?? 0;
}

export const isTranscript = (source: Pick<StoredSource, 'title'>) => /transcript/i.test(source.title);

/** The quarter a transcript discusses, read from titles such as "... FY2026-27 Q1 Transcript" or "Q1 FY27 earnings call". */
export function quarterFromTitle(title: string): string | null {
	const t = title.toUpperCase();
	const fyEnd = (year: string, tail?: string) => (tail ? 2000 + +tail : year.length === 2 ? 2000 + +year : +year);
	const patterns: [RegExp, (m: RegExpExecArray) => [string, number]][] = [
		[/\bFY\s?(\d{4})\s?-\s?(\d{2})\W{0,3}Q([1-4])\b/, (m) => [`${fyEnd(m[1], m[2])}`, +m[3]]],
		[/\bQ([1-4])\W{0,3}FY\s?(\d{4})\s?-\s?(\d{2})\b/, (m) => [`${fyEnd(m[2], m[3])}`, +m[1]]],
		[/\bQ([1-4])\W{0,3}FY\s?(\d{2}|\d{4})\b/, (m) => [`${fyEnd(m[2])}`, +m[1]]],
		[/\bFY\s?(\d{2}|\d{4})\W{0,3}Q([1-4])\b/, (m) => [`${fyEnd(m[1])}`, +m[2]]]
	];
	for (const [re, read] of patterns) {
		const m = re.exec(t);
		if (m) { const [year, q] = read(m); return shiftMonths(`${year}-03-31`, -12 + 3 * q); }
	}
	return null;
}

/** Transcripts among stored research sources, one per distinct text, newest quarter first. */
export function findTranscripts(sources: StoredSource[], fallbackQuarter?: string): TranscriptRef[] {
	const out = new Map<string, TranscriptRef>();
	for (const source of sources) {
		if (!isTranscript(source)) continue;
		const text = transcriptText(source);
		if (!text) continue;
		const quarter = quarterFromTitle(source.title) ?? fallbackQuarter;
		if (!quarter) continue;
		const hash = transcriptHash(text);
		if (!out.has(hash)) out.set(hash, { sourceId: source.id, title: source.title, url: source.url, quarter, hash, chars: text.length, congratulations: countCongratulations(text) });
	}
	return [...out.values()].sort((a, b) => b.quarter.localeCompare(a.quarter));
}
