# Phase M3.3 - Generic extension B: People URL seed manifest and seed-first discovery

> **Superseded in part.** This section records EXT-B, which is **held uncommitted**. Its two reported
> defects were fixed by EXT-C; see the EXT-C section at the end of this document for the current
> verdict. EXT-B's own numbers below are the baseline, not the current state.

**Milestone:** M3.3-GENERIC-EXT-B
**Date:** 2026-09-27
**Predecessor:** M3.3-GENERIC-EXT-A (commit `f85d915`)
**Evidence DB:** `data/pilot/evidence/pilot-people-2026-09-27-ext-b-seed-first.db`
**Manifest:** `data/pilot/people-url-seeds.json` (verdict cache v10: `data/pilot/people-url-seed-cache.json`)

## Objective

Build a verified, provenance-carrying list of official People URLs for the 51-source Class-D MFB
universe, then ingest **seed first, discover second**, so the engine stops burning crawl budget
rediscovering board pages. Reuse the existing generic extractor and evidence lifecycle. No
institution-specific parser.

## Verdict

**Seed sub-layer: PASS. Milestone overall: FAIL. Do not proceed to M3.4.**

The seed mechanism works and is well evidenced. Two of the three quality gates in the milestone
definition do not pass, and both failures are in the *extraction* path, not the seed path:

| Gate | Result |
| --- | --- |
| Real People URLs found for a substantial portion of the universe | **PASS** — 24/51 institutions, 41 verified pages |
| Extracted people are plausible | **FAIL** — 58/384 assertions (15.1%) are not people |
| Repeated ingestion creates no duplicate assertions | **FAIL** — 29 duplicated groups on the repeat pass |

No hard stop in the milestone definition was triggered. Do not hardcode a parser to force a pass;
hand the two defects to EXT-C.

## What was built

- `scripts/seed-people-urls.ts` — research-phase seed verifier. For each of the 51 institutions it
  fetches the official homepage and a bounded list of candidate paths through the existing
  `ControlledFetcher` (same policy, so the host allow-list, timeout, byte and redirect caps all
  apply), then admits a URL as a seed only when the existing generic `peopleExtractor` finds people
  **or** `detectLeadershipContext` finds role vocabulary outside nav/footer plus at least two
  distinct heading→role roster pairs. Verdicts are cached per URL and versioned by
  `VERDICT_VERSION`.
- `data/pilot/people-url-seeds.json` — the deliverable. Per institution: `institution_slug`,
  `official_homepage`, `people_urls[]` (each with `url`, `kind`, `confidence`, `source`,
  `discovery_method`, `observed_at`, `priority`, `http_status`, `content_type`,
  `leadership_role_signals`, `people_found`, `roles`, `verified_by`) and `future_candidates[]`.
- `lib/ingestion/people-discovery.ts` — deterministic generic People-link scorer used both by the
  seeder and, at runtime, as the fallback discovery tier.
- `BrowserDiscovery` — new `peopleSeeds` config branch emitting `DiscoveredTarget`s with
  `method: "SEED"`, plus the `LINK_PEOPLE` homepage-probe fallback. `normalizeDiscoveredUrl` is
  exported, and the engine audits every emitted target.
- `scripts/run-pilot-people.ts` — seed-first pilot. The manifest feeds the registry's PEOPLE
  capability: the highest-confidence seed becomes `known_url`, any remaining seeds ride
  `peopleSeeds`, and `peopleProbe` is enabled **only** when an institution has no seed. Both tiers
  share one unchanged per-source budget.

## Seed results (51-source universe)

| Metric | Value |
| --- | --- |
| Universe | 51 |
| Institutions with >= 1 verified People page | 24 |
| Institutions with no seed (generic discovery fallback) | 27 |
| Verified People pages | 41 |
| — `BOARD` | 28 |
| — `MANAGEMENT` | 8 |
| — `CORPORATE_TEAM` | 5 |
| — `ORGANIZATIONAL_CHART` / `TEAM` / `EXECUTIVE` / `LEADERSHIP` | 0 |
| People extractable by the current extractor at seed time | 357 |
| People pages with a 200 but zero extraction (EXT-C candidates) | 19 |
| Future candidates (branch/career/soft-404, not ingested) | 2 |
| Rejected research leads | 2 |

Every seed carries full provenance (`with_provenance_ok: true` for all 41). `BRANCH_MANAGEMENT`
and `CAREER_CONTACT` are permitted kinds but produced no seeds; branch personnel remain out of scope.

Security behaviour held:

- `https://www.mf.jeevanbikas.org.np/about/about-board` → `REJECTED_DIFFERENT_HOST` (registry host
  is `jeevanbikasmf.com`).
- `https://www.aviyanlaghubitta.com.np/director` → `REJECTED_DIFFERENT_HOST` (registry host is
  `aviyanlaghubitta.com`).
