// Connects a page to the remembered view state in viewMemory.ts. Call trackView() once while the
// component initialises: it returns the state to start from, then keeps it saved, mirrors the
// shareable parts into the URL, and puts the scroll position back after back navigation or a
// refresh (lists fill in progressively, so it waits for the page to be tall enough).
import { afterNavigate, beforeNavigate, replaceState } from '$app/navigation';
import { page } from '$app/state';
import { onMount } from 'svelte';
import {
	defaultsOf,
	loadView,
	resetView,
	saveView,
	VIEWS,
	type FieldSpec,
	type Schema,
	type ViewName,
	type ViewState
} from '$lib/viewMemory';

export interface ViewTracker<V extends ViewName> {
	/** The state to start the page from (URL, then this tab, then lasting preferences). */
	initial: ViewState<V>;
	/** "Reset this view": forget what was saved and put the defaults back. */
	reset: () => void;
}

type Tracked<V extends ViewName> = Omit<ViewState<V>, 'scrollY'>;

const SAVE_DELAY_MS = 250;
const SCROLL_WAIT_MS = 6000;

export function trackView<V extends ViewName>(opts: {
	view: V;
	/** The signed-in person's id. Read once: a different person means a different page load. */
	userId: () => number | null | undefined;
	/** Which page of the view this is (a sector key, a symbol); changes when the page is reused. */
	scope?: () => string;
	/** The current state of everything remembered, except the scroll position. */
	read: () => Tracked<NoInfer<V>>;
	/** Puts a state back on the page: after "Reset this view", or when the scope changes. */
	apply: (state: Tracked<NoInfer<V>>) => void;
}): ViewTracker<V> {
	const { view } = opts;
	const userId = opts.userId();
	const scopeNow = () => opts.scope?.() ?? '';
	let scope = scopeNow();
	const schema = VIEWS[view] as Schema;
	const initial = loadView(view, userId, scope, page.url.searchParams);
	let scrollY = 0;
	let ready = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopRestore: (() => void) | undefined;
	let restoring = false;

	function persist() {
		clearTimeout(timer);
		timer = undefined;
		saveView(view, userId, scope, { ...opts.read(), scrollY } as Partial<ViewState<V>>);
	}

	// The URL carries the shareable parts, kept short by leaving defaults out.
	function mirrorToUrl(state: Tracked<V>) {
		const url = new URL(page.url);
		for (const [key, spec] of Object.entries(schema)) {
			const name = (spec as FieldSpec<unknown>).url;
			if (!name) continue;
			const value = (state as Record<string, unknown>)[key];
			if (value === (spec as FieldSpec<unknown>).fallback) url.searchParams.delete(name);
			else url.searchParams.set(name, String(value));
		}
		if (url.search !== page.url.search) replaceState(url.pathname + url.search + url.hash, page.state);
	}

	// Save shortly after any change (and tell the URL).
	$effect(() => {
		const state = opts.read();
		JSON.stringify(state); // read every field so the effect follows each of them
		const sc = scopeNow();
		if (!ready) return;
		if (sc !== scope) {
			// The same page component now shows another sector: start from what was saved for it.
			scope = sc;
			scrollY = 0;
			opts.apply(loadView(view, userId, sc, page.url.searchParams) as Tracked<V>);
			return;
		}
		mirrorToUrl(state);
		clearTimeout(timer);
		timer = setTimeout(persist, SAVE_DELAY_MS);
		return () => clearTimeout(timer);
	});

	function restoreScroll(target: number) {
		stopRestore?.();
		if (target <= 0) return;
		let done = false;
		restoring = true;
		const started = performance.now();
		const finish = () => {
			done = true;
			restoring = false;
			for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown'])
				window.removeEventListener(ev, finish);
		};
		stopRestore = finish;
		// Someone starting to scroll themselves always wins.
		for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown'])
			window.addEventListener(ev, finish, { passive: true, once: true });

		const step = () => {
			if (done) return;
			const room = document.documentElement.scrollHeight - window.innerHeight;
			const waited = performance.now() - started;
			if (room >= target || waited > SCROLL_WAIT_MS) {
				window.scrollTo(0, Math.min(target, Math.max(0, room)));
				scrollY = window.scrollY;
				// Cards still filling in can shift the page once more; one gentle second pass.
				setTimeout(() => {
					if (done) return;
					if (Math.abs(window.scrollY - target) > 4) window.scrollTo(0, target);
					scrollY = window.scrollY;
					finish();
				}, 700);
				return;
			}
			requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	}

	afterNavigate((nav) => {
		ready = true;
		// Back navigation and a refresh return to where the person was; opening the page from a
		// link or the menu starts at the top as usual.
		if (nav.type === 'popstate' || nav.type === 'enter') {
			scrollY = (loadView(view, userId, scope) as { scrollY: number }).scrollY;
			restoreScroll(scrollY);
		} else {
			scrollY = 0;
		}
	});

	beforeNavigate(() => {
		scrollY = Math.round(window.scrollY);
		persist();
		stopRestore?.();
	});

	onMount(() => {
		const onScroll = () => {
			// While the old position is still being restored the page is shorter than before.
			if (restoring) return;
			scrollY = Math.round(window.scrollY);
			clearTimeout(timer);
			timer = setTimeout(persist, SAVE_DELAY_MS);
		};
		const flush = () => {
			scrollY = Math.round(window.scrollY);
			persist();
		};
		const onVisibility = () => document.visibilityState === 'hidden' && flush();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('pagehide', flush);
			document.removeEventListener('visibilitychange', onVisibility);
			clearTimeout(timer);
			stopRestore?.();
		};
	});

	return {
		initial: initial as ViewState<V>,
		reset() {
			resetView(view, userId, scope);
			scrollY = 0;
			const rest = Object.fromEntries(
				Object.entries(defaultsOf(view)).filter(([key]) => key !== 'scrollY')
			);
			opts.apply(rest as unknown as Tracked<V>);
		}
	};
}
