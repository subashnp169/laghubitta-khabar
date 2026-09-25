# Phase Q — Engineering Report: Controlled Evidence Ingestion Pilot

Status: **COMPLETE** · Date: 2026-09-24 · Verdict: **Pipeline is real,
evidence-safe, and the pilot blockers (PDF documents, canonical change
detection, live validation, cross-subdomain capability pages, document budget)
are all closed. Schema remains frozen. 5 → 10 expansion is justified — pending
an explicit checkpoint commit.**

This report covers Phases N (fixture acceptance), O (Controlled Evidence
Ingestion Pilot), P (security), Q1 (PDF/document evidence + deterministic HTML
canonicalisation for change detection), and Q2 hardening (deterministic
validation rules, fetcher allowSubdomainsOf policy, document-budget proof).

---

## A. What was implemented

A **generic, configuration-driven ingestion engine** with a **controlled fetcher**,
proven against five real Nepalese microfinance bank (MFB) websites through a bounded
pilot that wrote every piece of evidence into a **scratch review DB** (never the
canonical `lk.db`, never the public site).

- **Pipeline** (single generic path, zero per-institution code):
  `Source → Controlled Fetch → Evidence/Snapshot → Change detection → Discovery → Extraction → Validation → Assertion(UNVERIFIED)`.
