# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A small team of investment analysts (two seeded users: rohit.negi@rdc.in, siddhesh.dige@rdc.in) tracking their own/prop capital's investment theses, primarily in Indian small/mid-cap equities. Multi-user by design, not single-player: RBAC with `read_write` and `read_only` roles, shared visibility across the team rather than per-analyst siloed data. Not managing external client money - this is a personal/prop discipline tool, not a compliance-facing system.

## Product Purpose

A shared, structured decision log where multiple analysts track companies, log ongoing performance against pre-committed invalidation conditions ("kill triggers"), record guidance/notes on specific parts of a thesis, and store other structured supporting data (e.g. shareholding patterns) - all in one place, replacing scattered spreadsheets and notes. Success is dual: (1) better real-time investing discipline for the team today, and (2) the accumulated structured data is usable later to fine-tune (SFT) a model on investment decision-making - this is a named product goal, not a hypothetical.

## Positioning

Not just a data store - every thesis is captured in a deliberately falsifiable, structured shape (kill triggers with severity/thresholds, Premise-to-Conclusion reasoning chains, append-only version history that can never be retroactively edited) specifically because that same structure is what makes the accumulated data usable to fine-tune a model later, not merely readable by a human. A spreadsheet or a Screener.in-style tracker gives you data; this gives multiple people a shared, versioned, queryable decision log built for daily use AND downstream ML training from the same structured capture - a spreadsheet or generic tracker cannot honestly make the second claim.

## Operating Context

Indian small/mid-cap equity research. INR is the default currency. Companies are classified against a controlled taxonomy (broad_industry > specific_niche) and one of five operating models (factory, subscription, money_lending, retail_stores, services), each with its own metric registry. Review cadence is quarterly (period format like `FY26Q1`). Status (on_track/watch_closely/broken) can be proposed by a rule engine or an AI reviewer but always resolves through human review, with overrides requiring a written rationale. Guidance notes attach to one of the thesis's fixed structural blocks (the business, growth engine, kill triggers, etc.) or a company generally. Supplementary structured data (e.g. shareholding pattern, peer comps) lives in fully user-defined custom tables, not fixed schemas.

## Capabilities and Constraints

FastAPI + PostgreSQL backend; vanilla JS frontend with no framework and no build step (Tailwind via Play CDN). Auth is JWT (per-user login) or a static X-API-Key (grandfathered machine access), both mapping to the same two-role RBAC. Thesis history (`thesis_versions`) is append-only, enforced by a DB trigger - not even company deletion can remove a version once written; this is a hard constraint, not a UI convention. The metric registry, taxonomy, and custom-table column definitions are all extensible without a migration (add a row, not new code). An SFT export pipeline (JSONL, train/eval splits, eligibility rules) already exists and is the concrete mechanism behind the "future fine-tuning" purpose above, not a separate future project.

## Brand Commitments

Name is "Investment Thesis Platform" (current page title) - confirmed as final, not a placeholder. No logo or other brand assets exist.

## Evidence on Hand

`BUILD_PLAN.md` is the authoritative original product spec (phases P0-P6, since extended beyond v1 at the user's explicit request - see `harness/memory/decisions.md` ADRs 016-018). No customer testimonials, case studies, or external marketing content exist or should be fabricated - this is an internal tool with no public-facing surface. Seed data on hand: a controlled taxonomy (5 industries, 6 niches) and 22 metric definitions across the 5 operating models.

## Product Principles

- Structure pays off twice: every thesis field is captured in a shape rigorous enough to both discipline the analyst's own decision-making today and serve as clean SFT training data later - never trade structure away for faster typing.
- Human judgment overrides automation, but must leave a reason: the rule engine and AI reviewer inform status, never silently set it; every override requires a written rationale.
- Nothing is retroactively rewritten: thesis versions are permanent once written - the audit trail is the product, not an afterthought.
- Extend the data model without code changes wherever possible: metric registry, taxonomy, and user-defined custom tables all follow "add a row, not a migration."
- Multi-user by design: the team, not an individual, tracks companies together, with shared visibility gated by role rather than by owner.
