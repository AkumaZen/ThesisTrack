// @ts-nocheck - plain JS shared with the import script (node cannot run .ts); typed by its tests.
// Merges a sector taxonomy file (research/sector_taxonomy_v2.json) into the stored sector majors and
// baskets (valuation.sector_majors / sector_baskets). ADD-ONLY: it creates, renames labels, adds
// symbols and attaches baskets to majors, but never removes a symbol, basket or major that the file
// does not mention - those are reported as "kept". Exceptions: the optional top-level "retired" list of
// basket keys (removed, and detached from every major), and replace mode (see planMerge). Pure functions, no I/O, no imports, so
// scripts/import-sector-taxonomy.mjs and the unit tests share one copy (same pattern as mcapUniverse.js).

// Same shapes as sectorEdit.ts (asserted equal by sectorTaxonomyMerge.test.ts).
const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&-]{0,29}$/;

/** @typedef {{ key: string, label: string, symbols: string[] }} Basket */
/** @typedef {{ key: string, label: string, position: number, subsectorKeys: string[] }} Major */
/** @typedef {{
 *   newMajors: { key: string, label: string, position: number }[],
 *   renamedMajors: { key: string, from: string, to: string }[],
 *   movedMajors: { key: string, from: number, to: number }[],
 *   newBaskets: Basket[],
 *   renamedBaskets: { key: string, from: string, to: string }[],
 *   symbolsAdded: { key: string, symbols: string[] }[],
 *   attached: { key: string, baskets: string[] }[],
 *   skippedBaskets: { key: string, label: string }[],
 *   skippedSymbols: string[],
 *   keptMajors: string[],
 *   keptBaskets: string[],
 *   keptSymbols: { key: string, symbols: string[] }[],
 *   retired: { key: string, label: string, count: number }[],
 *   unknownRetired: string[],
 *   emptiedMajors: string[],
 *   symbolsRemoved: { key: string, symbols: string[] }[],
 *   orphaned: { key: string, symbol: string }[],
 *   orphansDropped: { key: string, symbol: string }[],
 *   detached: { key: string, baskets: string[] }[],
 *   deletedMajors: { key: string, label: string, baskets: string[] }[],
 *   majorDeletes: string[],
 *   unclaimedKept: { key: string, baskets: string[] }[],
 *   basketDeletes: string[],
 *   majorWrites: Major[],
 *   basketWrites: Basket[],
 *   empty: boolean
 * }} Plan */
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

/** Validates the file and returns normalised majors (upper-case symbols, de-duplicated within a
 *  basket) or every problem found. A basket key may appear only once in the whole file. */
