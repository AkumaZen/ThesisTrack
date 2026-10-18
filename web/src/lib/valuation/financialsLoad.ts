// "Load missing financials": the Screener statements of scanner-universe companies nobody has opened
// yet are fetched in small batches from the page (POST /api/valuation/financials/batch), so no single
// server call runs long. Each company is one or two Screener pages with a 0.8 s gap, so a batch
// takes under half a minute, far inside the 120 s function limit.
export const FINANCIALS_BATCH_SIZE = 15;
