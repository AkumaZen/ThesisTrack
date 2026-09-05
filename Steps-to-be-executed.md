# These are the steps which are to be executed after current changes are done by the claude agent 

Run Multiple Agents to solve this quickly and parallely 
Autocompact on 50% 

Stop when reached 90% token usage

## Plan 1
    You are an expert SvelteKit performance engineer. Analyze our existing SvelteKit project and implement granular per-route rendering, preloading, and data-fetching optimizations to maximize TTFB, eliminate navigation latency, and reduce server load.

    ### Context & Constraints
    - SvelteKit serves both the frontend and backend (`+page.server.ts`, `+server.ts`, server hooks, actions).
    - Do not rewrite business logic or break existing auth/database queries.
    - Apply SvelteKit page options (`prerender`, `ssr`, `csr`) selectively per route rather than globally.

    ---

    ### Step 1: Route Inventory & Classification Audit
    Scan `src/routes/` and inspect every route (`+page.svelte`, `+page.server.ts`, `+layout.server.ts`). Group all routes into one of three rendering tiers:

    1. **Tier 1: Prerendered Static (SSG)**
    - *Target:* Public-facing marketing pages, landing pages, documentation, terms, privacy policies, blogs without session-dependent state.
    - *Action:* Add `export const prerender = true;` in `+page.ts` or `+page.server.ts`.
    - *Action:* If the page has zero client-side interactivity (no forms, modals, or animations), add `export const csr = false;` to strip client JS entirely.

    2. **Tier 2: Hybrid SSR + Client Navigation (Transitional Pages)**
    - *Target:* Personalized pages needing SEO, initial data from DB (e.g., dynamic public profiles, e-commerce listings, localized feeds).
    - *Action:* Retain default `ssr = true` and `csr = true`.
    - *Action (Streaming):* Inspect `load` functions. If multiple DB queries exist, do NOT `await` non-critical queries. Return the raw promises from `load` and handle them with `{#await}` in `+page.svelte` so the initial HTML shell streams immediately.

    3. **Tier 3: Client-Heavy Internal Apps / Dashboards (SPA-style subtrees)**
    - *Target:* Deeply authenticated portals, admin consoles, or complex real-time canvas/tool views where SEO is irrelevant and client interactivity is continuous.
    - *Action:* If server rendering an internal route tree causes heavy database load on every reload, configure `export const ssr = false;` in the subtree's `+layout.ts` while keeping server API calls in endpoints or server actions.

    ---

    ### Step 2: Instant Navigation & Preloading
    1. Open `src/app.html` (or your root `+layout.svelte`).
    2. Verify that `<body data-sveltekit-preload-data="hover">` (or `"tap"` for mobile-heavy views) is set. This initiates data fetching the moment a user hovers over an internal link, making page transitions feel instantaneous.
    3. For mission-critical high-frequency links, explicit `data-sveltekit-preload-code="eager"` should be added.

    ---

    ### Step 3: Server Load Function & Cache Auditing
    1. Audit all `+page.server.ts` and `+layout.server.ts` files:
    - Replace sequential database calls (`await db1; await db2;`) with `Promise.all([...])`.
    - On public/semi-static dynamic routes, inject HTTP cache headers using the `setHeaders` event parameter:
        ```ts
        setHeaders({
        'cache-control': 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400'
        });
        ```
    - Ensure root `+layout.server.ts` only fetches universal session/auth state and does not run expensive DB queries that block child routes unnecessarily.

    ---

    ### Step 4: Verification & Execution
    1. Propose the classification table for all routes first: Route Path | Selected Strategy | Rationale.
    2. Once verified, implement the route options (`+page.ts` / `+page.server.ts`) and load optimizations.
    3. Run `npm run check` and `npm run build` to confirm there are no prerendering crawl failures or hydration errors.

# After implementing the Plan 1 and testing it implement Plan 2 

## Plan 2 

I want you refine the exisiting company data stored of balu forge as the data stored is very less and Thesis looks very weak and There are no proper tables with comparison and understanding , I want you to refer this report @Blufrg.pdf by nauvama to build the thesis properly without information loss and as much as understanding 

## Plan 3 

I want you import and add data for Inox Green Energy Services Limited Properly with text, tables and understanding 

Below is the data for inox green 

