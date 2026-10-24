// The gentle notice a guest sees when something they tried is refused (saving, live refresh...).
// Every component calls the API its own way, so instead of each one handling the guest case, the
// root layout watches responses while a guest browses: a 403 the hook marked `guest: true` raises
// this notice (lib/components/shell/GuestNotice.svelte), whichever component made the request.
import { guestRefusalMessage } from './guest';

class GuestNoticeState {
	message = $state<string | null>(null);

	show(message: string) {
		this.message = message;
	}

	dismiss() {
		this.message = null;
	}
}

export const guestNotice = new GuestNoticeState();

/** Wraps window.fetch so guest refusals raise the notice; returns the undo. Browser only. */
export function watchGuestRefusals(): () => void {
	const original = window.fetch;
	const watched: typeof fetch = async (input, init) => {
		const res = await original(input, init);
		if (res.status === 403 && res.headers.get('content-type')?.includes('application/json')) {
			res
				.clone()
				.json()
				.then((body: unknown) => {
					const message = guestRefusalMessage(res.status, body);
					if (message) guestNotice.show(message);
				})
				.catch(() => {});
		}
		return res;
	};
	window.fetch = watched;
	return () => {
		if (window.fetch === watched) window.fetch = original;
	};
}
