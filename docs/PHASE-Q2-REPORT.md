# Phase Q2 — Controlled 5 → 10 MFB Validation

Status: **COMPLETE** (verdict: generic engine scales 5→10; no implementation defect found; no schema change required)
Phase: Q2 `controlled-expansion` | DB: `<scratch-review-db>`
Principle: small generic improvement + test + evidence over special-case workarounds; **nothing committed** without explicit approval.

---

## A. Q1 baseline verification (green before Q2 work)

Full Q1 gate re-run and confirmed green at the start of Q2:

| check | result |
|---|---|
| `check:discipline` | OK |
| `typecheck` (`tsc --noEmit`) | 0 errors |
| `smoke` | PASS |
| `smoke:worker` | PASS |
| `smoke:ingest` | 54/54 fixtures (incl. S09 empty-config cases, TEST 10 validators, TEST 11 document budget) |
| `smoke:ingest-security` | 50/50 |
| `smoke:pdf-canonical` | 25/25 |
| `build` (Next.js static export) | Compiled successfully |

Q1 implementation (PDF/document evidence path + canonical change detection + validation rules + hardened fetcher policy) present and untouched. No regression observed.

## B. 10-MFB source population

5 baseline sources + 5 new sources, all from NRB BFI canonical records (`data/master/master.json`), all described purely through capability configuration — **no per-institution crawler code** in this phase or any prior phase.

| source id | institution | URL | added |
|---|---|---|---|
| nirdhan-website | mfi-001 | https://www.nirdhan.com.np | baseline |
| chhimek-website | mfi-003 | https://www.chhimekbank.org | baseline |
| mero-website | mfi-020 | https://www.meromicrofinance.com | baseline |
| matribhumi-website | mfi-047 | https://matribhumimf.com.np | baseline |
| infinity-website | mfi-034 | https://infinitylbsl.com.np | baseline |
| aarambha-website | mfi-030 | https://www.aarambhachautari.com | **Q2** |
| aatmanirbhar-website | mfi-049 | https://aatmanirbhar.com.np | **Q2** |
| asha-website | mfi-031 | https://ashamicrofinance.com.np | **Q2** |
| aviyan-website | mfi-051 | https://www.aviyanlaghubitta.com | **Q2** |
| cyc-website | mfi-043 | https://cycnlbsl.org.np | **Q2** |

Each source record declares the same generic capability template (`WEBSITE` with `known_url`, plus `REPORTS`/`NEWS`/`BRANCH_DIRECTORY`/`CAREER_PAGE`/`DOCUMENT_ARCHIVE`/`SITEMAP` discovery intents). Selection was deliberate diversity, not random: plain HTML, a WordPress site serving XML sitemaps, an HTML+PDF mix, a JS-rendered single-page site, high-link-count sites, and a slower site.

## C. Capability matrix (by source, configuration-described)

| source | HTML | PDF / doc evidence | HTML+XML | dynamic content | doc links | many URLs/sensitive | redirect | cross-domain/subdomain | budget-sensitive |
|---|---|---|---|---|---|---|---|---|---|
| nirdhan | yes (10 HTML) | – | – | yes | – | yes (11 urls) | – | – | fetch cap |
| chhimek | yes (10 HTML) | report-link kinds | – | – | yes (document cap hit) | – | – | – | fetch+document cap |
| mero | yes (4 HTML) | – | – | – | – | – | www↔apex | – | – |
| matribhumi | yes (7+1 HTML) | **yes — official notice PDF** | – | – | 1 DOCUMENT link | – | – | subdomain (career) | – |
| infinity | yes (1 HTML) | – | – | minimal | – | – | – | – | – |
| aarambha | yes (10 HTML) | – | – | – | – | yes (13 urls) | – | – | fetch cap |
| aatmanirbhar | yes (10 HTML) | – | – | **yes — live churn** | – | yes (16 urls) | – | – | fetch cap |
| asha | yes (10 HTML) | – | – | – | – | yes (18 urls) | – | – | fetch cap |
| aviyan | **empty body (JS SPA)** | – | – | yes — nothing rendered server-side | – | – | – | – | – |
| cyc | yes (1+ HTML) | WordPress wp-sitemap XML | **yes** | – | 8 DOCUMENT links | yes (16 urls) | – | – | fetch cap |

Every capability is expressed in `pilot-sources.json`; the engine dispatches automatically. No `NirdhanCrawler`-style classes exist.

## D. S09: empty `config_json` validation