- `slbs-website` redirected to `nesdosambridha.com` and was blocked by the allow-list.
- `guranslaghubitta-website` redirected to `glbsl.com.np` and was blocked.
- `chhimek-website` timed out at 12000 ms; `sanjeevanilaghubitta-website` failed to connect.

AI-generated search output was not trusted. "Mero Microfinance Governance Hub" and "NMBA Network
Registry" were treated as invented; the real NRB and NMBA sites return 200 but are third-party
regulator/registry pages and are out of scope; a guessed FinancialNotices path returned 404.

## Pilot results (controlled, unchanged budget)

In scope: 25 sources (24 seeded, plus `nadeplaghubitta-website` which has a config People URL but no
seed). All 25 returned HTTP 200 and reached `EXTRACTED`.

| Metric | Value |
| --- | --- |
| Snapshots / runs / items | 47 / 50 / 84 |
| People assertions (all `UNVERIFIED`) | 384 |
| Distinct people values | 341 |
| Sources producing >= 1 people assertion | 16 |
| In-scope sources producing 0 assertions | 9 |
| Provenance orphans | 0 |
| Snapshots missing hash / mime / clock / grade | 0 |
| Conflicts created by the detector | 155 (all queued for review) |
| New conflicts on the repeat pass | 0 |
| Budget changes | none (40 targets / 18 fetches / 8 docs / 5 MB / 15 s) |
| Schema changes | none |

In-scope sources with zero extraction (server-side rosters the current extractor misses):
`cyc`, `kalikabank`, `laxmilaghu`, `matribhumi`, `nerudemirmire`, `nadeplaghubitta`, `skbbl`,
`swabhimaanlaghubitta`, `ulbsl`. Matribhumi and CYC are confirmed server-side
`<h3>name</h3><p>role</p>` rosters, so these are extractor gaps rather than JS-rendering walls.

## Failure 1 — extracted people are not plausible

Of 384 assertions, 58 (15.1%) are not people:

| Class | Count | Examples |
| --- | --- | --- |
| `ENTITY` | 33 | `Nepal Rastra Bank`, `Lopho Tech Pvt. Ltd.`, `Ministry Of Finance`, `International Co-operative Alliance`, `Credit Department Head`, `Branch Offices`, `सहकारी विभाग` |
| `HEADING` | 17 | `Board of Directors`, `Management Teams`, `About Us`, `Press Release`, `Quarterly Report`, `Yearly Report` |
| `TITLE` | 6 | `Board of Director`, `Total Staff`, `Senior Manager`, `Divisional Manager` |
| `DEVANAGARI` | 2 | non-person Nepali strings |

Root cause: `nameLike()` accepts any 2+ token string with capitalised tokens, so
`Board of Directors` (3 non-honorific tokens, 2 capitalised) and `Head of IT Department` pass the
name test, and any nearby role word promotes them to `people_*`. `dhaulagiribank` extracts
`Credit Department Head`, `HR Department Head`, `Internal Audit` as board members.

Worse, `nationalmicrofinance-website` alone contributes **207** assertions (54% of the corpus) from a
`/management-team` page. That page is an ordinary staff listing, which the milestone explicitly puts
out of scope for M3.3, and 207 people is not plausible for a leadership page. `swbbl` contributes 41
across two pages, `gilb` 38, `swastik` 22.

All of these are `UNVERIFIED` and review-gated, so nothing incorrect can reach the UI — the
lifecycle contained the failure. But the data is not fit for verification, and the success gate
cannot be claimed.

## Failure 2 — repeat ingestion duplicates assertions

The repeat pass grew the corpus from 355 to 384 assertions: **29 duplicated
`(entity_id, field_name, value)` groups**, 19 of which are real people
(`Gokul Pandey`, `Kishor Jung Thakuri`, `Manoj Shrestha`, `Sudip Acharya`, …).

Root cause, confirmed by hash: `aatmanirbhar-website`'s page changed between passes
(`3d0c8fa4…` → `4b5a760a…`), so a new `source_snapshots` row was written. `data_assertions` has
only a random `id` primary key and two non-unique indexes; the natural key includes
`source_snapshot_id`, so an existing value re-inserted against a new snapshot becomes a duplicate
row. Byte-stable pages *are* idempotent — the defect only appears on pages whose HTML mutates
between runs (news carousels, rotating banners, session tokens).

A unique index would fix this at the storage layer, but `schema/schema.sql` is frozen for this
milestone. The correct fix is an assertion-level merge (look up the existing
`(entity, field, value)` and update provenance instead of appending) in
`LocalSqliteEvidenceWriter`.

