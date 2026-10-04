import { describe, expect, it } from 'vitest';
import { forgetTab, readTab, writeTab } from './tabCache';
import type { StorageLike } from './viewMemory';

class MemoryStorage implements StorageLike {
	map = new Map<string, string>();
	/** Characters the fake browser accepts in all, like a real quota. */
	constructor(private quota = Infinity) {}
	get length() {
		return this.map.size;
	}
	key(i: number) {
		return [...this.map.keys()][i] ?? null;
	}
	getItem(k: string) {
		return this.map.get(k) ?? null;
	}
	setItem(k: string, v: string) {
		const used = [...this.map].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0);
		if (used + k.length + v.length > this.quota) throw new DOMException('full', 'QuotaExceededError');
		this.map.set(k, v);
	}
	removeItem(k: string) {
		this.map.delete(k);
	}
}

const HOUR = 3600_000;

describe('tabCache', () => {
	it('round trips a value while it is fresh', () => {
		const s = new MemoryStorage();
		writeTab('card:/a', { x: 1 }, 1000, s);
		expect(readTab('card:/a', HOUR, 2000, s)).toEqual({ x: 1 });
	});

	it('forgets a value once it is too old', () => {
		const s = new MemoryStorage();
		writeTab('card:/a', { x: 1 }, 1000, s);
		expect(readTab('card:/a', HOUR, 1000 + HOUR, s)).toBeUndefined();
		expect(s.length).toBe(0);
	});

	it('ignores an unreadable entry', () => {
		const s = new MemoryStorage();
		s.setItem('tt:v1:cache:card:/a', 'nonsense');
		expect(readTab('card:/a', HOUR, 1000, s)).toBeUndefined();
	});

	it('drops the oldest entries to stay within its budget', () => {
		const s = new MemoryStorage();
		const big = 'x'.repeat(180); // about 200 characters stored, five of them past the budget
		for (const [i, key] of ['a', 'b', 'c', 'd', 'e'].entries()) writeTab(key, big, i + 1, s, 800);
		expect(readTab('a', HOUR, 6, s)).toBeUndefined();
		expect(readTab('e', HOUR, 6, s)).toBe(big);
		const used = [...s.map].reduce((n, [k, v]) => n + k.length + v.length, 0);
		expect(used).toBeLessThanOrEqual(800);
	});

	it('makes room when the browser itself is full', () => {
		const s = new MemoryStorage(500); // room for two entries of about 220 characters
		const big = 'x'.repeat(200);
		for (const [i, key] of ['a', 'b', 'c'].entries()) writeTab(key, big, i + 1, s);
		expect(readTab('c', HOUR, 4, s)).toBe(big);
		expect(readTab('a', HOUR, 4, s)).toBeUndefined();
	});

	it('leaves other saved state alone', () => {
		const s = new MemoryStorage(700);
		s.setItem('tt:v1:1:sector::s', '{"v":1,"s":{}}');
		for (let i = 0; i < 6; i++) writeTab(`k${i}`, 'x'.repeat(150), i, s);
		expect(s.getItem('tt:v1:1:sector::s')).not.toBeNull();
	});

	it('forgets by prefix', () => {
		const s = new MemoryStorage();
		writeTab('card:/api/x/1', 1, 1, s);
		writeTab('card:/api/x/2', 2, 1, s);
		writeTab('card:/api/y/1', 3, 1, s);
		forgetTab('card:/api/x', s);
		expect(readTab('card:/api/x/1', HOUR, 2, s)).toBeUndefined();
		expect(readTab('card:/api/y/1', HOUR, 2, s)).toBe(3);
	});
});