Already fixture-tested (5 cases) and handling is correct — **no modification made**:
- `{}` (empty object) → `parseCapabilities([])`, zero declared capabilities, source stays `enabled=true`, discovery yields zero targets (no accidental disable, no misclassification).
- malformed JSON / non-object → typed `CapabilityConfigError`.
- Non-empty valid config → capabilities parsed and applied.

## E. First 10-MFB run (single run, fresh scratch DB)

| Institution | Sources | Items | Changed | Unchanged | Failed | PDFs | Snapshots | Errors | Fetch failures |
|---|---|---|---|---|---|---|---|---|---|
| mfi-001 nirdhan | nirdhan-website | 10 | 10 | 0 | 0 | 0 | 10 | 0 | 0 |
| mfi-003 chhimek | chhimek-website | 10 | 10 | 0 | 0 | 0 | 10 | 0 | 0 |
| mfi-020 mero | mero-website | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| mfi-047 matribhumi | matribhumi-website | 10 | 9 | 0 | 1 | 1 | 9 | 1 | 0 |
| mfi-034 infinity | infinity-website | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| mfi-030 aarambha | aarambha-website | 10 | 10 | 0 | 0 | 0 | 10 | 0 | 0 |
| mfi-049 aatmanirbhar | aatmanirbhar-website | 10 | 10 | 0 | 0 | 0 | 10 | 0 | 0 |
| mfi-031 asha | asha-website | 10 | 10 | 0 | 0 | 0 | 10 | 0 | 0 |
| mfi-051 aviyan | aviyan-website | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| mfi-043 cyc | cyc-website | 10 | 10 | 0 | 0 | 0 | 10 | 0 | 0 |
| **Total** | **10** | **76** | **75** | **0** | **1** | **1** | **75** | **1** | **0** |

Single failure = matribhumi `/notices` HTTP 404 (site bug, see M). Insight: no budget was raised; caps engaged for six sources (see K).

## F. Repeat run (same config, fresh scratch DB, immediate re-run)

| Institution | Changed | Unchanged | New snapshots | Duplicate snapshots |
|---|---|---|---|---|
| mfi-001 nirdhan | 2 | 8 | 2 | 0 |
| mfi-003 chhimek | 0 | 10 | 0 | 0 |
| mfi-020 mero | 0 | 4 | 0 | 0 |
| mfi-047 matribhumi | 0 | 9 | 0 | 0 |
| mfi-034 infinity | 0 | 1 | 0 | 0 |
| mfi-030 aarambha | 0 | 10 | 0 | 0 |
| mfi-049 aatmanirbhar | 10 | 0 | 10 | 0 |
| mfi-031 asha | 0 | 10 | 0 | 0 |
| mfi-051 aviyan | 0 | 1 | 0 | 0 |
| mfi-043 cyc | 1 | 9 | 1 | 0 |
| **Total** | **13** | **62** | **13** | **0** |

Interpretation (genuine change vs noise):
- **nirdhan** `/career` and `/contact` — genuinely changed text (public-facing content updated between runs). This is real change detection; old snapshots retained, new evidence appended.
- **aatmanirbhar** — every page reports CHANGED on every run. These are live/dynamic pages whose responses differ beyond the 9 canonicalization rules (rendered counters, dates, ordering churn). The canonicalizer is intentionally conservative: it never masks; a spurious CHANGED is reported rather than a false UNCHANGED. This is a source-characteristic, not an engine defect; flagged for an optional future diff/render refinement (see M, O). Note the flow is safe: repeat runs only append distinct evidence (20 distinct snapshots), zero duplicate snapshots.
- **cyc** `/annual-report` — first run `FETCH_FAILED` (transient `CONNECT_FAILED`, retries=0 — external connect failure), second run recovered; the new page is appending evidence (a real change: new evidence surfaced).
- Everything else — clean UNCHANGED: canonical hash stable, no duplicate snapshot, no duplicate link.

## G. PDF / document evidence