## Regression results

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `scripts/smoke-people.ts` | 32 / 32 |
| `scripts/smoke-people-m33.ts` | 91 / 91 |
| `scripts/smoke-people-generic-ext.ts` | 47 / 47 |
| `scripts/smoke-people-discovery.ts` | 45 / 45 |
| `scripts/smoke-api.ts` | 36 / 36 |
| `npm run check:discipline` | OK, no violations |

`npm run lint` still reports the pre-existing 14 errors / 54 warnings; none are new.

## Recommended next step (EXT-C), in order

1. Tighten the name test: reject strings whose tokens are role/section/institution vocabulary
   (`board`, `directors`, `department`, `head`, `office`, `branch`, `press release`, `report`),
   require a person-name shape, and never promote a value found in a heading element as a person.
2. Add a per-page plausibility cap and an institution/company filter (`Ltd`, `Pvt`, `Bank`,
   `Ministry`, `Committee`, `Alliance`) so entity names cannot become people.
3. Detect and quarantine ordinary staff/branch directories — a leadership page yielding an
   implausible count is a scope violation, not a harvest.
4. Add the assertion-level merge in `LocalSqliteEvidenceWriter` so re-ingesting a content-mutating
   page updates provenance instead of appending rows.
5. Re-run this pilot and re-measure plausibility and idempotency. Only then consider M3.4.

---

# Phase M3.3 - Generic extension C: people plausibility and semantic idempotency

**Milestone:** M3.3-GENERIC-EXT-C
**Date:** 2026-09-27
**Predecessor:** M3.3-GENERIC-EXT-A (commit `f85d915`), EXT-B (uncommitted, held)
**Scope:** the two defects EXT-B reported, and nothing else
**Evidence DB:** `data/pilot/evidence/pilot-people-2026-09-27-ext-c-pass1.db` (pass 1, then the
repeat pass against the same DB)
**Baseline preserved:** `data/pilot/evidence/pilot-people-2026-09-27-ext-b-seed-first.db` — read
only, never overwritten. Baseline reports kept as
`data/pilot/pilot-people-report-ext-b-baseline.json`, `-ext-c-pass1.json`, `-ext-c-repeat.json`.

## A. Scope and constraints honoured

| Constraint | Result |
| --- | --- |
| Fix only the two reported defects | Yes — no other behaviour was changed |
| No schema change | Yes — `schema/schema.sql` untouched; the new validator reuses the existing `validation_rules` / `validation_results` tables |
| No institution-specific selectors, lists or parsers | Yes — every rule is structural or lexical |
| No AI/LLM, OCR, browser, JS rendering, login | Yes |
| No infrastructure or budget change | Yes — `data/pilot/pilot-budget.json` is unmodified (git-verified): `maxTargets 40`, `maxFetches 18`, `maxDocuments 8`, `maxBytes 5242880` (5 MB), `maxRedirects 5`, `maxRetries 2`, `maxRuntimeMs 240000` per run, 15 s per-request timeout |
| No evidence deleted, no conflict hidden | Yes — 64 conflicts, all `OPEN`; no row deleted |
| Nothing committed | Yes — EXT-B and EXT-C are both uncommitted, awaiting review |
| Seed manifest not regenerated | Yes — the EXT-B manifest was reused as-is |
| Pilot scope unchanged | Yes — the same 25 in-scope sources of the 51-source universe |

## B. Verdict

**Both defects: FIXED. EXT-C: PASS. M3.4 is NOT started and no hard stop was triggered.**

| Gate (from EXT-B) | EXT-B | EXT-C |
| --- | --- | --- |
| Extracted people are plausible | **FAIL** — 47/341 distinct values were not people | **PASS** — 0/89 |
| Repeated ingestion creates no duplicate assertions | **FAIL** — 29 duplicate groups | **PASS** — 0 duplicate groups |

## C. Defect 1 — plausibility: what changed

1. **Name shape.** `NON_PERSON_TOKENS` now covers legal forms (`Ltd`, `Pvt`, `Inc`, `Group`),
   institutions and units (`Bank`, `Ministry`, `Department`, `Branch`, `Committee`, `Board`),
   collective labels (`team`, `member`, `staff`, `employee`, `management`, `auditor`) and their
   Devanagari equivalents. `nameLike()` rejects **any** candidate containing one of them, so
   `Nepal Rastra Bank`, `Credit Department Head`, `Board of Directors` and `सहकारी विभाग` can no
   longer become people.
2. **No invented roles.** The `PEOPLE_BOARD` fallbacks are gone from the bold, list, free-paragraph
   and JSON paths. A person is asserted only when the page states a role: a name plus a role read
   from the page itself, or a role inherited from a leadership **section heading that names one**.