export function parseTaxonomyFile(raw) {
	const errors = [];
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return { majors: [], retired: [], errors: ['The file must contain one JSON object.'] };
	}
	if (raw.version !== 2) errors.push(`"version" must be 2 (got ${JSON.stringify(raw.version)}).`);
	if (!Array.isArray(raw.majors) || raw.majors.length === 0) {
		return { majors: [], retired: [], errors: [...errors, '"majors" must be a non-empty array.'] };
	}

	const majorKeys = new Set();
	const basketKeys = new Set();
	const majors = [];
	raw.majors.forEach((m, i) => {
		const where = `majors[${i}]`;
		if (typeof m !== 'object' || m === null || Array.isArray(m)) {
			errors.push(`${where} must be an object.`);
			return;
		}
		if (!isText(m.key) || !KEY_RE.test(m.key)) errors.push(`${where}: invalid key ${JSON.stringify(m.key)}.`);
		else if (majorKeys.has(m.key)) errors.push(`${where}: duplicate major key "${m.key}".`);
		else majorKeys.add(m.key);
		if (!isText(m.label)) errors.push(`${where}: missing label.`);
		if (!Array.isArray(m.baskets) || m.baskets.length === 0) {
			errors.push(`${where} ("${m.key}"): "baskets" must be a non-empty array.`);
			return;
		}
		const baskets = [];
		m.baskets.forEach((b, j) => {
			const bw = `${where}.baskets[${j}]`;
			if (typeof b !== 'object' || b === null || Array.isArray(b)) {
				errors.push(`${bw} must be an object.`);
				return;
			}
			if (!isText(b.key) || !KEY_RE.test(b.key)) errors.push(`${bw}: invalid key ${JSON.stringify(b.key)}.`);
			else if (basketKeys.has(b.key)) errors.push(`${bw}: duplicate basket key "${b.key}".`);
			else basketKeys.add(b.key);
			if (!isText(b.label)) errors.push(`${bw}: missing label.`);
			if (!Array.isArray(b.symbols) || b.symbols.length === 0) {
				errors.push(`${bw} ("${b.key}"): "symbols" must be a non-empty array.`);
				return;
			}
			const symbols = [];
			for (const s of b.symbols) {
				const sym = typeof s === 'string' ? s.trim().toUpperCase() : '';
				if (!SYMBOL_RE.test(sym)) errors.push(`${bw} ("${b.key}"): invalid symbol ${JSON.stringify(s)}.`);
				else if (!symbols.includes(sym)) symbols.push(sym);
			}
			for (const p of Array.isArray(b.primary) ? b.primary : []) {
				if (!symbols.includes(String(p).trim().toUpperCase())) {
					errors.push(`${bw} ("${b.key}"): primary symbol ${JSON.stringify(p)} is not in its symbols.`);
				}
			}
			baskets.push({ key: b.key, label: isText(b.label) ? b.label.trim() : '', symbols });
		});
		majors.push({ key: m.key, label: isText(m.label) ? m.label.trim() : '', baskets });
	});
	const retired = [];
	if (raw.retired !== undefined && !Array.isArray(raw.retired)) errors.push('"retired" must be an array of basket keys.');
	for (const k of Array.isArray(raw.retired) ? raw.retired : []) {
		if (!isText(k) || !KEY_RE.test(k)) errors.push(`retired: invalid key ${JSON.stringify(k)}.`);
		else if (basketKeys.has(k)) errors.push(`retired key "${k}" is also a basket in the file.`);
		else if (!retired.includes(k)) retired.push(k);
	}
	return { majors, retired, errors };
}

/** Every distinct symbol in the parsed file, in file order. */
export function fileSymbols(majors) {
	return [...new Set(majors.flatMap((m) => m.baskets.flatMap((b) => b.symbols)))];
}

/** Names Angel One can price, mirroring buildScripIndex in server/angelone.ts: an NSE row with a
 *  series suffix we can read (EQ, BE, SM, RR, IV, BZ), or a BSE equity row for names with no NSE
 *  listing. The refresh jobs look a symbol up by exactly this name. */
export function pricedNames(scripEntries) {
	const series = new Set(['EQ', 'BE', 'SM', 'RR', 'IV', 'BZ']);
	const names = new Set();
	for (const e of scripEntries) {
		if (e.exch_seg === 'NSE' && e.symbol.includes('-') && series.has(e.symbol.split('-').pop())) {
			names.add(e.name.toUpperCase());
		}
	}
	for (const e of scripEntries) {
		if (e.exch_seg === 'BSE' && !e.symbol.includes('-') && !e.instrumenttype && e.symbol === e.name) {
			names.add(e.name.toUpperCase());
		}
	}
	return names;
}

/**
 * current: { majors: [{key,label,position,subsectorKeys}], baskets: [{key,label,symbols}] }
 * majors: the parsed file (parseTaxonomyFile).
 * skipSymbols: symbols not to ADD (unpriced ones); a symbol already stored is never touched.
 * retired: basket keys to delete; they are also removed from every major's subsectorKeys. Keys not
 * stored are listed in `unknownRetired` (not an error, so a re-run stays clean).
 * opts.replace: the file is authoritative for the baskets and majors it lists (default is add-only).
 *   - a listed basket gets exactly the file's symbols (`symbolsRemoved`); a symbol that would then sit
 *     in no basket at all is `orphaned` and stays in the basket it was removed from, unless
 *     `opts.universe` (a Set of upper-case tickers) is given and does not contain it: then it is
 *     dropped and listed in `orphansDropped`;
 *   - a listed major gets exactly the file's baskets; a major not in the file is deleted when every
 *     basket it still holds is claimed by a file major (`deletedMajors`), else it is kept and its
 *     unclaimed baskets are listed (`unclaimedKept`).
 *
 * Returns the diff for printing plus `majorWrites` / `basketWrites` (full target rows, only for rows
 * that change). An already-merged database yields `empty: true`.
 * @returns {Plan}
 */
