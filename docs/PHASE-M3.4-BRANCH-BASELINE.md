# M3.4 — Branch Extraction Baseline (Phase 1 Freeze)

**Status:** M3.4 in progress, **uncommitted**, awaiting final review.
**Baseline captured:** 2026-09-27 (UTC), from the working tree at HEAD `0b680e4`.
**Purpose:** freeze and record the pre-change state so every later M3.4 number is
traceable to a known baseline. This document is additive; it modifies no
frozen M3.3 artefact.

---

## 1. Freeze state

| Item | Value |
| ---- | ----- |
| HEAD | `0b680e41a13577f294039d42b87eb5452b2f0207` |
| HEAD subject | `feat: M3.3 generic people discovery and semantic evidence pipeline` |
| M3.3 commit present | yes (`git cat-file -t` → `commit`) |
| Parent | `f85d915` (M3.3 generic people extraction extension) |
| Working tree | M3.4 only, see §2 |
| Universe provenance | `nrb-bfi-mid-may-2026` (unchanged, not upgraded) |

### Working-tree changes (all M3.4)

Modified:

- `data/pilot/pilot-sources.json` — 9 × `known_url` re-point + 9 × `note`
- `lib/ingestion/structured.ts` — value gate + 2 generic fallbacks
- `scripts/smoke-structured.ts` — fixtures B4, B5, B6

Untracked (new):

- `data/pilot/branch-shape-inventory.json`
- `data/pilot/branch-url-discovery.json`
- `lib/ingestion/shape-signals.ts`
- `scripts/apply-branch-target-corrections.ts`
- `scripts/discover-branch-urls.ts`
- `scripts/inventory-branch-shapes.ts`

`git diff` on `pilot-sources.json` touches **only** `known_url` and `note`
(18 changed lines = 9 pairs each). `proven_by`, `status`, `capability`,
`link_type` are untouched. *(The string `proven_by` does appear inside the new
`note` text; no `proven_by` field value changed.)*

### Confirmed untouched

- `schema/schema.sql` — `git status --porcelain -- schema/` empty
- `migrations/` (0001…0007) — empty status
- `docs/` including `docs/PHASE-M3.3-PEOPLE-DISCOVERY-REPORT.md` — empty status
- `data/pilot/pilot-budget.json` — empty status
- No commit, push, or deploy performed in M3.4.

---

## 2. Target baseline

| Metric | Count |
| ------ | ----: |
| Sources in universe | 51 |
| Sources with a `BRANCH_DIRECTORY` capability | 51 (100%) |
| `BRANCH_DIRECTORY.known_url` set | 35 |
| `BRANCH_DIRECTORY.known_url` null (discovery intent) | 16 |
| `BRANCH_DIRECTORY.status` = `CANDIDATE` | 51 (nothing is VERIFIED) |
| `proven_by` distinct values | 1 (`nrb-bfi-mid-may-2026`) |

Every secondary capability in `pilot-sources.json` remains a **CANDIDATE**
discovery intent. A non-null `known_url` means "a real page was located and
snapshotted", **not** "the page is a verified branch directory".

### Per-target parser baseline

Source: `data/pilot/branch-shape-inventory.json`,
`generated_at 2026-09-27T14:41:22.885Z`, 35/35 fetched, 35 snapshots.
`names` = assertable `BRANCH_NAME` count from an in-memory dry run.
`tbl` = `signals.tableCount`, `loc` = `signals.locatorMarkers`.