3. **Unrecognised but stated roles are kept, generically.** When a page states a designation outside
   the vocabulary (`Head of Operations`) the person is kept in the generic `people_board` field with
   the exact text preserved as `roleText`. Borrowing the enclosing section's role instead would have
   published "Kiran Thapa Magar is the CEO", a specific claim the page never made. A *sentence*
   after a dash (`he joined the board in 2019`) is not treated as a designation.
4. **Staff directories are quarantined by population, not by name.** `classifyPeoplePage()` needs at
   least 12 entries and a leadership ratio below 0.34. A designation that was actually read is
   decisive: "Monitoring Officer" is a staff entry even under a "Board of Directors" heading, and a
   leadership title is a governance entry under any heading. Suppressed entries become non-asserting
   `TEXT` evidence plus a `PENDING` future-candidate signal from the new informational validator
   `r-people-staff-directory` — never an assertion, never a silent drop.

## D. Defect 1 — what the pilot shows

| Metric | EXT-B | EXT-C |
| --- | --- | --- |
| People assertions | 384 | 91 |
| Distinct people values | 341 | 89 |
| **Distinct values that are not people** | **47** | **0** |
| Sources producing assertions | 16 | 9 |

`nationalmicrofinance-website` is the decisive case. One page carries a leadership block plus 205
general staff entries. EXT-B published 207 assertions from it; EXT-C asserts 4 leadership people
and holds 205 staff entries as future-candidate evidence.

Every value EXT-B asserted and EXT-C does not, classified:

| Category | Count | Explanation |
| --- | --- | --- |
| Not a person (institution, department, nav label, count, document link, heading) | 52 | Rejected by the stricter name test. Examples: `Nepal Rastra Bank`, `Credit Department Head`, `Press Release`, `Total Staff`, `Rep. from Nabil Bank Ltd.`, `Board of Directors` |
| Name-shaped, deliberately not asserted | 205 | The 203 `nationalmicrofinance` staff entries, held as evidence rather than published as leadership, plus 2 `samata` footer/social links (`NRB Gunaso Portal`, `Google Plus`) |
| **Real leadership people lost** | **0** | Six sources dropped to zero assertions; all 15 values they had asserted were non-persons |

## E. Defect 2 — semantic identity: what changed

`LocalSqliteEvidenceWriter.saveAssertion()` now computes a deterministic id from the semantic
claim — `sha256(entity_type, entity_id, field_name, normalised value)` — and inserts with
`INSERT OR IGNORE`. Snapshot and source are no longer part of identity:

- the first sighting is stored, unchanged, with its original `source_snapshot_id` and
  `observed_at`; a claim is never re-pointed at a later snapshot;
- every later sighting writes an `ASSERTION_RESEEN` row to the existing `audit_logs` table carrying
  source, snapshot, observation time, confidence and verification status, so provenance for all
  sightings stays readable without inventing a schema;
- a changed value is a different claim, and a changed role is a different `field_name`, so a role
  transition creates a new assertion and leaves the old one intact.

`source_snapshots` and the conflict lifecycle are untouched. No snapshot or conflict was removed.

## F. Defect 2 — deterministic fixtures (`scripts/smoke-people-idempotency.ts`, 33 checks)

| Case | Fixture | Expected | Result |
| --- | --- | --- | --- |
| A | same HTML ingested twice | 1 snapshot, 3 assertions | pass |
| B | only irrelevant markup changes (whitespace, attributes, comment) | canonical `UNCHANGED`, no new snapshot, no new assertion | pass |
| C | page mutates, the person does not | new snapshot `EXTRACTED`, still 3 assertions, 0 duplicate groups, 3 `ASSERTION_RESEEN` rows, original evidence pointer intact | pass |
| D | the person changes | 4 assertions, replaced person **not** deleted, unchanged claims keep their first evidence anchor, new claim anchored to the snapshot that carried it | pass |
| E | the role changes | new `people_ceo` field created, earlier `people_director` claim retained, no merge | pass |
| F | two independent sources report the same person | one semantic assertion, one snapshot per source, second source's provenance in `audit_logs` | pass |
| I | integrity | all `UNVERIFIED`, 0 orphan assertions, every snapshot has hash, MIME type and clock | pass |

## G. Defect 2 — what the pilot shows

| Metric | EXT-B | EXT-C |
| --- | --- | --- |
| Duplicate `(entity, field, value)` groups after a repeat pass | 29 | **0** |
| Assertions, pass 1 → repeat | 355 → 384 | **91 → 91** |
| Distinct people values, pass 1 → repeat | — | **89 → 89** |
| `ASSERTION_RESEEN` audit rows | 0 | 0 (see below) |
| Orphan assertions | 0 | 0 |

The repeat pass added **zero** claims and **zero** duplicates: 40 of 42 pages were
canonical-unchanged, and the 2 that changed carried no people claims, so no re-sighting occurred in
this particular run. `ASSERTION_RESEEN` is therefore proven deterministically (cases C and F)
rather than at pilot scale. The duplicate-suppression property itself is measured at pilot scale:
the same 89 values re-extracted across two passes produce 0 duplicate groups.

