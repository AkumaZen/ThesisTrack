// Svelte action: runs `onVisible` once, when the element comes within a short distance of the
// screen. Cards use it to load their chart only when someone is about to see it.
export function whenVisible(node: HTMLElement, onVisible: () => void) {
	if (typeof IntersectionObserver === 'undefined') {
		onVisible();
		return {};
	}
	const observer = new IntersectionObserver(
		(entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				observer.disconnect();
				onVisible();
			}
		},
		{ rootMargin: '200px 0px' }
	);
	observer.observe(node);
	return { destroy: () => observer.disconnect() };
}
