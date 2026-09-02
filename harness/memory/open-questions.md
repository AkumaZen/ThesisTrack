# Open questions (things needing the human)

## 2026-09-03: user dropped a TO DO note and a .production.env file into the repo mid-session (during P5)
Found while staging the P5 commit — neither was created by this session.

**`TO DO` (repo root, untracked, not committed):** requests GitHub push
("repo name ThesisTrack"), user login with read/write RBAC for two named
users, "proper option to fill data for all sections," and a simpler/more
user-friendly UI. These are real scope additions beyond BUILD_PLAN.md's v1
(§0 explicitly scopes auth to "static API key, single analyst... not
before" multi-user). Needs the human to confirm priority/scope before any
of this is built — not silently absorbed into P6 work.

**`.production.env` (repo root, untracked, gitignored via the *.env
hardening in this same commit):** contains a live Aiven-hosted Postgres
`DATABASE_URL` with an embedded password. Constitution rule 8 forbids
secrets entering `harness/` or the journal — it hasn't, and it was never
staged for commit — but its mere presence in the working tree, apparently
supplied by the human, raises a question this session can't answer alone:
is this intended for deployment right now, and if so, should this repo be
pointed at it? Flagging rather than acting — do not assume "yes, deploy"
without an explicit go-ahead, per this project's stated preference for
confirming before hard-to-reverse or externally-visible actions (pushing
to GitHub, writing to a real production database).