## H. Conflict and history behaviour

| Metric | EXT-B | EXT-C |
| --- | --- | --- |
| Conflicts | 155 | 64 |
| Conflicts `OPEN` | 155 | 64 |
| Conflicts silently resolved or hidden | 0 | 0 |

The drop is a consequence of the plausibility fix: most EXT-B conflicts were `people_ceo A <> B`
pairs manufactured by one page asserting many "chief executive officer"s. Nothing was deleted or
resolved; all 64 remain `OPEN` and reviewable. Role and person changes still create distinct claims,
so a real transition stays visible as separate assertions plus a conflict rather than being merged.

## I. Determinism and provenance

- **Parser version bumped.** `PEOPLE_PARSER_ID` is now `people-html-v2` and `PEOPLE_JSON_PARSER_ID`
  is `people-json-v2` (was `v1`). EXT-C changed what each parser emits — non-person filtering, no
  invented roles, no block-role borrowing, staff-directory suppression, and removal of the
  bare-name JSON fallback — so v1 evidence and v2 evidence are not comparable. Leaving the label at
  `v1` would have misattributed provenance: stored `parser_version` would have claimed a version
  that cannot produce the stored output. All 44 snapshots in the evidence DB carry `people-html-v2`.
  The bump is a constant change only; no schema, table or column changed.
- Deterministic ids: the assertion id is a pure function of the semantic claim, so re-running the
  same input cannot create a second row. Snapshot ids remain engine-generated.
- Every snapshot carries `content_hash`, `mime_type` and `fetched_at`; 0 snapshots are missing any
  of the three.
- All 91 people assertions are `UNVERIFIED`; 0 were auto-promoted.
- 0 orphan assertions: every assertion points at a snapshot that exists.
- No institution-, domain- or URL-specific rule was added. The staff-directory test reads only entry
  count and the role text found on the page.

## J. Security and scope

- Host allow-list, redirect cap, timeout, byte cap and document cap unchanged and enforced by the
  same `ControlledFetcher`; the run never raised a limit.
- No cross-domain snapshot was written; the two off-domain leads and two cross-domain redirects
  EXT-B reported are still rejected by the pre-existing host rule, which was not widened.
- No AI, OCR or browser rendering. No login. No third-party personnel page.
- Branch/personnel records, addresses, phone numbers, emails and social profiles remain out of
  scope; 2 footer/social links (`NRB Gunaso Portal`, `Google Plus`) are no longer asserted.

## K. Regression results

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `scripts/smoke-people.ts` | 32 / 32 |
| `scripts/smoke-people-m33.ts` | 95 / 95 (3 fixture expectations corrected, see L) |
| `scripts/smoke-people-plausibility.ts` (new) | 30 / 30 |
| `scripts/smoke-people-idempotency.ts` (new) | 33 / 33 |
| `scripts/smoke-people-generic-ext.ts` | 48 / 48 (1 fixture expectation corrected) |
| `scripts/smoke-people-discovery.ts` | 45 / 45 |
| `scripts/smoke-api.ts` | 36 / 36 |
| `scripts/smoke-dataapi.ts` | 42 / 42 |
| `scripts/smoke-schedule.ts` | 40 / 40 |
| `scripts/smoke-compare.ts` | 27 / 27 |
| `scripts/smoke-alerts.ts` | 18 / 18 |
| `scripts/smoke-ingest-fixtures.ts` | all pass |
| `scripts/smoke-ingest-security.ts` | all pass |
| `scripts/smoke-structured.ts` | all pass |
| `scripts/smoke-pdf-canonical.ts` | all pass |
| `scripts/smoke-worker.ts` | all pass |
| `npm run check:discipline` | no violations |
| `npm run build` (`next build`) | success |

283 People checks in total, all green. `npm run lint` still reports the pre-existing
14 errors / 54 warnings; none are new.

The new suites are registered in `package.json` as `smoke:people-plausibility`,
`smoke:people-idempotency`, `smoke:people-generic-ext` and `smoke:people-discovery`.

## L. Fixtures that encoded the old defects, and why they were corrected

Four assertions in the existing suites described the behaviour EXT-C was asked to remove. They were
corrected, not weakened, and each replacement asserts the stricter property:

| Old expectation | Why it was wrong | Replacement |
| --- | --- | --- |
| "flat array without role defaults to board (0.55)" | A bare name with no role was published as `PEOPLE_BOARD` | No evidence at all; plus a positive case for a stated designation inside and outside the vocabulary |
| "null/primitive/empty entries skipped" → 1 row for a bare name | Same invented role | Junk still skipped without a crash, bare name not published, role-bearing record kept |
| "changed body → two evidence snapshots for the same person" | One semantic claim stored twice, once per snapshot — the duplicate defect | One stored claim, and the re-sighting recorded in `audit_logs` |
| "non-vocabulary role falls back to the block role" | Published "Kiran Thapa Magar is the CEO" from a page that only said "Head of Operations" | Generic `people_board`, block role not borrowed, stated text preserved |

