# Bugs to fix

Open issues found on 2026-10-09. Work through them from the PC that has access to the production
Neon database and the Vercel project.

> **Before deploying `master`:** production currently runs a guidance-analysis feature ("Read calls
> and presentations", "Review analysis before saving") whose code is not on GitHub. Deploying
> `master` as it is would remove that feature from production. Push that code to GitHub first,
> then deploy.

---

## 1. "'siddhesh.dige@rdc.in' already has a thesis on company 'SOTL'", but no card shows (urgent)

**What happens:** Siddhesh can't create a SOTL thesis. The app says he already has one, but there
is no SOTL card on the dashboard.

**Why:** Delete is not the problem. Deleting a company removes everything under it. The real cause
is that two checks disagree:

- The dashboard hides empty theses (no "What it does", no hard evidence, no "Why we believe it").
- The "already has a thesis" check counted any thesis, even an empty one.

His SOTL thesis is empty. It was most likely left behind by an earlier create that failed part-way,
because creating a thesis used to save in several separate steps.

**Code fix (included in the same commit as this file), in `web/src/lib/server/services/versioning.ts`:**

- Creating a thesis now saves the company, thesis, first version and kill triggers in one
  transaction. Either everything is saved or nothing is, so an empty thesis can't be left behind.
- If your own thesis on a company is empty, creating one now fills it in instead of erroring.
- A thesis with real content is still protected by the "already has a thesis" error.
- `isSubstantiveThesis` uses the same rule as the dashboard query in
  `web/src/routes/api/companies/+server.ts`. Keep the two in sync. Tests are in
  `web/tests/sections.test.ts`.
- Not yet verified against a real database: the end-to-end DB tests need Docker running.

**Still to do: clean up production now.** Run this in the Neon SQL editor for the production database.

1. Look first:

```sql
select s.id, s.owner, s.current_version_id,
       (select count(*) from thesis_versions v where v.scenario_id = s.id) as versions,
       (select v.thesis_data->'the_business'->>'what_it_does'
          from thesis_versions v where v.version_id = s.current_version_id) as what_it_does
from thesis_scenarios s where s.company_id = 'SOTL';

select (select count(*) from custom_notes  where company_id = 'SOTL') as notes,
       (select count(*) from custom_tables where company_id = 'SOTL') as tables;
```

2. Remove only Siddhesh's empty thesis. Other analysts' theses and the company's notes and tables
   stay. The `set_config` line is required, because thesis history is protected against deletes.

```sql
begin;
select set_config('app.allow_thesis_delete', 'on', true);
delete from thesis_scenarios
where company_id = 'SOTL' and owner = 'siddhesh.dige@rdc.in';
commit;
```

3. Ask Siddhesh to create SOTL again.

The other option is for an admin to open `/company/SOTL` and press Delete. Only do that if step 1
shows his is the only SOTL thesis and there are no notes or tables, because Delete removes the whole
company.

---

## 2. HFCL "No company calls or presentations were found" when they exist

**What happens:** the guidance review for HFCL (quarter ended 2026-06-30) said there was no
earnings-call transcript or presentation, so it created no guidance. Both exist.

**Why:** the app looks documents up through BSE's announcements API. BSE sits behind Akamai, which
returns HTTP 403 to server requests (`api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData`). The
app then reports this failure as "none found".

**Fix (needs the guidance-analysis code pushed to GitHub first):**

1. Use Screener's company page as the main source. `.documents.concalls li` lists each month's
   Transcript, PPT and REC links. The linked BSE PDFs download fine
   (`https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=<guid>.pdf` or
   `/xml-data/corpfiling/AttachHis/<guid>.pdf`).
2. Keep BSE only as a fallback.
3. When a fetch fails, say "could not retrieve" and offer Retry or Upload. Never say the documents
   don't exist.
4. Add tests for each case: found, not published yet, and source blocked.

---

## 3. Compare page can fail on Vercel when many companies load at once

The Screener rate limiter runs separately in each serverless instance. Up to 10 parallel loads can
hit Screener 429s or blocks, or run past the 60s limit if they queue.

**Fix:** let the client load at most 2 at a time, add a Retry button per company, test on
production, and pre-warm the cache with a cron job if still needed.

## 4. Production scripts can hit the wrong database

`web/_prod_check.mjs`, `_prod_migrate.mjs` and `_prod_reset_password.mjs` read whatever env file
they are given. `.production.env` still points to the old Aiven database.

**Fix:** print the host before doing anything, refuse any host that isn't the Neon production host,
and rename or delete the stale file.

## 5. Health check doesn't check the database

`/api/health` always returns `ok`.

**Fix:** run `select 1` with a short timeout and return 503 if it fails.

## 6. Bank results show "—" for Revenue and OPM on Compare

Screener labels bank results "Revenue", "Financing Profit" and "Financing Margin %". Compare
doesn't map these labels.

**Fix:** map the bank labels onto Revenue and OPM.

## 7. Smaller issues

- Vercel Hobby runs each cron job only once a day (alerts at 09:30 UTC and sector rotation at
  11:00 UTC, weekdays).
- GUJGASLTD and INDLMETER have no price source.
- The browser tab says "ThesisTrack" but the app says "Thesis Tracker".
- The sectors and metrics tests fail instead of skipping when the test database (Docker) is down.
- The Windows `adapter-vercel` build fails with EPERM. Build on Vercel or under WSL.
- There's no easy way to see which commit production is running. Install the Vercel CLI or show
  the commit SHA on `/api/health`.
