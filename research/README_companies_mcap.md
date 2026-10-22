# Companies with market cap above Rs 500 Cr

File: `companies_mcap_above_500cr.csv` (1,833 unique companies, sorted by market_cap_cr descending, no upper bound).
It replaces `companies_mcap_500_20000cr.csv`, which held only the 500 to 20,000 Cr band and was matched to Angel One by symbol alone.
The file is the single source for `valuation.mcap_universe`.
The whole-market breadth chart (`/valuation/breadth`) uses every row that has a price source.
The breakout scanner keeps its Rs 500 Cr to Rs 20,000 Cr band: its reads add `market_cap_cr < 20000` in `web/src/lib/valuation/server/mcapUniverseStore.ts`.

## Source and as-of date
- AMFI "Average Market Capitalization of listed companies during the six months ended 30 June 2026" (`https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx`), downloaded 2026-10-19.
- This is a **6-month average (Jan to Jun 2026), not a live market cap**.
- mcap_as_of = 2026-06-30 (period end).
- Current caps can differ materially, so companies near Rs 500 Cr may sit on the other side today.

## Method
- market_cap_cr is the simple average of the exchange caps present (BSE, NSE, MSEI), the same as AMFI's "Average of All Exchanges" column (`AVERAGE(E,G,I)` skips blanks).
- Strict filter: market_cap_cr > 500, Rs crore. No upper bound.
- 5,427 AMFI rows, 1,848 above 500 Cr, minus 8 rows with a cap only on MSEI (no NSE or BSE listing), giving 1,840 unique ISINs.
- Duplicate ISINs in the source: none.
- One company under two ISINs: Jash Engineering (INE039O01011 and INE039O01029, face value split) is kept once, under the ISIN that is on the exchange lists, INE039O01029.
- Two rows are never merged unless their normalised company names are equal, or they share an AMFI ticker and the first word of the name.
- REIT and InvIT units are not companies and are left out: 6 rows (Knowledge Realty Trust, Embassy Office Parks REIT, Bagmane Prime Office REIT, Mindspace Business Parks REIT, Brookfield India Real Estate Trust, Nexus Select Trust).
- The rule: a name with REIT, InvIT, Real Estate Trust, Infrastructure Trust or Realty Trust, an Angel NSE series suffix RR or IV, or an ISIN with unit type code 25 (characters 8-9; equity is 01). Names that merely contain Trust (Master Trust Ltd., The Investment Trust of India) are kept.
- Result: 1,833 companies.
- listed_on: Both if the company has both an NSE and a BSE cap, else NSE or BSE.

## ISIN-verified Angel One mapping
- NSE: official `EQUITY_L.csv` (`https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv`) plus the SME list (`https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv`), both with ISIN. ISIN gives the NSE symbol and series.
- BSE: the official BSE active scrip list API returns 403 to scripts, so the BSE equity bhavcopy (UDiFF, `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_<yyyymmdd>_F_0000.CSV`) is used instead. It carries ISIN, the numeric scrip code (FinInstrmId) and the ticker. Five consecutive trading days (2026-10-12 to 2026-10-16) are merged so a scrip that did not trade on one day is still found. A listed scrip that traded on none of those days would be missed.
- Angel One scrip master (`OpenAPIScripMaster.json`, downloaded 2026-10-19). It has no ISIN field, so ISIN goes through the exchange lists first.
- NSE token: Angel exch_seg NSE, `name` == NSE symbol, symbol `<name>-<series>` with series ranked EQ > BE > SM > RR/IV > BZ (the rule of `buildScripIndex` in `web/src/lib/valuation/server/angelone.ts`, kept in step by a test).
- BSE token: Angel exch_seg BSE equity row whose token equals the numeric BSE scrip code (`bse_scrip_code`).
- `price_exchange` is NSE if Angel has the NSE listing, else BSE, else blank (`No price source`).
- `match_method` is `isin` (ISIN found on an exchange list) or `symbol+name` (see below).
- Stale AMFI ISINs: 14 companies carry an ISIN in AMFI that is not on either exchange list (a post-split or post-conversion ISIN change, for example TD Power Systems INE419M01027 to INE419M01035).
  For these the AMFI ticker is looked up on the exchange list, accepted only when the company names agree (60% of name tokens, Co./Ltd. folded), and the exchange's current ISIN is stored.
  These rows have `match_method` = `symbol+name`.
- Counts (1,833 rows): priced on NSE 1,729, priced on BSE only 91, no price source 13.
- No price source (not on any exchange list under that ISIN or ticker, or no Angel token; typically merged, delisted or suspended): J.B. Chemicals & Pharmaceuticals, Gujarat State Petronet, Midwest Gold, Cigniti Technologies, LS Industries, Citurgia Biochemicals, Sanghi Industries, Avishkar Infra Realty, Haryana Financial Corporation, Pine Animation, Orissa Sponge Iron and Steel, Maagh Advertising and Marketing Services, Maa Jagdambe Tradelinks.

## Rebuilding the file
- Download the five inputs above into a scratch folder outside the repo (raw downloads are not committed).
- Run from `web/`: `node scripts/build-mcap-universe.mjs --amfi <xlsx> --angel <scrip master json> --nse <EQUITY_L.csv> --nse-sme <SME_EQUITY_L.csv> --bse <bhavcopy> [--bse <more days>] --out ../research/companies_mcap_above_500cr.csv`.
- The script prints the counts, the dropped duplicates, the ISIN replacements and the unmatched companies.
- Then load it: `DATABASE_URL=... node scripts/import-mcap-universe.mjs <csv>` (dry run), and again with `--apply`.

## Caveats
- `bse_code` holds the BSE ticker (Angel's BSE symbol when matched); the numeric scrip code is in `bse_scrip_code`.
- Company names are as spelled by AMFI.
- AMFI covers companies listed for the full period; very recent listings may be missing or hold a partial-period average.
- Survivorship and look-ahead: breadth uses today's list for every past day, so companies that delisted, merged or fell below Rs 500 Cr are absent from history, and companies that grew past Rs 500 Cr count before they qualified.
- Ticker clashes: two active companies cannot share a symbol in `mcap_universe`, so a loser would lose its symbol (none in this file).