{
"company_id": "INOXGREEN",
"name": "Inox Green Energy Services Limited",
"classification": {
"broad_industry": "Utilities & Renewable Energy",
"specific_niche": "Renewable Energy Operations and Maintenance (O&M) Pure-Play",
"operating_model": "services",
"currency": "INR"
},
"status": "watch_closely",
"last_reviewed": "2026-09-05",
"thesis_data": {
"the_business": {
"what_it_does": "India's only listed pure-play renewable energy operations and maintenance (O&M) service provider. The company delivers comprehensive long-term (5 to 20 years) O&M solutions for wind turbine generators (WTGs), solar assets, and common infrastructure. It is expanding into high-margin specialized value-added services (VAS) including major component overhauls (at 8, 10, or 15-year intervals) and engineering life-extension programs extending operational turbine life from standard 25 years up to 35 years.",
"revenue_split": [
{
"segment": "Wind Turbine Generator (WTG) Long-Term O&M Contracts",
"share_pct": 65
},
{
"segment": "Value-Added Services (VAS), Overhauls & Life Extension",
"share_pct": 20
},
{
"segment": "Solar Portfolio O&M & Common Infrastructure Services",
"share_pct": 15
}
]
},
"the_growth_engine": [
"Inorganic Fleet Consolidation: Acquisition and pending line-by-line financial consolidation of ~6.5 GW operational wind assets, including 4.5 GW from Wind World India Limited (WWIL) and ~2.0 GW from a second target portfolio, scaling total renewable AUM to 13.3 GW peak (10.5 GW Wind, 2.8 GW Solar).",
"Captive Group Pipeline: 100% of long-term O&M contracts from sister entity INOX Clean Energy's planned 3 GW+ annual renewable IPP additions flow automatically to INOX Green on an arm's-length basis without customer acquisition friction.",
"Embedded Contract Escalations: Long-term utility and C&I O&M contracts (including WWIL's ~INR 580 Cr revenue base) feature built-in annual price escalation clauses of ~5%.",
"VAS Commercialization: Unbundling and discrete fee-invoicing for turbine life extension (from 25 to 35 years) and major multi-year component overhauls, converting historical cost-absorption into high-margin revenue.",
"Multivendor Fleet Diversification: WWIL integration diversifies the company beyond captive Inox Wind equipment into servicing third-party Enercon-technology turbines for marquee IPPs (Tata, ReNew, Greenko, Apraava, Hindustan Zinc)."
],
"the_big_change": {
"summary": "Transformation into an asset-light, pure-play renewable O&M platform via the demerger of the capital-intensive power evacuation infrastructure into INOX Renewable Solutions Limited (IRSL / RESCO) with an August 1, 2026 record date, coupled with NCLT Ahmedabad approval to acquire and consolidate 4.5 GW WWIL assets, shifting accounting classification from Ind AS 109 balance-sheet investments to line-by-line P&L consolidation starting Q3 FY27.",
"expected_completion": "Q3 FY27 to Q4 FY27"
},
"proof_points": {
"hard_evidence": [
"Hon'ble NCLT Ahmedabad bench formally approved the acquisition of Wind World India Limited (WWIL), with resolution closing formalities scheduled to complete in Q2 FY27.",
"Demerger of capital-heavy power evacuation business into IRSL concluded with record date of August 1, 2026; listing process expected within 2-3 months.",
"Maintained robust machine availability rate of 96.3% across the operational fleet in Q1 FY27.",
"WWIL portfolio audited revenue stood at ~INR 580 Cr in FY26 with ~5% annual price escalation clauses.",
"Inox Wind signed a 1.5 GW MoU with INOX Clean Energy (500 MW firm orders executed) guaranteeing downstream captive O&M inflows.",
"Q1 FY27 EBITDA reached INR 57 Cr (+19% YoY) and PAT reached INR 41 Cr (+86% YoY), while total borrowings reduced to INR 88 Cr."
],
"model_specific_metrics": {
"total_managed_aum_gw": 13.3,
"active_consolidated_fleet_gw": 4.0,
"pending_consolidation_mna_gw": 6.5,
"solar_managed_aum_gw": 2.8,
"machine_availability_pct": 96.3,
"legacy_realization_per_mw_inr_lakh": "9-10",
"contracted_annual_escalation_pct": 5.0,
"sustainable_ebitda_margin_target_pct": 50.0,
"annualized_ebitda_run_rate_guidance_inr_cr": 600.0,
"q1_fy27_reported_ebitda_inr_cr": 57.0,
"q1_fy27_other_income_inr_cr": 57.9,
"debtor_days_mar_2026": 216
}
},
"what_can_kill_it": [
{
"label": "Failure or Extended Delay in Closing WWIL Acquisition & Share Transfer",
"metric_key": "wwil_consolidation_status",
"operator": "==",
"threshold": "failed_or_delayed_beyond_q3",
"action": "Exit position immediately as the core step-up to ~INR 600 Cr EBITDA collapses",
"severity": "kill",
"grace_periods": 1,
"manual_check": true
},
{
"label": "Persistent Guidance Slippage and Execution Lag in H2 Delivery",
"metric_key": "quarterly_ebitda_h2_inr_cr",
"operator": "<",
"threshold": "100.0",
"action": "Liquidate position due to promoter track record discount and repeated guidance misses",
"severity": "kill",
"grace_periods": 1,
"manual_check": true
},
{
"label": "Severe Margin Degradation on Aging Acquired WWIL Fleet",
"metric_key": "ebitda_margin_pct",
"operator": "<",
"threshold": "35.0",
"action": "Downgrade target EV multiple from 25x to 15x and derisk position",
"severity": "watch",
"grace_periods": 2,
"manual_check": true
},
{
"label": "Working Capital Bloat and Cash Trapping in High Debtor Days",
"metric_key": "debtor_days",
"operator": ">",
"threshold": "280",
"action": "Evaluate CFO/EBITDA ratio and audit related-party dues from Inox Clean",
"severity": "watch",
"grace_periods": 2,
"manual_check": true
}
],
"why_we_believe_it": [
"Premise: INOX Green has secured NCLT Ahmedabad approval for the 4.5 GW WWIL acquisition and completed the demerger of its capital-intensive power evacuation business on August 1, 2026, transitioning to a high-ROCE, debt-light services pure-play.",
"Premise: WWIL's standalone revenue base (~INR 580 Cr in FY26), higher vintage realization rates (>INR 10 lakh/MW), 5% contractual escalations, and unbundled VAS billing will add ~INR 300 Cr of high-margin EBITDA upon line-by-line consolidation starting Q3 FY27.",
"Premise: Captive group demand from INOX Clean Energy (3 GW+ annual IPP installations) and Inox Wind's 4.4 GW order backlog provide locked-in volume growth without customer acquisition costs or competitive tender pressure.",
"Conclusion: Once line-by-line accounting consolidation takes effect in Q3/Q4 FY27, reported quarterly EBITDA will step up from INR 57 Cr to ~INR 150 Cr (~INR 600 Cr annualized exit run-rate), driving an institutional re-rating toward INR 247 to INR 410 per share across 20x to 41.2x EV/EBITDA valuation multiples."
],
"health_check": {
"latest_quarter_review": "Q1 FY27 core operating revenue stood at INR 43.3 Cr (impacted by pre-consolidation accounting where 6.5 GW is held under Ind AS 109) with reported EBITDA of INR 57.0 Cr (predominantly composed of INR 57.9 Cr in other operating and treasury income). Machine availability stood high at 96.3%. Standalone balance-sheet debt reduced to INR 88 Cr. Management reiterated confidence in delivering the INR 600 Cr annualized exit run-rate starting Q3/Q4 FY27 following WWIL share transfer closing.",
"historical_checks": [
{
"period": "Q4 FY26",
"observation": "Reported sales of INR 69 Cr and EBITDA of INR 50 Cr; deferred group revenue slated for FY27 realization."
},
{
"period": "FY26 Full Year",
"observation": "Consolidated sales reached INR 281 Cr; Net profit surged to INR 103 Cr; ROCE expanded to 8.42%; WWIL resolution plan submitted under NCLT."
}
]
},
"references": [
{
"title": "Inox Wind & Inox Green Q1 FY27 Earnings Conference Call Transcript (August 7, 2026)",
"url": "[https://www.bseindia.com/xml-data/corpfiling/AttachHis/b6e67209-23ee-48ab-a89f-2239295d4431.pdf](https://www.bseindia.com/xml-data/corpfiling/AttachHis/b6e67209-23ee-48ab-a89f-2239295d4431.pdf)"
},
{
"title": "Screener Consolidated Financial Profile - Inox Green Energy Services Ltd",
"url": "[https://www.screener.in/company/INOXGREEN/consolidated/#ratios](https://www.screener.in/company/INOXGREEN/consolidated/#ratios)"
}
],
"pillar_notes": {
"accounting_transition": "Moving from Ind AS 109 (investments) to Ind AS 110 (line-by-line consolidation) upon WWIL share transfer in Q2/Q3 FY27.",
"demerger_listing": "IRSL (power evacuation infrastructure) independent exchange listing targeted within 2 to 3 months of August 1, 2026 record date.",
"vas_monetization": "Major turbine overhauls and 10-year life extension (25 to 35 years) shifting from cost absorption to unbundled fee contracts."
}
},
"custom_sections": [
{
"name": "Valuation Sensitivity Matrix (Assumed FY27 EBITDA = INR 400 Cr)",
"columns": [
{ "key": "multiple", "label": "EV Multiple (x)", "type": "number" },
{ "key": "scenario", "label": "Valuation Scenario / Rationale", "type": "text" },
{ "key": "target_ev", "label": "Target EV (INR Cr)", "type": "number" },
{ "key": "price_zero_debt", "label": "Target Price [Net Debt=0] (INR)", "type": "number" },
{ "key": "upside_zero_debt", "label": "Upside vs CMP 175.10 [Net Debt=0] (%)", "type": "number" },
{ "key": "price_with_debt", "label": "Target Price [Debt=88Cr] (INR)", "type": "number" },
{ "key": "upside_with_debt", "label": "Upside vs CMP 175.10 [Debt=88Cr] (%)", "type": "number" }
],
"rows": [
{
"multiple": 15.0,
"scenario": "Severe Multiple Derating / Execution Friction",
"target_ev": 6000,
"price_zero_debt": 149.4,
"upside_zero_debt": -14.7,
"price_with_debt": 147.2,
"upside_with_debt": -15.9
},
{
"multiple": 20.0,
"scenario": "Mature Renewable Utility / Capital Goods Peer Average",
"target_ev": 8000,
"price_zero_debt": 199.3,
"upside_zero_debt": 13.8,
"price_with_debt": 197.1,
"upside_with_debt": 12.5
},
{
"multiple": 25.0,
"scenario": "Asset-Light Growth Re-Rating (Base Case)",
"target_ev": 10000,
"price_zero_debt": 249.1,
"upside_zero_debt": 42.2,
"price_with_debt": 246.9,
"upside_with_debt": 41.0
},
{
"multiple": 30.0,
"scenario": "Clean Line-by-Line P&L Consolidation Premium",
"target_ev": 12000,
"price_zero_debt": 298.9,
"upside_zero_debt": 70.7,
"price_with_debt": 296.7,
"upside_with_debt": 69.4
},
{
"multiple": 35.0,
"scenario": "High Scarcity Premium / Captive Order Expansion",
"target_ev": 14000,
"price_zero_debt": 348.7,
"upside_zero_debt": 99.1,
"price_with_debt": 346.5,
"upside_with_debt": 97.9
},
{
"multiple": 41.2,
"scenario": "INOX Green Historical Screener Median Multiple",
"target_ev": 16480,
"price_zero_debt": 410.5,
"upside_zero_debt": 134.4,
"price_with_debt": 408.3,
"upside_with_debt": 133.2
}
]
},
{
"name": "EBITDA Bridge Architecture & Quarterly Run-Rate Ramp",
"columns": [
{ "key": "portfolio_segment", "label": "Portfolio Segment", "type": "text" },
{ "key": "capacity", "label": "Capacity (GW)", "type": "text" },
{ "key": "accounting_status", "label": "Accounting Status", "type": "text" },
{ "key": "annual_revenue", "label": "Est. Annual Revenue (INR Cr)", "type": "text" },
{ "key": "annual_ebitda", "label": "Est. Annual EBITDA (INR Cr)", "type": "text" },
{ "key": "quarterly_run_rate", "label": "Quarterly Run-Rate (INR Cr)", "type": "text" }
],
"rows": [
{
"portfolio_segment": "Legacy Inox Wind Fleet",
"capacity": "~4.0 GW",
"accounting_status": "Active Line-by-Line Consolidation",
"annual_revenue": "INR 380 - 400 Cr",
"annual_ebitda": "INR 190 - 200 Cr",
"quarterly_run_rate": "~INR 50 - 57 Cr/qtr"
},
{
"portfolio_segment": "Wind World India Limited (WWIL)",
"capacity": "~4.5 GW",
"accounting_status": "Ind AS 109 (Consolidates Q3 FY27)",
"annual_revenue": "INR 580 - 610 Cr",
"annual_ebitda": "INR 290 - 305 Cr",
"quarterly_run_rate": "~INR 72 - 76 Cr/qtr"
},
{
"portfolio_segment": "Second Acquired Target Portfolio",
"capacity": "~2.0 GW",
"accounting_status": "Ind AS 109 (Consolidates in FY27)",
"annual_revenue": "INR 150 - 180 Cr",
"annual_ebitda": "INR 75 - 90 Cr",
"quarterly_run_rate": "~INR 18 - 22 Cr/qtr"
},
{
"portfolio_segment": "Value-Added Services (VAS) & Life Extension",
"capacity": "Across Fleet",
"accounting_status": "Transitioning to Direct Fee Billing",
"annual_revenue": "INR 50 - 70 Cr",
"annual_ebitda": "INR 25 - 35 Cr",
"quarterly_run_rate": "~INR 6 - 9 Cr/qtr"
},
{
"portfolio_segment": "Total Consolidated Exit Run-Rate",
"capacity": "10.5 GW Wind (+2.8 GW Solar)",
"accounting_status": "Fully Consolidated (H2 FY27)",
"annual_revenue": "INR 1,160 - 1,260 Cr+",
"annual_ebitda": "INR 580 - 630 Cr",
"quarterly_run_rate": "~INR 150 Cr/qtr (INR 600 Cr Annualized)"
}
]
},
{
"name": "Quarterly Earnings Call Trackables & Benchmarks",
"columns": [
{ "key": "trackable_metric", "label": "Trackable / Operational Metric", "type": "text" },
{ "key": "baseline_q1", "label": "Q1 FY27 Baseline Actual", "type": "text" },
{ "key": "target_benchmark", "label": "Target Benchmark / Guidance", "type": "text" },
{ "key": "concall_citation", "label": "Concall Transcript Citation", "type": "text" }
],
"rows": [
{
"trackable_metric": "Total O&M Portfolio (AUM)",
"baseline_q1": "13.3 GW peak (10.5 GW Wind, 2.8 GW Solar)",
"target_benchmark": "17+ GW medium-term via group captive pipeline",
"concall_citation": "Transcript Page 4"
},
{
"trackable_metric": "Consolidated Active Revenue Fleet",
"baseline_q1": "~4.0 GW (Legacy Inox fleet)",
"target_benchmark": "Full line-by-line consolidation of ~6.5 GW acquired assets",
"concall_citation": "Transcript Page 4, 7"
},
{
"trackable_metric": "Wind Realization per MW",
"baseline_q1": "INR 9 - 10 lakh/MW/year (Legacy)",
"target_benchmark": "Substantially higher on older vintage WWIL fleet",
"concall_citation": "Transcript Page 7, 11"
},
{
"trackable_metric": "Operating EBITDA Margin",
"baseline_q1": "56.4% on reported total income",
"target_benchmark": "50% sustainable operating margin",
"concall_citation": "Transcript Page 4, 11"
},
{
"trackable_metric": "Annualized EBITDA Run-Rate",
"baseline_q1": "INR 228 Cr annualized (INR 57 Cr reported)",
"target_benchmark": "INR 600 Cr annualized exit run-rate (~INR 150 Cr/qtr)",
"concall_citation": "Transcript Page 12-13"
},
{
"trackable_metric": "Contract Price Escalation",
"baseline_q1": "~5% indexation clauses",
"target_benchmark": "5% annual contractual escalation across WWIL fleet",
"concall_citation": "Transcript Page 4, 13"
},
{
"trackable_metric": "Fleet Machine Availability Rate",
"baseline_q1": "96.3%",
"target_benchmark": ">96.0% SLA threshold",
"concall_citation": "Transcript Page 4"
}
]
},
{
"name": "Peer Comparison & Valuation Benchmarks",
"columns": [
{ "key": "company_name", "label": "Company Name", "type": "text" },
{ "key": "cmp_inr", "label": "CMP (INR)", "type": "number" },
{ "key": "pe_ratio", "label": "P/E", "type": "number" },
{ "key": "mcap_cr", "label": "Market Cap (INR Cr)", "type": "number" },
{ "key": "qtr_sales_cr", "label": "Quarterly Sales (INR Cr)", "type": "number" },
{ "key": "qtr_sales_growth_pct", "label": "Sales YoY Var (%)", "type": "number" },
{ "key": "qtr_pat_cr", "label": "Quarterly PAT (INR Cr)", "type": "number" },
{ "key": "roce_pct", "label": "ROCE (%)", "type": "number" }
],
"rows": [
{
"company_name": "International Gemological Instit",
"cmp_inr": 323.50,
"pe_ratio": 22.93,
"mcap_cr": 13980.37,
"qtr_sales_cr": 370.78,
"qtr_sales_growth_pct": 23.22,
"qtr_pat_cr": 165.74,
"roce_pct": 69.25
},
{
"company_name": "Wework India",
"cmp_inr": 666.95,
"pe_ratio": 106.82,
"mcap_cr": 9243.28,
"qtr_sales_cr": 680.20,
"qtr_sales_growth_pct": 27.39,
"qtr_pat_cr": -4.58,
"roce_pct": 20.57
},
{
"company_name": "NESCO",
"cmp_inr": 1047.60,
"pe_ratio": 17.72,
"mcap_cr": 7381.39,
"qtr_sales_cr": 211.80,
"qtr_sales_growth_pct": 9.55,
"qtr_pat_cr": 99.96,
"roce_pct": 18.54
},
{
"company_name": "Inox Green Energy Services",
"cmp_inr": 175.10,
"pe_ratio": 57.35,
"mcap_cr": 7030.13,
"qtr_sales_cr": 43.29,
"qtr_sales_growth_pct": -22.97,
"qtr_pat_cr": 40.79,
"roce_pct": 8.42
},
{
"company_name": "NDR INVIT Trust",
"cmp_inr": 145.00,
"pe_ratio": 66.71,
"mcap_cr": 6641.57,
"qtr_sales_cr": 124.02,
"qtr_sales_growth_pct": 22.12,
"qtr_pat_cr": 36.00,
"roce_pct": 5.08
},
{
"company_name": "Leap India",
"cmp_inr": 150.26,
"pe_ratio": 113.52,
"mcap_cr": 6619.50,
"qtr_sales_cr": 203.41,
"qtr_sales_growth_pct": 19.10,
"qtr_pat_cr": 24.73,
"roce_pct": 8.34
},
{
"company_name": "Smartworks Cowor",
"cmp_inr": 541.50,
"pe_ratio": 222.24,
"mcap_cr": 6193.74,
"qtr_sales_cr": 546.25,
"qtr_sales_growth_pct": 44.05,
"qtr_pat_cr": 13.15,
"roce_pct": 8.30
}
]
},
{
"name": "Shareholding Pattern Structure (June 2026)",
"columns": [
{ "key": "category", "label": "Shareholder Category", "type": "text" },
{ "key": "holding_pct", "label": "Holding (%)", "type": "number" },
{ "key": "trend", "label": "Recent Trend / Comment", "type": "text" }
],
"rows": [
{
"category": "Promoters",
"holding_pct": 56.12,
"trend": "Stable at 56.12% across Mar 2026 and Jun 2026"
},
{
"category": "Foreign Institutional Investors (FIIs)",
"holding_pct": 7.86,
"trend": "Slight reduction from 8.74% in Mar 2026"
},
{
"category": "Domestic Institutional Investors (DIIs)",
"holding_pct": 1.87,
"trend": "Increased from 1.50% in Mar 2026"
},
{
"category": "Public & Retail Shareholders",
"holding_pct": 34.17,
"trend": "114,521 total shareholders as of Jun 2026"
}
]
}
]
}

# Plan 4 

Update the production data quickly with the current data that we have
Push all the code to the github and make sure the remote is updated