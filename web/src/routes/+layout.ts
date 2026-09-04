// CSR only - auth is a client-side JWT/API-key in localStorage (see
// session.svelte.ts), which SSR load functions can't see. See the approved
// migration plan's "CSR, not SSR" decision.
export const ssr = false;