`smoke-people-generic-ext` and `smoke-people-m33` had disagreed with each other on this last point;
both now require the generic field.

## M. Known limitations

- The staff-directory threshold is a fixed pair of constants (≥12 entries, leadership ratio <0.34).
  They are empirically justified by the one staff directory in the universe, but a small staff page
  (<12 entries) will still be asserted, and a governance page whose designations are all
  unrecognised could be suppressed. The `PENDING` future-candidate signal is what makes the latter
  recoverable, not invisible.
- The role vocabulary is small. Real designations outside it land in the generic `people_board`
  field rather than a specific field, so role precision is bounded by the vocabulary.
- `ASSERTION_RESEEN` is proven by fixtures, not by the pilot, because the live pages did not change
  enough between passes to produce a re-sighting.
- `data/pilot/pilot-sources.json` still records `proven_by: "nrb-bfi-mid-may-2026"`, not the
  requested Mid-August 2026 directive provenance. This is unreconciled and no Mid-August freshness is
  claimed anywhere in this report.
- `source_snapshots` has no `created_at`, so snapshot ordering relies on `fetched_at` (or `rowid`
  where a run injects a constant clock). Production always writes a real timestamp.

## N. Artefacts

| Artefact | Path |
| --- | --- |
| EXT-C evidence DB (pass 1 + repeat) | `data/pilot/evidence/pilot-people-2026-09-27-ext-c-pass1.db` |
| EXT-B baseline DB (untouched) | `data/pilot/evidence/pilot-people-2026-09-27-ext-b-seed-first.db` |
| Pass 1 report | `data/pilot/pilot-people-report-ext-c-pass1.json` |
| Repeat report | `data/pilot/pilot-people-report-ext-c-repeat.json` |
| EXT-B baseline report | `data/pilot/pilot-people-report-ext-b-baseline.json` |
| Plausibility fixtures | `scripts/smoke-people-plausibility.ts` |
| Idempotency fixtures | `scripts/smoke-people-idempotency.ts` |

The DB file name says `pass1` because it was created by the first pass and the repeat pass ran
against that same file, which is the point: the repeat re-ingested into the existing evidence.
`scripts/run-pilot-people.ts` now seeds the DB when the `--db` path does not exist yet; previously a
`--db` path was assumed to be pre-seeded, so pointing it at a missing file produced a table-less DB
that failed mid-run. Pass 1 is reproducible from a clean checkout with
`npx tsx scripts/run-pilot-people.ts --db <path>`, then
`npx tsx scripts/run-pilot-people.ts --repeat --db <path>`.

## O. Next step

Both EXT-C gates pass. Per the milestone definition the next step is a decision, not more code:

1. Review this report and the uncommitted EXT-B + EXT-C diff, then decide whether to commit.
2. Only then consider M3.4. M3.4 was **not** started here.
3. Before any promotion above `UNVERIFIED`, the 64 open conflicts and the 205 held staff entries
   need a human review path; neither is resolved by this milestone.

## Out of scope, unchanged

- Branch/personnel records, postal addresses, phone numbers, email addresses, social profiles.
- AI/LLM, OCR, headless browser, JS rendering, login, third-party personnel pages.
- Auto-promotion of assertions above `UNVERIFIED`, review thresholds, conflict resolution.
- `schema/schema.sql`, infrastructure, production budgets.

---

# FINAL REVIEW — M3.3

**Review date:** 2026-09-27 · **Milestone:** M3.3-GENERIC-EXT-C · **Commit status: NOT COMMITTED**
**M3.4 has NOT started.** No new extraction feature, no schema change, no budget change was made
during this review.

## 1. Universe provenance decision — DECISION B (no Mid-August evidence)

**The universe is backed by `nrb-bfi-mid-may-2026`. Mid-August 2026 freshness was NOT
independently established. The 51-institution universe must be described as a May-2026 verified
snapshot, not an August-2026 current snapshot.** This is a data-freshness limitation, not an
extraction or parser failure. **No provenance field was altered.**

What the repository actually contains:

