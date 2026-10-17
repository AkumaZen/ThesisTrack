# Companies with market cap Rs 500 Cr to Rs 20,000 Cr

File: `companies_mcap_500_20000cr.csv` (1,496 unique companies, sorted by market_cap_cr descending).

## Source and as-of date
- AMFI "Average Market Capitalization of listed companies during the six months ended 30 June 2026"
  (`https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx`), downloaded 2026-10-17.
- This is a **6-month average (Jan to Jun 2026), not a live market cap**. mcap_as_of = 2026-06-30 (period end).
  Current caps can differ materially, so companies near either boundary may sit on the other side today.

## Method
- market_cap_cr = simple average of the exchange caps present (BSE, NSE, MSEI), computed the same way as AMFI's
  "Average of All Exchanges" column (its formula is `AVERAGE(E,G,I)`, which skips blanks). Strict filter 500 < mcap < 20000, Rs crore.
- Deduplicated by ISIN (no duplicate ISINs in the source; verified none in output).
- listed_on: Both if the company has both an NSE and a BSE symbol with an mcap, else NSE or BSE.

## Counts
Total 1,496. Both 1,249, BSE only 213, NSE only 34.

## Caveats
- `bse_code` holds the **BSE symbol/ID text** (as in AMFI's "BSE Symbol" column, often equal to the NSE symbol), not the numeric 6-digit scrip code. NSE/BSE list downloads were not used to map numeric codes.
- 8 in-range source rows with an mcap only on MSEI (no NSE/BSE symbol) were excluded.
- AMFI covers companies listed for the full period; very recent listings (after the period) or newly listed IPOs may be missing or have a partial-period average.
- Company names are as spelled by AMFI. No cross-check against Screener was performed.

## Angel One instrument mapping
- Source: Angel One SmartAPI scrip master (`https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json`), downloaded 2026-10-17 (153,484 instruments).
- The scrip master has **no ISIN field** (keys: token, symbol, name, expiry, strike, lotsize, instrumenttype, exch_seg, tick_size, freeze_qty, is_cas_enabled), so matching is by symbol only (`match_method` = symbol, or none).
- NSE: exch_seg NSE, `name` == nse_symbol, symbol `<name>-<series>` with series ranked EQ > BE > SM > RR/IV > BZ (same rule as `buildScripIndex` in `web/src/lib/valuation/server/angelone.ts`).
- BSE: exch_seg BSE, `symbol` == `name` == BSE ticker, no suffix, no instrumenttype. The BSE token is the numeric BSE scrip code, copied to `bse_scrip_code`.
- `price_exchange` is NSE if an NSE match exists, else BSE, else blank. `price_source_status` is `matched` or `No price source`.
- Counts (1,496 rows): price_exchange NSE 1,281 (1,246 of them also have a BSE match), BSE-only 201, No price source 14.
- Caveat: symbol matching can miss tickers AMFI spells differently from Angel One (e.g. HEG, GSPL, Cigniti, Sanghi Industries are absent from the scrip master under those symbols). Matches are not ISIN-verified.