export function planMerge(current, majors, skipSymbols = new Set(), retired = [], opts = {}) {
	const replace = opts.replace === true;
	const dbMajors = new Map(current.majors.map((m) => [m.key, m]));
	const dbBaskets = new Map(current.baskets.map((b) => [b.key, b]));
	/** @type {Plan} */
	const plan = {
		newMajors: [],
		renamedMajors: [],
		movedMajors: [],
		newBaskets: [],
		renamedBaskets: [],
		symbolsAdded: [],
		attached: [],
		skippedBaskets: [],
		skippedSymbols: [],
		keptMajors: [],
		keptBaskets: [],
		keptSymbols: [],
		retired: [],
		unknownRetired: [],
		emptiedMajors: [],
		basketDeletes: [],
		symbolsRemoved: [],
		orphaned: [],
		orphansDropped: [],
		detached: [],
		deletedMajors: [],
		majorDeletes: [],
		unclaimedKept: [],
		majorWrites: [],
		basketWrites: [],
		empty: false
	};

	const fileMajorKeys = new Set(majors.map((m) => m.key));
	const fileBasketKeys = new Set(majors.flatMap((m) => m.baskets.map((b) => b.key)));
	const skipped = new Set();
	const retiredSet = new Set();
	for (const key of retired) {
		const row = dbBaskets.get(key);
		if (!row) plan.unknownRetired.push(key);
		else {
			retiredSet.add(key);
			plan.retired.push({ key, label: row.label, count: row.symbols.length });
			plan.basketDeletes.push(key);
		}
	}

	// Baskets first, so majors can tell which ones will exist.
	const willExist = new Set([...dbBaskets.keys()].filter((k) => !retiredSet.has(k)));
	/** Existing file baskets, resolved after the orphan check: target symbols and what the file drops. */
	const existing = [];
	for (const m of majors) {
		for (const b of m.baskets) {
			const row = dbBaskets.get(b.key);
			const wanted = b.symbols.filter((s) => !skipSymbols.has(s) || row?.symbols.includes(s));
			for (const s of b.symbols) if (!wanted.includes(s)) skipped.add(s);
			if (!row) {
				if (wanted.length === 0) {
					plan.skippedBaskets.push({ key: b.key, label: b.label });
					continue;
				}
				plan.newBaskets.push({ key: b.key, label: b.label, symbols: wanted });
				plan.basketWrites.push({ key: b.key, label: b.label, symbols: wanted });
				willExist.add(b.key);
				continue;
			}
			const dropped = row.symbols.filter((s) => !b.symbols.includes(s));
			const added = wanted.filter((s) => !row.symbols.includes(s));
			existing.push({
				row,
				label: b.label,
				added,
				dropped,
				target: replace ? [...wanted] : [...row.symbols, ...added]
			});
		}
	}
	plan.skippedSymbols = [...skipped];

	if (replace) {
		// Every symbol that will still be somewhere once the file is applied.
		const final = new Set();
		for (const b of plan.newBaskets) for (const s of b.symbols) final.add(s);
		for (const e of existing) for (const s of e.target) final.add(s);
		for (const b of current.baskets) {
			if (!fileBasketKeys.has(b.key) && !retiredSet.has(b.key)) for (const s of b.symbols) final.add(s);
		}
		for (const e of existing) {
			e.removed = [];
			for (const s of e.dropped) {
				if (final.has(s)) e.removed.push(s);
				else if (opts.universe && !opts.universe.has(s)) {
					e.removed.push(s);
					plan.orphansDropped.push({ key: e.row.key, symbol: s });
				} else {
					final.add(s);
					e.target.push(s);
					plan.orphaned.push({ key: e.row.key, symbol: s });
				}
			}
		}
	}

	for (const e of existing) {
		const { row, label, target } = e;
		const same = row.symbols.length === target.length && row.symbols.every((s, i) => s === target[i]);
		const added = target.filter((s) => !row.symbols.includes(s));
		if (!replace && e.dropped.length > 0) plan.keptSymbols.push({ key: row.key, symbols: e.dropped });
		if (replace && e.removed.length > 0) plan.symbolsRemoved.push({ key: row.key, symbols: e.removed });
		if (row.label !== label) plan.renamedBaskets.push({ key: row.key, from: row.label, to: label });
		if (added.length > 0) plan.symbolsAdded.push({ key: row.key, symbols: added });
		if (row.label !== label || !same) plan.basketWrites.push({ key: row.key, label, symbols: target });
	}
	for (const b of current.baskets) {
		if (!fileBasketKeys.has(b.key) && !retiredSet.has(b.key)) plan.keptBaskets.push(b.key);
	}

	// Which baskets the file's majors hold, for the "is a major still needed" decision.
	const claimed = new Set();
	for (const m of majors) for (const b of m.baskets) if (willExist.has(b.key)) claimed.add(b.key);

	// Majors not in the file: deleted (replace mode) when everything they hold is claimed elsewhere.
	const notInFile = current.majors.filter((m) => !fileMajorKeys.has(m.key));
	const keptMajors = [];
	for (const m of notInFile) {
		const base = m.subsectorKeys.filter((k) => !retiredSet.has(k));
		if (replace && base.length > 0 && base.every((k) => claimed.has(k))) {
			plan.deletedMajors.push({ key: m.key, label: m.label, baskets: base });
			plan.majorDeletes.push(m.key);
			continue;
		}
		if (replace) {
			const unclaimed = base.filter((k) => !claimed.has(k));
			if (unclaimed.length > 0) plan.unclaimedKept.push({ key: m.key, baskets: unclaimed });
		}
		keptMajors.push(m);
	}

	// Majors: file order first, then the majors not in the file keep their relative order after them.
	keptMajors.sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
	plan.keptMajors = keptMajors.map((m) => m.key);
	const positions = new Map();
	majors.forEach((m, i) => positions.set(m.key, i));
	keptMajors.forEach((m, i) => positions.set(m.key, majors.length + i));

	for (const m of majors) {
		const row = dbMajors.get(m.key);
		const position = positions.get(m.key);
		const wantedKeys = m.baskets.map((b) => b.key).filter((k) => willExist.has(k));
		if (!row) {
			plan.newMajors.push({ key: m.key, label: m.label, position });
			plan.majorWrites.push({ key: m.key, label: m.label, position, subsectorKeys: wantedKeys });
			plan.attached.push({ key: m.key, baskets: wantedKeys });
			continue;
		}
		const base = row.subsectorKeys.filter((k) => !retiredSet.has(k));
		const retiredHere = base.length !== row.subsectorKeys.length;
		const addedKeys = wantedKeys.filter((k) => !base.includes(k));
		const target = replace ? wantedKeys : [...base, ...addedKeys];
		const detached = replace ? base.filter((k) => !wantedKeys.includes(k)) : [];
		const sameKeys = row.subsectorKeys.length === target.length && row.subsectorKeys.every((k, i) => k === target[i]);
		if (retiredHere && target.length === 0) plan.emptiedMajors.push(m.key);
		if (row.label !== m.label) plan.renamedMajors.push({ key: m.key, from: row.label, to: m.label });
		if (row.position !== position) plan.movedMajors.push({ key: m.key, from: row.position, to: position });
		if (addedKeys.length > 0) plan.attached.push({ key: m.key, baskets: addedKeys });
		if (detached.length > 0) plan.detached.push({ key: m.key, baskets: detached });
		if (row.label !== m.label || row.position !== position || !sameKeys) {
			plan.majorWrites.push({ key: m.key, label: m.label, position, subsectorKeys: target });
		}
	}
	// Kept majors only change when the file pushes them down the list or a retired basket leaves them.
	for (const m of keptMajors) {
		const position = positions.get(m.key);
		const base = m.subsectorKeys.filter((k) => !retiredSet.has(k));
		const retiredHere = base.length !== m.subsectorKeys.length;
		if (retiredHere && base.length === 0) plan.emptiedMajors.push(m.key);
		if (m.position !== position) plan.movedMajors.push({ key: m.key, from: m.position, to: position });
		if (m.position !== position || retiredHere) {
			plan.majorWrites.push({ key: m.key, label: m.label, position, subsectorKeys: base });
		}
	}

	plan.empty =
		plan.majorWrites.length === 0 &&
		plan.basketWrites.length === 0 &&
		plan.basketDeletes.length === 0 &&
		plan.majorDeletes.length === 0;
	return plan;
}