- **matribhumi** official notice PDF (`storage/notices/01M31DVW8MF1D5NKWR6A8Y4XY9.pdf`): discovered from a notice link, fetched via content-type dispatch, snapshot `extraction_status=SKIPPED` (no OCR/AI — by design), and one `outbound_links` row `target_type=DOCUMENT` with raw content hash (`2575737c8db0…`), availability `AVAILABLE`, first/last seen, and institution/source provenance.
- Repeat: identical bytes → identical hash → **no duplicate snapshot, no duplicate link row** (unchanged evidence).
- Changed-version semantics (Q1, re-verified in `smoke:pdf-canonical` 25/25): a new edition appends a new snapshot and refreshes the single DOCUMENT link row hash; **old snapshot evidence is never overwritten**.
- **cyc** XML evidence: 8 `wp-sitemap-*.xml` pages (WordPress) classified via the generic non-HTML path as `DOCUMENT` outbound links (`inst=mfi-043`, `scope=mfi-043`, full provenance). This is evidence, not a typed `documents` catalog entry — consistent with the frozen-schema boundary from Q1 (bare fetches never enter `documents`).
- Application/PDF mime tracking: matribhumi `last mime = application/pdf`, `extraction = SKIPPED`, `docs = 1` in the health view.

## H. Canonicalization

| behavior | result |
|---|---|
| benign churn (timestamps, whitespace, script/style/comment, tracking attrs) | **UNCHANGED** — 9 of 10 sources stable across repeat |
| substantive change | **CHANGED** — nirdhan career/contact; aatmanirbhar live churn |
| false-UNCHANGED of meaningful content | none — directional guarantee is conservative (mask nothing) |
| empty JS-rendered body (aviyan) | hash stable (SHA-256 of empty input) → UNCHANGED; nothing extractable server-side |
| PDF same bytes | UNCHANGED, no duplicate snapshot/link |
| new evidence (cyc annual-report recovered) | CHANGED → appended, old evidence retained |

## I. Provenance (source → item → snapshot → outbound document)

- Verified joins on the repeat DB: `ingestion_items`→`ingestion_runs`, `source_snapshots`→`ingestion_sources`, `data_assertions`→`source_snapshots`, `validation_results`→`source_snapshots` — **0 orphans in every relationship**.
- DOCUMENT outbound links carry `institution_id`, `source_id`, `scope`, `target_url`, `availability_status`, raw `content_hash`, `first_seen_at`, `last_checked_at`, `slug` — populated for all 9 rows (cyc 8 XML + matribhumi 1 PDF).
- Audit trail: all 10 sources show the request→completion chain (q14 = 5/6 audit actions each).
- `validation_results` attached to snapshots (q12 rows: nirdhan 24, chhimek 20, mero 8, matribhumi 16, infinity 2, aarambha 20, aatmanirbhar 40, asha 20, aviyan 2, cyc 4).
- Only q11 gap: **aviyan** has 0 field assertions — its page body is empty (JS SPA), so extraction yields nothing to assert. Evidence (snapshot + hash) is still recorded and traceable; this is a source characteristic, not provenance loss.

## J. Security

- `smoke:ingest-security` **50/50** — unchanged from Q1; SSRF (DNS + IP checks, IPv4-mapped/hex/octal/decimal/link-local/loopback rejection), HTTPS-only, allowlist enforcement, redirect bounding, budget caps, retries; no `eval`/`new Function`.
- Cross-domain/subdomain hardening under test (S12): `allowSubdomainsOf` widens to the same registrable domain only — `career.matribhumimf.com.np` was admitted because it is a subdomain of the allowlisted `matribhumimf.com.np`; genuinely foreign registrants remain rejected.
- `check:discipline` OK (no credentials/banned constructs); no bypass added for any source.

## K. Performance / resource

- Runs: 10 sources × 2 (single + repeat) = 20 runs into one scratch DB.
- Fetched attempts: 76 (single) / 152 across the cycle; fetch failures: 0 in both (the single error is an HTTP 404, not a fetch failure).
- Snapshots: 75 after run 1, **87 cumulative** (13 appended by the repeat); duplicate snapshot groups: **0** DB-wide.
- Wall time per source (ms, run1 / run2): nirdhan 13087/11227 · chhimek 4019/3610 · mero 3175/2904 · matribhumi 4714/4619 · infinity 668/489 · aarambha 18247/8094 · aatmanirbhar 6581/6688 · asha 8297/7468 · aviyan 703/493 · cyc 27648/17678.
- Timeouts: none blocking (chhimek later-run timeouts are historical; recovered). Retries: 0 recorded across the cycle except chhimek history; cyc `CONNECT_FAILED` external, recovered next run.
- **Budget exhaustion (all audited, none raised)**: `BUDGET_FETCHES_EXHAUSTED` fired for nirdhan, chhimek, aarambha, aatmanirbhar, asha, cyc (discovered > 10; capped at default maxFetches 10); `BUDGET_DOCUMENTS_EXHAUSTED` fired for chhimek (document cap 5). Budgets stayed at defaults — no relaxation to pass.

