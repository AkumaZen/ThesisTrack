// Connects a page to the remembered view state in viewMemory.ts. Call trackView() once while the
// component initialises: it returns the state to start from, then keeps it saved, mirrors the
// shareable parts into the URL, and puts the scroll position back after back navigation or a
// refresh, or after following a back link (lists fill in progressively, so it waits for the page
// to be tall enough). A link that changes the address on the same page (another sector, or a
// filter in the query) puts that place's state on the page.
import { afterNavigate, beforeNavigate, replaceState } from '$app/navigation';
import { page } from '$app/state';
import { onMount, untrack } from 'svelte';
import {
	defaultsOf,
	loadView,
	resetView,
	saveView,
	takeReturn,
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

	/** The state the address asks for: its parameters, and the defaults for those it leaves out. */
	function fromUrl(params: URLSearchParams): Tracked<V> {
		// With no one's saved state, loadView gives exactly that: the address over the defaults.
		const asked = loadView(view, null, '', params) as Record<string, unknown>;
		const state: Record<string, unknown> = { ...opts.read() };
		for (const [key, spec] of Object.entries(schema))
			if ((spec as FieldSpec<unknown>).url) state[key] = asked[key];
		return state as Tracked<V>;
	}
	const urlNames = Object.values(schema)
		.map((spec) => (spec as FieldSpec<unknown>).url)
		.filter((n): n is string => !!n);

	// Save shortly after any change (and tell the URL).
	$effect(() => {
		const state = opts.read();
		JSON.stringify(state); // read every field so the effect follows each of them
		// Another sector is arriving in this same component: afterNavigate puts its state on the
		// page, and nothing is saved under the old one meanwhile.
		if (!ready || scopeNow() !== scope) return;
		// Only a change of state runs this, never a change of address: during a navigation the
		// state on screen is still the old page's until afterNavigate puts the new one on.
		untrack(() => mirrorToUrl(state));
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
		const first = !ready;
		ready = true;
		const params = nav.to?.url.searchParams ?? page.url.searchParams;
		const sc = scopeNow();
		if (sc !== scope) {
			// The same page component now shows another sector: start from what was saved for it.
			scope = sc;
			opts.apply(stripScroll(loadView(view, userId, sc, params)));
		} else if (!first && nav.from?.url.search !== nav.to?.url.search) {
			// Same page, new address: what the address asks for wins. A plain link with no parameters
			// (the menu entry for the page already open) leaves the page as it is.
			if (nav.type === 'popstate' || urlNames.some((n) => params.has(n))) opts.apply(fromUrl(params));
		}
		// The address shows what is on screen from the start, so it can be copied and shared as is.
		mirrorToUrl(opts.read());
		// Back navigation, a refresh and a back link return to where the person was; opening the
		// page from any other link or the menu starts at the top as usual.
		const returning =
			nav.type === 'popstate' || nav.type === 'enter' || takeReturn(userId, page.url.pathname);
		if (returning) {
			scrollY = (loadView(view, userId, scope) as { scrollY: number }).scrollY;
			restoreScroll(scrollY);
		} else {
			scrollY = 0;
		}
	});

	function stripScroll(state: ViewState<V>): Tracked<V> {
		const rest: Record<string, unknown> = { ...state };
		delete rest.scrollY;
		return rest as Tracked<V>;
	}

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
			opts.apply(stripScroll(defaultsOf(view)));
		}
	};
}