| Fact | Evidence |
| --- | --- |
| Universe snapshot identity | `data/master/master.json` → `universeSnapshot.source_id = "nrb-bfi-mid-may-2026"`, `title = "NRB BFI list (English, mid-May 2026)"`, `observed_at = "2026-06-20"` |
| Universe counts | 51 institutions, 120 aliases, 51 official_links, 62 timeline, 11 sources |
| The backing source is a real defined NRB record | `data/master/master.json:3516` — id `nrb-bfi-mid-may-2026`, url `https://www.nrb.org.np/bfr/bfis-list-in-english-mid-may-2026/`, publisher `Nepal Rastra Bank`, scope `NRB`, grade `A` |
| Every pilot source inherits it | all 51 rows in `data/pilot/pilot-sources.json` carry `proven_by: "nrb-bfi-mid-may-2026"`; 1216 references repo-wide |
| NRB evidence run predates any August list | `data/nrb/nrb-ledger-report.json` → `observedAt: "2026-06-20"`, 97 documents, 7 sources all with snapshot ancestry, `name_matched_links: 0` (no institution was ever matched to an NRB document by name) |

A Mid-August 2026 list **is referenced** in the repository, but only as a link-catalogue row in the
UI data module `src/data/nrb.ts:598-606` (id `nrb-doc-29fb23f0`, title "BFI's List in English
(Mid Aug 2026)", url `https://www.nrb.org.np/bfr/bfis-list-in-english-mid-aug-2026/`, size 90.47 kb,
`sourceId: nrb-bfi-archive`). It was **not** usable as provenance:

- **No content was ever fetched.** 0 rows matching `mid-aug` exist in `source_snapshots`,
  `nrb_documents`, `outbound_links`, `sources` or `ingestion_sources` in **any** of the 5 evidence
  DBs, so it has no snapshot ancestry.
- **No institution list was extracted from it**, so nothing demonstrates that the same 51
  institutions — or their official website URLs — are the ones it names.
- **It is not a registered source.** No `mid-aug` record exists in `data/master/master.json` or
  `data/nrb/nrb-sources.json`.
- **`publishedAt` is a crawl date, not a content observation.** The row reads `2026-09-18`, and the
  *Mid July 2026* list reads `2026-08-26` — a consistent ~1-month lag showing `publishedAt` records
  when the archive page was captured, not when the BFI list was observed.

Consequence: rewriting `proven_by` to a Mid-August identifier would assert that the 51
institution→website mappings were proven by a document the project never fetched, from which it
extracted nothing. That is exactly the "change `proven_by` to make the report look current" failure
the review forbids, so the May provenance stands unchanged and is now stated explicitly instead of
being left ambiguous.

One distinction worth keeping: the pilot **did** independently re-verify the 51 institutions' live
pages on 2026-09-27 (44 snapshots with content hashes, 41 seed URLs verified by controlled fetch).
That is fresh evidence that the *May-listed URLs are reachable and unchanged*, which is **not** the
same claim as "the universe membership is current as of August 2026". No August membership claim is
made anywhere in this report.

## 2. EXT-C1 — plausibility: PASS

| Gate | Measurement | Result |
| --- | --- | --- |
| No org/company/department/heading/notice/press-release false people | 0 of 91 assertions match `Ltd/Pvt/Bank/Ministry/Department/Branch/Board of/Committee/Press Release/Notice/Total/Office/Google/Portal/Report` | **PASS** |
| Staff-directory pages yield evidence, never leadership assertions | `nationalmicrofinance-website`: 205 entries held as non-asserting `TEXT` evidence, 4 leadership assertions | **PASS** |
| Real leadership people remain extractable | 91 assertions, 9 sources, 4 role fields (41 director, 21 CEO, 21 board, 8 chair) | **PASS** |
| 0 real leadership people lost | see accounting below | **PASS** |

Loss accounting against EXT-B's 384 assertions: **52** non-person values rejected by the stricter
name test, **205** name-shaped values correctly suppressed (203 `nationalmicrofinance` staff entries
+ 2 `samata` footer/social links), **0** real leadership people lost. Staff suppression is driven by
population and the role text read on the page — no institution-specific rule (verified: no source
id, institution slug or `.np` domain literal exists in `lib/ingestion/people.ts`).

## 3. EXT-C2 — semantic idempotency: PASS

| Gate | Measurement | Result |
| --- | --- | --- |
| Repeat does not duplicate a claim because a new snapshot exists | pass 1 → repeat: assertions **91 → 91**, distinct people **89 → 89**; duplicate `(entity, field, value)` groups **29 → 0** | **PASS** |
| Old snapshots preserved | 42 snapshots after pass 1 + 2 new = **44 retained**; nothing deleted, re-pointed or overwritten | **PASS** |
| Genuine person/role change stays detectable | identity is `(entity_type, entity_id, field_name, normalized value)`, so a changed value is a new row and a changed role is a new `field_name`; proven by fixture cases D and E (old claim retained) | **PASS** |
| Cross-source claims independently attributable | one semantic claim per (entity, field, value), with each sighting's source/snapshot recorded; 91/91 assertions resolve to 9 distinct institutions | **PASS** |
| No schema change | `git diff -- schema/` is empty | **PASS** |

