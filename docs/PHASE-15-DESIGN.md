# Phase 1.5 — NRB Intelligence (Design)

> **Status:** DRAFT — decision document for Phase 1.5 (NRB intelligence). Companion
> to `docs/DATABASE-SPEC.md` §4.10 and `migrations/0006_regulatory.sql`. No code
> is written against this doc until the plan below is confirmed.

## 1. Goal

Turn the regulator into a first-class, evidence-backed layer on the platform:

- **Ingest** the NRB's public microfinance pages through the **same generic
  capability engine** as the 51-MFB pilot (no per-site crawler code, no AI).
- **Ledger** the results into the frozen NRB tables (`nrb_documents`,
  `nrb_directives`, `nrb_institution_links`, `regulatory_events`) that exist
  since migration `0006` and are already present (empty) in the canonical DB.
- **Surface** them: real NRB Center page, per-institution regulatory documents,
  and a regulator timeline.

This doc fixes **why**, **what**, and the deterministic **rules** — so the build
milestones (M1.5.1 → M1.5.3) become configuration + extraction + projection work.

## 2. Ground truth (fetched 2026-09-26)

Live inspection of `nrb.org.np` category indexes:

- **Quarterly Situation of MFIs**
  (`/category/quarterly-situation-of-mfis/`) — paginated WordPress archive
  (3 pages). Each entry is an `<a>` titled **"Situation of Microfinance
  Institutions (Asar 2083)"** → post URL under `/mfd/…`, plus a raw **date**
  and a **filesize** (`416.86 kb`). Post page (not shown) hosts the PDF.