| source_id | names | tbl | loc | shape (coverage verdict) |
| --------- | ----: | --: | --: | ------------------------ |
| chhimek-website | 212 | 0 | 13 | BRANCH_DIRECTORY_TABLE |
| gblbs-website | 191 | 5 | 1 | BRANCH_DIRECTORY_TABLE |
| nirdhan-website | 168 | 21 | 0 | BRANCH_DIRECTORY_TABLE |
| mero-website | 155 | 0 | 42 | BRANCH_DIRECTORY_TABLE |
| aarambha-website | 132 | 1 | 10 | BRANCH_DIRECTORY_TABLE |
| asha-website | 132 | 7 | 0 | BRANCH_DIRECTORY_TABLE |
| nadeplaghubitta-website | 89 | 1 | 0 | BRANCH_DIRECTORY_TABLE |
| sampadalaghubitta-website | 71 | 0 | 0 | BRANCH_DIRECTORY_TABLE |
| mslbsl-website | 63 | 64 | 0 | BRANCH_DIRECTORY_TABLE |
| dhaulagiribank-website | 58 | 1 | 0 | BRANCH_DIRECTORY_TABLE |
| jucbank-website | 39 | 1 | 10 | BRANCH_DIRECTORY_TABLE |
| supportmicrofinance-website | 14 | 0 | 0 | BRANCH_DIRECTORY_TABLE |
| skbbl-website | 11 | 0 | 0 | BRANCH_DIRECTORY_TABLE |
| nerudemirmire-website | 3 | 0 | 11 | BRANCH_DIRECTORY_TABLE |
| forwardmfbank-website | 2 | 1 | 0 | BRANCH_DIRECTORY_TABLE |
| rsdcmf-website | 2 | 0 | 0 | BRANCH_DIRECTORY_TABLE |
| swmfi-website | 1 | 0 | 0 | SINGLE_LOCATION_CONTACT |
| slbsl-website | 1 | 0 | 0 | SINGLE_LOCATION_CONTACT |
| nationalmicrofinance-website | 1 | 0 | 0 | BRANCH_INTENT_UNCONFIRMED |
| mlbsl-website | 1 | 0 | 179 | BRANCH_LOCATOR_UNRENDERED |
| matribhumi-website | 0 | 0 | 68 | BRANCH_LOCATOR_UNRENDERED |
| aatmanirbhar-website | 0 | 1 | 0 | BRANCH_REPEATED_BLOCKS |
| swbbl-website | 0 | 0 | 6 | BRANCH_LOCATOR_UNRENDERED |
| fmdb-website | 0 | 0 | 0 | SINGLE_LOCATION_CONTACT |
| kalikabank-website | 0 | 0 | 13 | BRANCH_LOCATOR_UNRENDERED |
| laxmilaghu-website | 0 | 0 | 2 | BRANCH_LOCATOR_UNRENDERED |
| himalayanlaghubitta-website | 0 | 0 | 3 | BRANCH_LOCATOR_UNRENDERED |
| vlbs-website | 0 | 0 | 0 | NOT_A_BRANCH_PAGE |
| nmbmicrofinance-website | 0 | 0 | 0 | SINGLE_LOCATION_CONTACT |
| samata-website | 0 | 0 | 0 | SINGLE_LOCATION_CONTACT |
| unnatislbs-website | 0 | 0 | 0 | NOT_A_BRANCH_PAGE |
| uniquenepalmicrofinance-website | 0 | 0 | 0 | SINGLE_LOCATION_CONTACT |
| ulbsl-website | 0 | 0 | 0 | SINGLE_LOCATION_CONTACT |
| swastiklbs-website | 0 | 0 | 0 | SINGLE_LOCATION_CONTACT |
| jeevanbikasmf-website | 0 | 0 | 0 | BRANCH_INTENT_UNCONFIRMED |

Pages the parser would assert ≥2 names on: **16 / 35**.

### Known interpretive caveat (carried into Phase 4)

`shape` in the inventory is a **coverage verdict**, not a pure HTML
classification: `classifyShape(s, branchNames.length, …)` folds parser yield
into the label, so `BRANCH_DIRECTORY_TABLE` also covers heading-card and
`<br>`-cell pages. The 16 readable pages are therefore *not* 16 record tables:

- `chhimek` (212), `sampadalaghubitta` (71), `skbbl` (11),
  `supportmicrofinance` (14), `nerudemirmire` (3), `rsdcmf` (2) all report
  `tableCount = 0` and are read by an M3.4 fallback.
- `mslbsl` (63) reads via the heading-card fallback despite `tableCount = 64`
  (its 64 "tables" are per-card label/value tables, not one record table).

Phase 4 must report structure and parser yield as separate sections.

### Discovery baseline

Source: `data/pilot/branch-url-discovery.json`,
`generated_at 2026-09-27T14:42:04.281Z`, mode verify-only.

| Metric | Value |
| ------ | ----: |
| targets | 35 |
| totalFetches / verifyFetches | 30 / 30 |
| sourcesWithSitemap | 12 |
| sourcesWithCandidates | 32 |
| sourcesWithVerifiedBranchDirectory | 18 |
| sourcesNeedingJs | 6 |
| candidateUrlsChecked | 30 |
| parserReadablePages | 17 |
| parserUnreadableRealDirectories | 1 |
| VERIFIED_BRANCH_DIRECTORY | 18 |
| BRANCH_PAGE_NEEDS_JS | 6 |
| BRANCH_INTENT_NO_STRUCTURE | 4 |
| NOT_A_BRANCH_PAGE | 2 |
| UNREADABLE | 0 |

Discovery tool bounds (measurement harness, **not** the production crawl
budget): `maxSitemapProbesPerHost 3`, `maxChildSitemaps 6`,
`maxCandidatesPerSource 6`, `maxVerifyFetches 30`, `totalFetchCap 500`.