Deduplication cannot hide historical change: it is keyed on the *value*, so nothing is ever merged
across differing values or roles, and every additional sighting is written to the existing
`audit_logs` table with source, snapshot, time, confidence and status.

## 4. Provenance result: PASS

| Check | Measurement |
| --- | --- |
| Assertion → snapshot → source → institution chain | **91/91** resolve end-to-end |
| Orphan assertions | **0** |
| Parser provenance | all **44** snapshots = `people-html-v2` (bumped from `v1`; `people-json-v2` for JSON) |
| Snapshot completeness | 0 snapshots missing `content_hash`, `mime_type` or `fetched_at` |
| Verification status | 91/91 `UNVERIFIED`; 0 auto-promoted |
| Conflicts | 64, **all `OPEN`** — none resolved or hidden |
| Historical evidence | EXT-B baseline DB untouched; `pilot-people-report-ext-b-baseline.json` preserved |

## 5. Security / budget: PASS

| Check | Result |
| --- | --- |
| Security suite | `smoke:ingest-security` green |
| Production crawl budget | `data/pilot/pilot-budget.json` unmodified; no budget file in `git status` |
| Browser / JS rendering | none — no playwright/puppeteer/render call added |
| AI / LLM | none — no provider, prompt or model call added |
| OCR | none |
| Institution-specific selectors | none — verified by literal scan of `lib/ingestion/people.ts` |
| Production D1 / infrastructure | untouched — no `wrangler`, `functions/` or `.dev.vars` change |

## 6. Regression result: PASS

`npx tsc --noEmit` exit 0 · 17/17 suites green · `next build` success. People unit/fixture, M3.3
generic extension, plausibility (30/30), idempotency (33/33), discovery (45/45), API (36/36), data
API (42/42), ingestion, ingestion-security, structured, PDF/canonical, schedule (40/40), compare
(27/27), alerts (18/18), worker, discipline — all pass. 283 People checks in total.
`npm run lint` retains the pre-existing 14 errors / 54 warnings; **no new lint failure was
introduced and no legacy lint failure was modified.**

## 7. Schema status

`schema/schema.sql` **unchanged** — `git diff -- schema/` is empty. EXT-C added no table, column or
index. The staff-directory signal reuses the existing `validation_rules` / `validation_results`
tables, and re-sighting provenance reuses the existing `audit_logs` table (`audit_logs` already
exists in the canonical schema at `schema/schema.sql:840`).

## 8. Remaining limitations

1. **Universe freshness (data, not code).** The 51-institution universe is a **May-2026** verified
   snapshot, observed 2026-06-20. Mid-August 2026 membership was not established. Institutions
   licensed, merged or added by NRB after May 2026 are absent from scope. A genuine Mid-August list
   must be ingested and reconciled through the normal evidence path before any current-snapshot
   claim is made.
2. **`ASSERTION_RESEEN` proven by fixture, not by the pilot.** 40 of 42 pages were
   canonical-unchanged and the 2 that changed carried no people claims, so no re-sighting occurred
   in this run. Cases C and F prove the mechanism (including independent-source provenance).
3. **Staff-directory threshold is a fixed pair** (≥12 entries, leadership ratio < 0.34). Justified
   empirically by the one staff directory in this universe; a staff page with <12 entries would
   still be asserted, and a governance page whose designations are all unrecognised could be
   suppressed. The `PENDING` future-candidate signal keeps the latter recoverable, not invisible.
4. **Role precision is bounded by the vocabulary.** Genuine designations outside it land in the
   generic `people_board` field with `roleText` preserved rather than a specific field.
5. **64 open conflicts** and **205 held staff entries** still need a human review path; neither is
   resolved by this milestone, and nothing was auto-promoted above `UNVERIFIED`.
6. **`data/pilot/pilot-sources.json` `proven_by` remains `nrb-bfi-mid-may-2026`** — deliberately
   unchanged, now documented rather than silently ambiguous.

## 9. Final M3.3 gate result

| Gate | Result |
| --- | --- |
| Plausibility | **PASS** — 0/89 distinct values are non-people (EXT-B: 47/341) |
| Semantic idempotency | **PASS** — 0 duplicate groups (EXT-B: 29) |
| Provenance | **PASS** — 91/91 traceable, 0 orphans, `people-html-v2` |
| Security / budget | **PASS** — unchanged, no new capability |
| Schema | **PASS** — unchanged |
| Regression | **PASS** — 17/17 suites, tsc, build |
| Universe provenance | **LIMITED** — May-2026 snapshot; August-2026 freshness not established |

**M3.3 is complete on its own terms, with one declared data-freshness limitation.** M3.4 has not
started. Nothing has been committed; awaiting explicit approval.