- **Key Financial Indicators**
  (`/category/key-financial-indicators/`) — UNFILTERED (14 pages). Mixes
  MFD-specific MFI posts ("Key Financial Indicators of Microfinance
  Institutions as on Asar End 2083", aggregated per-quarter) with
  **BSD/other-department** posts ("2082–83 (Mid July 2026)") that are NOT
  MFI data. The MFI-only filter is `?department=mfd`.
- **MFD department** landing `/departments/mfd/` and archive `/mfd/` contain
  the MFD category links: *Current Microfinance Activities*,
  *Sources/Uses & Progress Report*, *Quarterly Interest Rate of Microfinance*,
  *Annual Supervision Report* (`?department=mfd`).
- NRB site is WordPress; nav exposes `/sitemap_index.xml`.

### Consequences for the design

1. NRB "pages" come in two shapes:
   - **Listing pages** (`/category/{slug}/` + `/page/N/`) — the highest-value
     surface: titled `<a>` (title + href) + date + filesize near each anchor.
   - **Post pages** (`/mfd/{slug}/`) — carry the actual PDF/document download.
2. The existing `financialMetadataExtractor` will NOT capture these: titles like
   *"Situation of Microfinance Institutions (Asar 2083)"* contain no
   finance-hint vocabulary ("financial / annual / audit / quarterly …"), so a
   listing extractor for NRB indexes is required.
3. KFI and Quarterly-situation documents are **aggregate** regulator documents
   (all-MFI data). A title-match on institutions yields nothing — that is the
   honest answer, not a gap (see §4 ledger).
4. The unfiltered KFI category pollutes the MFI signal; the MFI source must
   point its `known_url` at the `?department=mfd` filter (an evidence-backed
   query filter already on the NRB site, not a fabricated page).

## 3. Source model

Existing master sources (scope `NRB`) map as follows. `capabilities` stay
within the **frozen ten kinds** (`lib/ingestion/types.ts` — no new capability
kind). `known_url` is evidence-backed from the master registry.

| Master source (`id`) | Capability(s) | `known_url` (listing) | Doc type |
|---|---|---|---|
| `nrb-quarterly-situation` | `DOCUMENT_ARCHIVE` (+`SITEMAP`) | `/category/quarterly-situation-of-mfis/` | `REPORT` |
| `nrb-kfi` | `DOCUMENT_ARCHIVE` (+`SITEMAP`) | `/category/key-financial-indicators/?department=mfd` | `KFI` |
| `nrb-mfi-supervision` | `DOCUMENT_ARCHIVE` (+`SITEMAP`) | `/category/annual-supervision-report/?department=mfd` | `REPORT` |
| `nrb-mfd-home` | `WEBSITE` (discovery intent only) | `/departments/mfd/` | — (routes to categories) |
| `nrb-mfd-archive` | `DOCUMENT_ARCHIVE` (discovery intent) | `/mfd/` | `DIRECTIVE`/`REPORT` |
| `nrb-annual-reports` | `DOCUMENT_ARCHIVE` (+`SITEMAP`) | `/category/annual-reports/` | `REPORT` |
| `nrb-bfi-archive` | `DOCUMENT_ARCHIVE` (+`SITEMAP`) | `/category/list-of-bfis/` | — (universe/monitoring) |
| `nrb-bfi-mid-may-2026` | handled by **master refresh**, not crawl (see §6) | — | — |
| `nrb-quarterly-interest-rate` *(additive)* | `DOCUMENT_ARCHIVE` (+`SITEMAP`) | `/category/quarterly-interest-rate/?department=mfd` | `KFI` |

Notes:

- Sources declare **no `institution_id`** — they are regulator-scoped
  (`sources.source_scope='NRB'`, `source_type='NRB'`). The engine already
  tolerates null `institutionId` (its `scopeKey` falls back to the source id,
  `engine.ts:318`).
- Budgets: NRB listings paginate (KFI ~14 pages). NRB sources get their own
  per-source `config_json.budget` (e.g. `maxTargets 40 / maxFetches 30 /
  maxDocuments 12 / maxRuntimeMs 240000`), separate from the `pilot-budget.json`
  defaults, because NRB pages are deep archives not per-MFB sites.
- Optional additive source (out of master, flagged for later): the MFD
  **Quarterly Interest Rate of Microfinance** category
  (`/category/quarterly-interest-rate/?department=mfd`) — feeds the frozen
  `interest_rates` tables in a later slice; not in M1.5.1.

> **Confirmed (2026-09-26):** the additive interest-rate source is **in** for
> this phase — it is added to the NRB registry and its documents land in
> `nrb_documents` (`doc_type='KFI'`, topic `INTEREST_RATE`); wiring into the
> `interest_rates` tables stays deferred to the financials slice.

## 4. Ledger rules (deterministic, no AI)

### 4.1 `nrb_documents`

One row per (source, listing href), id `nrb-doc-<sha1(sourceId + '|' + url)>.slice(0,8)`.

| Field | Source |
|---|---|
| `title` | listing anchor text (trimmed) |
| `doc_type` | per-source map in §3 (`KFI`/`REPORT`/`DIRECTIVE`); refined by title vocabulary where unambiguous |
| `topic` | title keywords → `INTEREST_RATE`, `PROVISIONING`, `REPORTING`, `GOVERNANCE`, `IT`, `AML_CFT`, `CONSUMER`, else `null` |
| `official_url` | listing href (the post page) |
| `published_at` | the ISO date near the anchor (from `DOCUMENT_DATE` evidence) |
| `effective_date` / `deadline` | only from explicit NRB notice text, else `null` |
| `source_id` | the NRB source id |

Dedupe: title + url UNIQUE per source (same safeguard the loader uses for
`outbound_links` UNIQUE(scope_key, slug)).

### 4.2 `nrb_institution_links`

Only **institution-resolvable** links assert. Three deterministic classes:

- `CLASS` / `LICENSE` — from the master universe rows
  (`master.json` `nrb_class`, `nrb_license_number`, `source_id`
  `nrb-bfi-mid-may-2026`) → one link per institution, `link_date = observed_at`.
- `MERGED_BY_NRB` / `ACTION` — from master `timeline` events
  (`event_type` `MERGED`/`ACQUIRED`/`RENAMED`, `source_id`
  `nrb-bfi-mid-may-2026`, evidence URLs already embedded in the summary).
- `REPORT` / `KFI` — ONLY for NRB documents whose **title or page text matches a
  master institution name** (normalized exact contains). Aggregate documents
  ("Situation of Microfinance Institutions (…)") match nothing → **no link**;
  that is honest regulator truth, drives the empty-link FAIL row in the ledger
  report rather than inventing per-MFI values.

All `nrb_institution_links` rows carry `source_id` + `link_date`, satisfying the
`UNIQUE(institution_id, nrb_document_id, link_type)` backstop.

### 4.3 `regulatory_events`

Materialized from master `timeline` (MERGED/ACQUIRED/RENAMED/SUSPENDED) with the
existing evidence trail; kept separate from `timeline_events` as the
**regulator-sourced** view of the same facts.

### 4.4 Assertion treatment

The engine already persists UNVERIFIED assertions
(`data_assertions`, `verification_status='UNVERIFIED'`) for `DOCUMENT_TITLE`
(≥0.5) and evidence-only `DOCUMENT_DATE`/`DOCUMENT_SIZE` (0.45). `nrb_documents`
is a **projection** of that evidence — every ledger row trivially traces back to
a `source_snapshot_id`. The loader never creates rows without an originating
snapshot/assertion.

## 5. Extraction design (M1.5.1)

New deterministic parser `nrb-listing-v1` (library code in
`lib/ingestion/structured.ts`, institution-agnostic, composed via
`composeExtractors`):

- Acts on **listing pages** only. Trigger = a small additive field on the
  extractor context: `sourceType` (set by the engine at `engine.ts:343`;
  `source.sourceType === 'NRB'`). Additive, no schema change.
- Per anchored entry on the page (title + href near a date/size): emit
  - `{kind:'LINK', text: title}` → `outbound_links` row (target_url = href)
  - `{kind:'FIELD', field:'DOCUMENT_TITLE', confidence:0.6}` → assertion
  - `{kind:'FIELD', field:'DOCUMENT_DATE', confidence:0.45}` only when an
    ISO-ish date sits beside the anchor
  - `{kind:'FIELD', field:'DOCUMENT_SIZE', confidence:0.45}` (filesize text)
- Ignores nav/footer/category headings (same junk guards as existing parsers).
- The listing parser and the existing `financialMetadataExtractor` compose for
  NRB `DOCUMENT_ARCHIVE`/`REPORTS` pages; overlap is deduped by title+url in the
  loader.

Discovery: `SITEMAP` deref + one-level LINK walk so `/category/…/page/N/`
continuations and `/mfd/…` post links are located by the same Phase F recursion
already deployed for MFB sites. Post pages (PDF carriers) are fetched for
snapshot/evidence but the listing page remains the authoritative ledger surface
for 1.5.

## 6. Milestones (each verified + committed)

- **M1.5.1 — Intake**
  1. Add the 8 crawlable NRB sources (a `data/nrb/nrb-sources.json` registry —
     source_type/scope/capabilities/known_url/budget per §3).
  2. Implement `nrb-listing-v1` + context `sourceType`; compose into the
     extractor set (observable NRB `parserId`).
  3. `scripts/nrb-ingest.ts` runs the engine over the NRB registry into a fresh
     `lk-nrb-*` temp DB (same local adapter, same schema — NRB tables ready).
     Per-source budgets absorb the pagination corpus.
  4. Verify (probe script, then delete): items/snapshots/assertions per NRB
     source ≥ listing entries seen live (spot-check quarterly-situation page 1
     = 10 entries, KFI(bsd-filtered) ~10/page), `DOCUMENT_TITLE` assertions,
     `outbound_links` hrefs resolve to `/mfd/…`/`/category/…`, snapshot
     preservation, idempotent re-run → UNCHANGED.
  5. Update `docs/PILOT-EVIDENCE-REPORT.md`? No — write a separate
     `docs/PHASE-15-INTAKE-REPORT.md` (NRB sources aren't pilot MFB sources).
- **M1.5.2 — Ledger**
  1. `scripts/nrb-ledger.ts`: project evidence → `nrb_documents`, then
     `nrb_institution_links` (CLASS/LICENSE/MERGED_BY_NRB from master; name-
     matched REPORT/KFI), then `regulatory_events` from master timeline.
  2. Deterministic id/re-run idempotency (re-run = upsert/no-op).
  3. Verify: `nrb_documents` count == distinct listing hrefs; sample rows with
     title+publisher date; `nrb_institution_links` counts == timing; zero
     orphan rows (every row has `source_id` + a snapshot ancestry); ledger
     report is **deterministic across re-runs**.
- **M1.5.3 — Frontend**
  1. `scripts/generate-nrb-data.ts` regenerates `src/data/nrb.ts`
     (typed `NrbCircular` from `nrb_documents`) from the ledger DB.
  2. `/nrb` page shows real documents grouped by `doc_type` (title, date, size,
     source link). Institution pages gain an "NRB" card:
     `CLASS`/`LICENSE` lines and any name-matched documents.
  3. A regulatory timeline section from `regulatory_events`.
  4. Build + smokes + typecheck.

## 7. Explicit non-goals (this pass)

- **No PDF parsing** of KFI/quarterly PDFs → no per-MFI financial values in
  M1.5 (that is Phase C financials territory, unchanged).
- **No new capability kind**, no schema/contract table change (one additive
  extractor-context field only).
- **No AI/OCR/Puppeteer** — unchanged Phase R discipline.
- **No `regulations` notifications/alerts** (Phase 2).
- **No per-department crawling beyond MFD-scoped sources** (BSD KFI pollution is
  excluded by the `?department=mfd` known_url).

## 8. Decisions (confirmed 2026-09-26)

1. **`nrb-kfi` `known_url` → `/category/key-financial-indicators/?department=mfd`**
   (MDD-filtered). BSD/bank posts are excluded at the source, not by keywords.
2. **Additive NRB source `nrb-quarterly-interest-rate` is registered** this
   phase; its documents land in `nrb_documents`; `interest_rates` table wiring
   remains a later financials slice.
3. **NRB Center keeps the card list** — doc_type badge, date, size, outbound
   link; no tabbed layout.
4. **NRB pagination is budget-bounded for M1.5.1** (fetch the newest listing
   pages only, e.g. KFI pages 1–2). Full-archive reach is a future operator
   knob (`config_json.budget`), never code.