---

## 3. Assertion / snapshot baseline

| Evidence DB | `source_snapshots` | `data_assertions` | `data_conflicts` | `validation_results` |
| ----------- | -----------------: | ----------------: | ---------------: | -------------------: |
| `pilot-branch-shapes-2026-09-27.db` | 35 | **0** | 0 | 0 |
| `pilot-branch-url-discovery-2026-09-27.db` | 30 | **0** | 0 | 0 |

Both M3.4 branch DBs are snapshot-only. No branch assertion has been written by
M3.4 work.

### Pre-existing branch assertions (M3.2 era) — important

`data/pilot/evidence/phase-o-2026-09-26-base-51-source.db` already contains
**1157 `branch_name` assertions**, all `verification_status = UNVERIFIED`,
all `confidence = 0.6`. They were written by the pre-gate parser:

| source_id | assertions | distinct values | current parser |
| --------- | ---------: | --------------: | -------------: |
| matribhumi-website | 209 | 209 | **0** (LOCATOR_UNRENDERED) |
| gblbs-website | 191 | 189 | 191 |
| nirdhan-website | 180 | 171 | 168 |
| asha-website | 132 | 132 | 132 |
| aarambha-website | 132 | 132 | 132 |
| infinity-website | 102 | 102 | no branch target |
| dhaulagiribank-website | 58 | 58 | 58 |
| forwardmfbank-website | 50 | **12** | 2 |
| jucbank-website | 39 | 39 | 39 |
| aatmanirbhar-website | 34 | **2** | 0 |
| uniquenepalmicrofinance-website | 30 | **15** | 0 |

Known-bad value classes still present in that DB, which the M3.4 value gate
now refuses:

- bare generic `"Regional Office"` (nirdhan, ~10 rows)
- district-only values (forwardmfbank, 50 rows → 12 distinct)
- repeated column header `"Branch Manager"` (aatmanirbhar, 34 rows → 2 distinct)
- `matribhumi`: 209 asserted names the current parser can no longer reproduce

Consequences for later phases, recorded now so they are not rediscovered late:

- Phase 10: these rows are **historical evidence and must not be deleted**; a
  newer snapshot does not justify deletion.
- Phase 11: the value gate changes a snapshot's claims, which is a *semantic*
  change and must remain visible rather than silently collapsing.
- Phase 12/13: the divergence between stored and currently-derivable claims
  needs a review-layer representation, not a silent merge.

---

## 4. Test baseline

All green at baseline.

| Script | Result |
| ------ | ------ |
| `typecheck` (`tsc --noEmit`) | clean |
| `build` (`next build`) | clean |
| `smoke:structured` | 106 ok / 0 fail |
| `smoke:people` | 32 ok / 0 fail |
| `smoke:people-m33` | 95 ok / 0 fail |
| `smoke:people-generic-ext` | 48 passed / 0 failed |
| `smoke:people-discovery` | 45 passed / 0 failed |
| `smoke:people-idempotency` | 33 passed / 0 failed |
| `smoke:people-plausibility` | 30 passed / 0 failed |
| `smoke:api` | 36 passed / 0 failed |
| `smoke:ingest` | 54 ok / 0 fail |
| `smoke:ingest-security` | 50 ok / 0 fail |
| `check:discipline` | clean |

Structured branch fixtures at baseline: B1, B2, B3 (M3.3), B4 heading-card,
B5 `<br>`-cell, B6 value-gate traps.

---

## 5. Budget baseline

`data/pilot/pilot-budget.json` unchanged from HEAD:

```
maxTargets 40 | maxFetches 18 | maxDocuments 8 | maxBytes 5242880
maxRedirects 5 | maxRetries 2 | maxRuntimeMs 240000
```

The M3.4 inventory/discovery scripts are **measurement harnesses** with their
own explicit caps (inventory `MAX_FETCHES = 40`; discovery bounds in §2). They
do not alter the production pilot budget, which stays at 18 fetches. Phase 16's
10-institution pilot must run inside the unchanged production budget.

---

## 6. Standing M3.4 constraints

- Generic and institution-agnostic. No per-MFB selectors, parser classes, or
  blacklists.
- Deterministic. No AI/LLM, browser/Playwright, JavaScript rendering, or OCR.
- Evidence-first. Raw snapshot stays authoritative; history is append-only.
- No schema or migration changes; no new tables or columns.
- No increase to production crawl budgets; no deploy; no push; no commit.
- Do not modify the M3.3 report or the frozen M3.3 architecture.
- Do not start M3.5 Career/Vacancy work.
- A branch name needs distinguishing information. Bare `Branch Office` must
  never become an assertion.