## L. Schema (frozen)

No DDL changed. No genuine limitation surfaced in Q2:
- PDF/XML evidence fits `outbound_links` + `source_snapshots` (as in Q1); `documents` catalog intentionally unused for bare fetches (NOT NULL `category` FK into an empty `document_categories` vocabulary + NOT NULL `title`/`published_at` are not derivable without parsing/OCR/fabrication).
- The only semantic blurred line — WordPress `wp-sitemap-*.xml` registered as `DOCUMENT` links — is a classification refinement, not a relationship the schema cannot express. SQlite schema unchanged.

## M. Operational issues (taxonomy)

**Implementation defects:** none identified. All observed anomalies are source-side or by-design.
**Source-side:**
- aatmanirbhar: live/dynamic pages churn on every fetch (0/10 unchanged) — conservative engine reports CHANGED; no evidence loss.
- aviyan: empty server-rendered body (JS SPA) — stable but nothing extractable; 0 assertions.
- cyc: transient `CONNECT_FAILED` on /annual-report (recovered on repeat).
- matribhumi: `/notices` HTTP 404 both runs; template-literal links `%7B...%7D` 404 (site bug, typed as HTTP_ERROR).
**External:** none (no new infrastructure used).
**Configuration:** BUDGET caps engaged for six sources (fetch) and one (document) — bounds enforced at defaults.
**Expected limitations:** dynamic JS content without a browser render yields empty evidence; canonicalizer is conservative on live churn (never masks).

## N. Q2 gate (factual gates, no scoring)

| # | gate | result |
|---|---|---|
| 1 | 10 institutions reached | **PASS** — 10 sources, 20 runs, 87 snapshots |
| 2 | generic engine used, no per-institution crawler | **PASS** — config-described capabilities only |
| 3 | PDF evidence works (fetched, hashed, snapshotted, linked) | **PASS** — matribhumi notice PDF |
| 4 | canonical repeat detection (noise → UNCHANGED) | **PASS** — 62/75 repeat items UNCHANGED |
| 5 | changed content detected | **PASS** — nirdhan career/contact; aatmanirbhar churn; cyc recovered page |
| 6 | old evidence preserved on change | **PASS** — 13 new snapshots appended; historical rows untouched |
| 7 | provenance complete | **PASS** — 0 orphans; all DOCUMENT links attributed; aviyan gap is empty content, not provenance |
| 8 | duplicate snapshots controlled | **PASS** — 0 duplicate-hash groups |
| 9 | security unchanged | **PASS** — 50/50 security suite + discipline |
| 10 | budgets enforced (no silent increase) | **PASS** — cap audits logged; defaults kept |
| 11 | audit trail complete | **PASS** — q14 5/6 actions for all 10 sources |
| 12 | schema unchanged | **PASS** — no DDL |
| 13 | Q1 tests remain green | **PASS** — full gate re-run (Section A) |

No hard-stop condition triggered.

## O. Recommendation for the next phase

- **Do not auto-expand beyond 10.** The evidence supports a further controlled population test (e.g., 10→20) since the engine handled diverse capabilities generically, but expansion should remain an explicit, gated decision.
- **Prerequisite for any next expansion:** commit the Q1 checkpoint + hardening surface (awaiting approval), since all phase work is still uncommitted.
- **Unresolved source class (defer explicitly):** JS-rendered SPAs (aviyan) produce empty server-side evidence. Making them useful requires headless/browser rendering — that is new infrastructure and out of scope by STEP 9. The recommendation is to record aviyan as an unresolved class rather than special-case a crawler.
- **Optional refinement (not required for the gate):** a live-diff of aatmanirbhar's churn would confirm it is churn vs real updates, but would require storing raw bodies (currently `r2Key=null` in the scratch pilot) — future-work, not a Q2 blocker.

## P. Proposed checkpoint commit(s) — DO NOT COMMIT without approval

Q2 itself required **no implementation code changes** (only 5 config source records; temporary probe scripts were created during verification and removed).

Proposed commits (both currently uncommitted, awaiting explicit approval):
1. `feat: add PDF evidence path and canonical change detection` — first Q1 checkpoint as instructed.
2. `feat: add validation rules and hardened fetcher policy` — pre-Q2 hardening (built and verified in this repo; nothing reverted).

If the user prefers a single atomic checkpoint, that is the user's call. This report and all artifacts remain uncommitted.