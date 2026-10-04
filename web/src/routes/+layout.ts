// Client-rendered: the thesis pages load their data in universal load()s through $lib/api's
// plain fetch, which only carries the session cookie from the browser. Server loads
// (+page.server.ts, used by the valuation tools and the account pages) still run on the server.
export const ssr = false;
