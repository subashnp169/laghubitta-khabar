# ASSET-DECISION-MATRIX — Phase P0.1 Freeze

**Status:** FROZEN (Phase P0.1)

Directive §49. Every existing component classified as KEEP / ADAPT / REPLACE /
DEFER / REJECT. Nothing here was deleted; classifications are decisions about
*how* an asset is used going forward.

---

## Summary

| Class | Count | Meaning |
|---|---|---|
| KEEP | 22 | Sound as-is. Do not touch without reason. |
| ADAPT | 12 | Valuable, but must move/behave differently. |
| REPLACE | 1 | Technically necessary. |
| DEFER | 14 | Real value, not required now. |
| REJECT | 6 | Conflicts with product strategy or frozen rules. |

---

## KEEP — sound architecture and implementation

| Asset | Evidence it is sound |
|---|---|
| `schema/schema.sql` + `migrations/0001..0007` | 53 tables, FK integrity, D1-indexed, reviewed, frozen |
| `lib/repository/contract.ts` | Interface-only, zero I/O, the correct seam |
| `lib/api/contract.ts` | Frozen envelopes, pagination clamped, multi-source `ApiMeta` |
| `lib/repository/d1.ts` | Sole D1 knowledge; parameterized queries |
| `lib/repository/projection.ts` | One fact → many views; 34 KB of real logic |
| `lib/repository/static-branches.ts` | Correct build-time projection pattern |
| `lib/repository/mock.ts` | Same contract from `master.json`; enables build without a DB |
| `lib/ingestion/canonical.ts` | Deterministic hash → real idempotency |
| `lib/ingestion/fetcher.ts` | Host allowlist, byte caps, timeouts, redirect limits |
| `lib/ingestion/validators.ts` | Sanity/cross-source/trend/bound rules |
| `lib/ingestion/structured.ts` | 69 KB of tested structured extraction |
| `lib/ingestion/people.ts` + `people-evidence.ts` | M3.6B lifecycle, 64 passing assertions |
| `lib/ingestion/careers.ts` + career-* | Multi-strategy extraction, 1,023-line smoke suite |
| `lib/ingestion/review.ts` | Human-in-the-loop concept, correct |
| `scripts/guard-env.cjs` | R1/R4 runtime gate; blocks staging/prod |
| `scripts/check-discipline.cjs` | R1–R6 static enforcement, CI-runnable |
| `scripts/audit-export.cjs` | 335 pages / 13,783 links / 1,463 anchors / 0 failures |
| `worker/src/security.ts` | Headers, CORS allowlist, token bucket, egress + segment guards; 60+ negative-case tests |
| `public/_headers` | CSP/HSTS/nosniff/frame-deny/referrer/permissions — active on Cloudflare Pages |
| `src/lib/site-data.ts` | The sanctioned seam (directive §7 names it) |
| `data/master/master.json` | 51 institutions, NRB-sourced, per-field grades |
| 60+ smoke suites | The reason refactors here are safe |

---

## ADAPT — keep, but change how it is used

| Asset | Current state | Adapt to |
|---|---|---|
| `src/data/*.ts` | Imported by 24 pages as if it were source | Transitional build artifact. Only `src/lib/site-data.ts` may import it (R6) |
| `lk.db` | Treated in places as "the canonical DB"; actually holds 51 institutions and **0 assertions** | Local dev store only. Not the production canonical store (directive §8) |
| `lib/repository/index.ts` | `LK_DB=mock` default silently serves `master.json` | Fine for build; must never be the staging/prod answer. Assert adapter choice at deploy |
| `lib/repository/types.ts` DTOs | Overlap `src/types/index.ts` `Institution` | P0.2/P0.3 reconciliation — one canonical shape, DTOs derived |
| `src/types/index.ts` | Declares `Job`, `Post`, `Video`, `Document`, `ResearchItem`, `ReportMetric`, `IndustryReport`; only `Job` referenced, and a *duplicate* lives in `src/data/jobs.ts` | P0.2 reconcile; delete dead type surface |
| `scripts/` layout | ~57 files flat, no subdirectories | P0.3 split into `audit/ ingestion/ export/ migration/ smoke/` (directive §61) |
| `npm run lint` | Fails on pre-existing `.cjs` errors (`require()` in ESM, one `prefer-const`) | Fix in P0.3. `npx eslint src lib worker` is clean with 0 errors today |
| `data/pilot/evidence/*.db` | 13 dated DBs, isolated, non-cumulative | P0.5 import as historical runs into one durable store |
| `data_conflicts` | **Corrected in P0.2:** 229 rows DO exist in 3 pilot evidence DBs (all `people_ceo`, all `OPEN`). Detection and persistence work; **review and resolution do not** (`resolved_by`/`resolved_at`/`resolution_note` NULL on all 229) | P0.5 review surface; P0.4 conflict coverage for non-people fields |
| `review.ts` | Module exists, no operator surface | P14 control panel |
| `.github/workflows/deploy.yml` | Deploys to GitHub Pages, which **ignores `public/_headers`** | Move CI to Cloudflare Pages (directive §22, §45). GitHub Pages = preview only |