- **ControlledFetcher** — HTTPS-only, host allowlist + DNS-resolved check of **every**
  resolved address, redirect re-validation, size/time budget, retry/backoff, content-type
  guard. `PRIVATE_V4_RANGES` corrected (a real bug the pilot's security suite found).
- **Deterministic capability contract** — `config_json.capabilities` is authoritative;
  `enabled` is the only disable switch; `'{}'` means *zero* capabilities (never
  "all"); malformed config throws `CapabilityConfigError` — never silently accepted.
- **Crawl budget** — `maxTargets/maxFetches/maxDocuments/maxBytes/maxRedirects/
  maxRetries/maxRuntimeMs`, config-driven, audited when exhausted (`BUDGET_*_EXHAUSTED`).
- **Evidence-first ordering** — snapshot is written **before** extraction so extraction
  failure never loses evidence; snapshot `extraction_status` moves PENDING→EXTRACTED (or
  FAILED) so state is honest; PDFs are written as SKIPPED (no OCR/AI ever runs).
- **Idempotency** — same source+url+**canonical** hash → UNCHANGED, no duplicate snapshot
  (see Q1 change detection below).
- **Per-run URL dedup** — duplicate discovered URLs no longer double-fetch/double-snapshot.

### Q1a — PDF/document evidence path (V1, minimal)

- Fetch is no longer HTML-gated at the engine: content-type detection happens on the real
  response. `application/pdf` (and any non-HTML) is **document evidence**:
  - `source_snapshots` records the raw bytes hash + `mime_type=application/pdf` +
    `http_status` + `fetched_at` with `extraction_status=SKIPPED` (no OCR, no AI).
  - `outbound_links` gets one `target_type=DOCUMENT` row (`UNIQUE(scope_key,slug)`) with
    `target_url`, `content_hash` (raw), `availability_status`, `first_seen_at` /
    `last_checked_at`, `source_id`, `institution_id` — the durable link-first document
    record + provenance.
  - Change detection is identical to HTML: PDF-A → CHANGED + snapshot; PDF-A again →
    UNCHANGED (no duplicate snapshot, no duplicate link); PDF-B → CHANGED + new snapshot
    appended while the old snapshot row is **never touched**; the single DOCUMENT link row
    is refreshed to the new hash.
  - No per-institution code; no OCR; no fabricated title/date.

### Q1b — Deterministic HTML canonicalisation (change detection ONLY)

- `lib/ingestion/canonical.ts` — pure, total, byte→byte canonical form: line endings → LF,
  comments/`<script>`/`<style>` stripped (dynamic, non-content), block tags → single space
  (re-wrapping is formatting noise), remaining tags stripped (attributes gone — tracking
  params are formatting), common entities decoded, whitespace collapsed.
- **Raw evidence is never replaced**: snapshots and `outbound_links` carry the raw hash;
  only the change-detection comparison (`ingestion_items.content_hash`) is canonical.
- Deliberate conservative non-rules: visible dates/timestamps, case, digits (rates,
  amounts) are preserved — a spurious CHANGED is preferred over ever masking a real change.
- Non-HTML (PDF): canonical form = raw bytes (document identity is its content hash).

### Q2a — Deterministic validation rules (Phase I made real)

- `lib/ingestion/validators.ts` — generic, evidence-driven rules, never AI:
  `titlePresentValidator` (r-pilot-title) and `emailFormatValidator` (r-pilot-email).
- The engine runs `deps.validators` AFTER extraction and BEFORE assertion, attaching
  results to the source snapshot; a throwing rule degrades to a recorded FAIL and never
  stalls the run. `validation_results` rows now exist (q12 PASS).

### Q2b — allowSubdomainsOf fetcher-policy knob

- `FetcherPolicy.allowSubdomainsOf` — a source-admin-declared registered domain whose
  subdomains (career.<site>, www2.<site>, …) become fetchable. HTTPS, port, credentials,
  DNS-verified public-IP, redirect re-validation, and budget checks are UNCHANGED on every
  subdomain; unrelated hosts stay blocked. Resolves the matribhumi career-subdomain
  `FetcherPolicyError` without per-MFB code.

### Q2c — Document budget proven at scale (TEST 11)

- `maxDocuments` caps DOCUMENT_ARCHIVE/REPORTS processing; exhaustion is audited
  (`BUDGET_DOCUMENTS_EXHAUSTED`) and non-doc targets still process after the cap. PDFs
  under a capped capability write DOCUMENT links + SKIPPED snapshots only for the
  processed targets.

## B. Files changed this phase

| File | Change |
|---|---|
| `lib/ingestion/canonical.ts` | **new** — `deterministicHtmlCanonicalizer`, `canonicalizeHtml`, `createSha256Hex` |
| `lib/ingestion/engine.ts` | content-type dispatch; canonical change-detection; document-evidence path (`saveOutboundLink`, SKIPPED extraction); `documentSlug` |
| `lib/ingestion/contract.ts` | `Canonicalizer`; `EngineDeps.canonicalizer`; `OutboundLinkInput`; `EvidenceWriter.saveOutboundLink` |
| `lib/ingestion/adapters/local.ts` | `saveOutboundLink` (INSERT OR IGNORE on UNIQUE(scope_key,slug) + hash refresh on new version) |
| `lib/ingestion/index.ts` | export canonical module |
| `scripts/smoke-pdf-canonical.ts` | **new** — 25 fixtures: canonicalisation matrix (8) + PDF change detection (12) + canonical change detection (5) |
| `scripts/run-pilot.ts` | wired `deterministicHtmlCanonicalizer` into pilot engine deps |
| `scripts/pilot-evidence-report.ts` | docs column; before/after change-detection table; updated conditions log |
| `data/pilot/pilot-run-report.json` | machine-readable run reports (fresh scratch DB) |
| `package.json` | `smoke:pdf-canonical` script |
| `schema/schema.sql`, `migrations/` | **UNCHANGED** (frozen) |

## C. What was tested

- **Phase N fixtures** (`npm run smoke:ingest`): **54/54** — 44 original + TEST 10
  (validators run post-extraction, PASS/FAIL persist attached to the snapshot) +
  TEST 11 (document budget: `maxDocuments` caps DOCUMENT_ARCHIVE PDFs, pdf path
  writes DOCUMENT link + SKIPPED snapshot, non-doc NEWS targets still processed
  after the cap).
- **Phase P security** (`npm run smoke:ingest-security`): **50/50** — 46 original
  + S12 (allowSubdomainsOf: subdomain of a registered domain allowed, apex
  allowed, unrelated host blocked, strict default preserved).
- **Phase Q1** (`npm run smoke:pdf-canonical`): **25/25** — new:
  whitespace-only/CRLF/formatting-only/tracking-attr/script-style-comment → `UNCHANGED`
  (same canonical hash); title / interest-rate (10%→11%) / notice-text changes → `CHANGED`;
  PDF-A → CHANGED + SKIPPED snapshot + DOCUMENT link; PDF-A again → UNCHANGED no dups;
  PDF-B → CHANGED + old snapshot preserved + one refreshed link; HTML re-run with only
  noise → UNCHANGED with 1 snapshot; items hold canonical (not raw) comparison hash.
- **Integration smoke**: `smoke` (API), `smoke:worker` (Worker routes), seed integrity
  (idempotent, 0 orphans), `check:discipline`, `tsc --noEmit`, `npm run build`.
- **Pilot** (`npm run pilot`, `pilot:repeat`): real network against 5 MFBs, twice each.

## D. Test result summary

```
tsc --noEmit            PASS
check:discipline        PASS (no violations in committed source)
seed                    PASS (idempotent; 0 orphans)
smoke (API)             PASS (all checks)
smoke:worker            PASS (all checks)
smoke:ingest (N)        54 ok / 0 fail
smoke:ingest-security (P) 50 ok / 0 fail
smoke:pdf-canonical (Q1) 25 ok / 0 fail
npm run build           PASS
pilot                   PASS (5 sources reached; evidence written)
pilot:repeat            PASS (canonical idempotency; no duplicate evidence)
pilot:report            PASS (15/15 questions PASS/NA; no FAIL)
```

## E. 5-MFB pilot results (post-Q1, `--repeat`)

| source | inst | snapshots | items | changed | unchanged | docs | http | mime | extraction |
|---|---|---|---|---|---|---|---|---|---|---|
| nirdhan-website | mfi-001 | 12 | 20 | 12 | 8 | 0 | 200 | text/html | EXTRACTED |
| chhimek-website | mfi-003 | 10 | 20 | 10 | 10 | 0 | 200 | text/html | EXTRACTED |
| mero-website | mfi-020 | 4 | 8 | 4 | 4 | 0 | 200 | text/html | EXTRACTED |
| matribhumi-website | mfi-047 | 9 | 20 | 9 | 9 | **1** | 200 | application/pdf | SKIPPED (PDF) |
| infinity-website | mfi-034 | 1 | 2 | 1 | 1 | 0 | 200 | text/html | EXTRACTED |

All assertions persisted as **UNVERIFIED**. Nothing published.

**Idempotency now works on live pages.** Before Q1, every repeat run reported every item
as CHANGED (0 unchanged) because raw HTML churns. After the canonical compare,
chhimek/mero/matribhumi/infinity are 100% UNCHANGED on re-run and nirdhan is 8/10 — the 2
non-unchanged are substantive live changes (canonical-insensitive), which is exactly the
goal. Proved by fixtures and by a real PDF (`storage/notices/...pdf`) that previously
failed with `expected HTML, got application/pdf` and now ingested as document evidence.

## F. Known issues / limitations found on live data

1. **matribhumi `/notices` → HTTP 404** (page moved/removed, site-side) → typed error,
   run PARTIAL. Correctly surfaced, not an ingestion defect. (The earlier
   `career.matribhumimf.com.np` `FetcherPolicyError` is **resolved**: the fetcher now
   honours `allowSubdomainsOf` — a source-admin-declared registered domain knob — so a
   discovered cross-subdomain capability page is fetched under the same HTTPS/DNS/private-
   IP/budget checks as apex; the career page now ingests and is stable across repeats.)
2. **nirdhan 2/10 pages changed between runs minutes apart** — genuine live updates; the
   canonicalizer intentionally does not erase real content (rates, dates, notices).
3. **`documents` catalog is NOT populated for bare discovered PDFs** — see J. The V1
   document-evidence requirement is fully represented by `outbound_links` + `source_snapshots`.
4. **Emails on non-WEBSITE/NEWS pages are not extracted** (pilot extractor scopes the email
   rule to WEBSITE/NEWS); the validation rules stay generic and evidence-driven, never AI.

## G. Security results (Phase P detail)

All Phase P guarantees are implemented at the **application layer** (not delegated),
so they hold even inside Cloudflare's proxy. Highlights proven by the 50 checks:

- Every resolved address is checked (not just the first); public→private redirect blocked.
- IPv4-mapped IPv6 (`::ffff:127.0.0.1`), decimal/hex/octal IPv4 (incl. mixed) rejected.
- **Real defect found & fixed**: `PRIVATE_V4_RANGES` had corrupted constants
  (e.g. `0x12700000` instead of `0x7f000000`); previously masked by the allowlist.
- Bounded: 5 MB body cap, 15 s timeout (abort-cancelled), 5 redirect hops, 2 retries,
  credential-less request URIs, prompt-injection bytes are inert data (no eval anywhere).
- Least privilege: worker runs on isolated scratch D1; no secrets in source.
- `allowSubdomainsOf`: the allowlist can be widened to a source's registered-domain
  subdomains (career.<site>, …) — HTTPS, port, credentials, DNS-verified public-IP, and
  budget checks still apply on every hop; an unrelated host stays blocked (S12).
- Q1 additions are still guarded: PDFs flow through the same `ControlledFetcher` policy;
  extraction never runs on PDF bytes; canonicalisation is hash-only (raw evidence intact).

## H. Evidence / provenance / auditability

- Every assertion links `source_id` + `source_snapshot_id` + `observed_at` (provenance).
- **Document evidence** carries provenance in `outbound_links`: `source_id`,
  `institution_id`, `target_url`, `canonical_url`, raw `content_hash`, `first_seen_at` /
  `last_checked_at`, `availability_status` — plus the versioned snapshots.
- `ingestion_runs`/`ingestion_items`/`ingestion_errors` capture lifecycle + retry count;
  `audit_logs` chain INGESTION_STARTED → FETCH_STARTED/COMPLETED → EXTRACTION_COMPLETED →
  INGESTION_COMPLETED and now `DOCUMENT_EVIDENCE_PERSISTED` (5/6 observed;
  `INGESTION_REQUESTED` is a notifier-phase event not emitted by the local runner).
- **Validation** results persist in `validation_results`, attached to the snapshot they
  judged (`target_type='source_snapshot'`, `target_id=snapshot_id`) with `rule_id`,
  `severity`, `status`, `message`, `evidence_json` — provenance for every rule outcome.
- Audit table check in the pilot evidence report: PASS for every source.

## I. Performance / resource bounds (pilot)

- 5 sources, 2 runs each, ~70 item rows, ~35 evidence snapshots; wall time ≈ 5 minutes
  incl. retries.
- Budget caps held: nobody exceeded defaults (20/10/5/5MB/5/2/120s). `BUDGET_*_EXHAUSTED`
  audits observed — the budget is not a paper cap, it fires.
- Canonicalisation is a single linear pass over ≤5 MB bodies (no DOM); hash-only — order
  of magnitude below network fetch cost.
- Node DNS bound to 4 s (un-abortable) so a hanging resolver cannot stall the pipeline.

## J. Schema limitations identified

**No schema change was required.** Findings:

- `ingestion_items` `UNIQUE(run_id,url)` is the dedup anchor (engine also dedups in memory).
- `source_snapshots.url` is not materialised (derivable via `ingestion_items.url`); no
  change needed to persist snapshot→url linkage.
- **`documents` table cannot hold a bare discovered PDF without fabricating data**:
  `category NOT NULL REFERENCES document_categories(category_code)` (that vocabulary is
  currently unseeded anywhere), plus `title NOT NULL` and `published_at NOT NULL` — none of
  which are derivable from a raw fetch without parsing/OCR. Per the no-fabrication rule the
  V1 document-evidence path therefore uses `outbound_links` (target_type=DOCUMENT) +
  `source_snapshots` (evidence), which fully represent the requirement. The `documents`
  catalog remains the correct destination for *typed* document extraction (real title,
  category, published date from a registry/parser) in a later phase; populating it for
  arbitrary PDFs would be fabrication and is intentionally not done.

## K. Operational problems found (and fixes applied, incl. Q1)

| Problem | Fix |
|---|---|
| PDFs rejected by `expectHtml` guard | engine content-type dispatch → document-evidence path |
| Live pages re-hashed every fetch (UNCHANGED never fired) | deterministic canonical compare for change detection |
| Corrupted private-IP constant table | corrected `PRIVATE_V4_RANGES` |
| `www`↔apex redirect rejected | allowlist covers both hosts for a source |
| CSS/JS/image URLs polluting discovery | generic asset-extension filter (PDF excluded) |
| Template-literal junk URLs | `$\{…\}` guard in link extraction |
| Generic `[object Object]` fetch errors | structured error → message serialisation |
| Snapshot stuck at PENDING | `updateExtractionStatus` after extraction |
| Duplicate URL double-snapshotting | per-run URL dedup in engine |
| Repeat-run hang on slow DNS | 4s resolver timeout |
| Top-level await crash in tsx (CJS) | `async main()` pattern |
| Career/cross-subdomain capability pages rejected | `allowSubdomainsOf` policy knob (source-admin declared; security checks unchanged) |
| `validation_results` empty (rule seeded, never run) | engine runs `validators` post-extraction attached to the snapshot; results persist PASS/FAIL |

## L. 5 → 10 readiness — review after Q1 + hardening

1. **Binary documents: DONE (V1).** PDFs (and any non-HTML) ingest as evidence +
   DOCUMENT outbound link with provenance; change detection + old-evidence preservation
   proven by fixtures (TEST 11 document-budget) and a live matribhumi PDF.
2. **Canonical change detection: DONE.** Live repeat runs now report UNCHANGED for benign
   churn; substantive changes still CHANGED.
3. **Deterministic validation: DONE.** Two rules run post-extraction and persist to
   `validation_results` attached to the snapshot (q12 now PASS — 24/20/8/16/2 rows).
   A throwing rule degrades to a recorded FAIL, never stalls the run.
4. **Document budget at scale: DONE.** `maxDocuments` caps DOCUMENT_ARCHIVE/REPORTS
   processing; the cap is audited (`BUDGET_DOCUMENTS_EXHAUSTED`) while non-doc targets
   still process after the cap (TEST 11).
5. **Cross-subdomain capability pages: DONE.** `allowSubdomainsOf` (registered-domain
   knob) unblocked matribhumi's career page under unchanged security checks (S12).
6. **Remaining (external, non-blocking):** matribhumi `/notices` → HTTP 404 (site-side);
   a real `Validator` catalog beyond the two sanity rules as domains grow.
7. **No schema redesign; no per-MFB crawler classes; no AI/OCR; no auto-publish.**

**Commit**: proposed checkpoint message `feat: add validation rules and hardened fetcher policy` — awaiting explicit approval before committing.