---

## REPLACE — one item

| Asset | Why | Replacement |
|---|---|---|
| GitHub Pages as the production host | It cannot set response headers at all, so `public/_headers` never applies and the site ships **without CSP**. `docs/ARCHITECTURE.md` already names Cloudflare Pages as the supported host | Cloudflare Pages + Cloudflare Worker, which `worker/wrangler*.toml.example` is already shaped for |

This is a deployment change, not a rewrite. The static export output is
unchanged.

---

## DEFER — real value, not now

| Asset / idea | Why deferred | Target phase |
|---|---|---|
| `branches` / `people` / `financial_metrics` normalized tables | Empty in every DB while pages render correctly via assertions → export. The projection path works; populating the tables is not required to publish | P3, P4 |
| `institution_coverage` 10-dimension UI | Populated (51 rows) but never surfaced. Valuable for the operator, not for readers yet | P14 |
| `products`, `services`, `digital_services`, `social_accounts` | Schema ready, no data (all websites `candidate`) | P7 |
| `nrb_directives`, `regulatory_events` enforcement layer | Tables exist; enforcement data not yet ingested | P6 |
| `research` / `posts` tables | No authoring workflow; research is currently static pages | P16 |
| `dividends`, `book_closures` | Schema ready, listed companies only | P4 |
| Activity entity | Deferred by directive §25/§26. Needs consent + moderation design first | P10 |
| Centers (group meeting units) | Not in schema; needs approved migration | P10 |
| Public API `/api/v1/*` | Current endpoints are unversioned and undocumented; version before publicizing | P13 |
| Write API + auth | Deferred by directive §24 | P11 |
| R2 media storage | Nothing to store yet | P12 |
| Search index | Generated-TS search is adequate at 334 pages | P9 |
| Map / GIS | Branch geography not yet trustworthy | P3, P10 |
| Data products / payments | Validate demand before building commerce (§33) | P16, P17 |

---

## REJECT — conflicts with strategy or frozen rules

| Rejected | Reason |
|---|---|
| Public borrower/member database | Directive §3, §28. Privacy boundary, frozen |
| Borrower/member PII of any kind | Same |
| MIS / core-banking replacement | Directive §3. MicroBanker, Uranus, Softoriel, Premium, Finsoft own this |
| Unrestricted public editing | Directive §25. Activity is institution-authorized first, moderated |
| Social-media clone / follower graph | Directive §3. Conflicts with "sector information" mission |
| Copying old SENNA `registry.json` / `mfi-directory.json` into canonical | Directive §48: reference only. Grade D. Its `hist-wean` / `hist-chautari` historical marks are contradicted by current NRB lists — copying would inject known errors |

**Reference-only (not rejected, explicitly demoted):** the old SENNA project is
valuable for directory filtering, institution detail UX, the
verified-logo + provenance fallback model, and corporate lineage — as
**discovery, cross-check and UI reference only**.

---

## Assets deliberately NOT touched at P0.1

Per directive §0 and §50, P0.1 is documentation. This phase made **no** changes
to: migrations, `schema.sql`, ingestion logic, repository implementations,
Worker routing, frontend pages, or any production resource.

Code changes landed separately and are recorded in `WORKMAP.md`.

---

## Open items requiring owner decision

1. **Durable store** (P0.5) — SQLite-local-append-only, or D1 as canonical now?
   Adapter seam makes it reversible; the *model* choice is not reversible.
2. **Hosting** — approve moving CI from GitHub Pages to Cloudflare Pages so the
   security baseline applies?
3. **Read path** — keep build-time projection, or move public pages to runtime
   API fetches for freshness?
4. **Centers / Activity schema** — P10 needs a new migration; approve in advance
   or defer both indefinitely?
5. **Language** — confirm bilingual rather than English-first.