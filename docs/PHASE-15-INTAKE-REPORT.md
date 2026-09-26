# Laghubitta Khabar — Phase 1.5 M1.5.1 NRB intake report

M1.5.1 builds the first **regulator-side** intake surface on top of the generic
capability engine that M1.5.0 proved on MFB pilot sites: the eight crawlable NRB
sources run through the same `LinkedEvidenceFetcher → Discovery → Extract →
Validate → Assert(UNVERIFIED)` pipeline and land in a scratch review DB.
Nothing is published; no schema change; extraction is deterministic (AI OFF).

Reproduce: `npx tsx scripts/nrb-ingest.ts` / `npx tsx scripts/nrb-ingest.ts --repeat`
Intake run: `2026-09-26` (live `www.nrb.org.np`, all pages HTTP 200).
Latest scratch db: `C:\Users\Lenovo\AppData\Local\Temp\lk-nrb-EzQrr5\nrb.db`
Report blob: `data/nrb/nrb-run-report.json`; registry + budget:
`data/nrb/nrb-sources.json`, `data/nrb/nrb-budget.json`.

## Scope (8 crawlable sources — from the 8 NRB master sources + 1 additive)

| source | capability surface | doc_type |
|---|---|---|
| nrb-quarterly-situation | DOCUMENT_ARCHIVE `/category/quarterly-situation-of-mfis/` + `page/2` | REPORT |
| nrb-kfi | DOCUMENT_ARCHIVE `/category/key-financial-indicators/?department=mfd` + `page/2/?department=mfd` | KFI |
| nrb-mfi-supervision | DOCUMENT_ARCHIVE `/category/annual-supervision-report/?department=mfd` | REPORT |
| nrb-mfd-home | WEBSITE `/departments/mfd/` | (routes) |
| nrb-mfd-archive | DOCUMENT_ARCHIVE `/mfd/` | DIRECTIVE/REPORT |
| nrb-annual-reports | DOCUMENT_ARCHIVE `/category/annual-reports/` | REPORT |
| nrb-bfi-archive | DOCUMENT_ARCHIVE `/category/list-of-bfis/` | (universe) |
| nrb-quarterly-interest-rate | DOCUMENT_ARCHIVE `/category/quarterly-interest-rate/?department=mfd` + `page/2` | KFI (additive) |

`nrb-bfi-mid-may-2026` is a master-refresh-only entry (bounded single-URL
evidence source); it is **not** crawled here.

## What the run produced (single-run totals)

- 8 runs, 11 targets fetched, 11 source snapshots, **0 fetch/extraction errors**.
- **97 outbound_links**, all `https://www.nrb.org.np/...` (`/mfd/`, `/bsd/`,
  `/red/`, `/bfr/`), availability `UNKNOWN` (document targets not yet
  depth-checked), `UNIQUE(scope_key, slug)` enforced — 0 duplicates.
- **109 assertions, all `UNVERIFIED`**: 97 `document_title` (one per archive
  entry) + 12 incidental pilot page-title/email fields. Per source the counts
  match the live evidence probes, e.g. quarterly-situation 10+10, kfi 10+9,
  mfi-supervision 8, annual-reports 10, bfi-archive 10, interest-rate 10+10,
  mfd-archive 10.

## Idempotency (--repeat, same day)

Second run of every source re-detected every target as `UNCHANGED`
(change detection via content hash); snapshot counts stayed identical and no
duplicate assertion/outbound row appeared. Repeat DB `lk-nrb-EzQrr5` shows the
same per-source assertion totals as the single-run DB.

## Delivery vs. design doc

- **Registry/budget** (design §3): per-source `config_json` carries
  `capabilities` + `budget` (mirror of the pilot budget file), regulator-scoped
  `source_type='NRB'`, `source_scope='NRB'`, no `institution_id`.
- **`nrb-listing-v1` parser** (design §5) in `lib/ingestion/structured.ts`,
  composed in the extractor set (observable NRB parserId). Per anchored entry it
  emits `LINK` evidence (→ `outbound_links` row) + `DOCUMENT_TITLE` 0.6
  (→ assertion) + evidence-only `DOCUMENT_DATE`/`DOCUMENT_SIZE` 0.45.
- **Engine additions** (generic, not NRB-specific): `sourceType` on the
  extractor context; LINK-kind evidence → durable `outbound_links` row
  (indicates text-anchored docs from listing pages, `UNKNOWN` availability);
  per-snapshot assertion dedupe by (field, value) so the listing parser and the
  financial-metadata parser overlap once; assertion entity fallback
  `institution → source` for institution-less regulator sources.
- **Discovery fix**: KNOWN capability URLs preserve their query string
  (`?department=mfd`), while walk/sitemap hrefs still get query-stripped.

## Two findings fixed during the run (and why the registry looks as it does)

1. **SITEMAP capability was removed — it is full-archive reach.** NRB is
   WordPress; a declared `SITEMAP` deref classified arbitrary posts (bidding
   documents, Dhangadhi office notices) as `DOCUMENT_ARCHIVE` via generic
   "document"/"download" hints and fetched/asserted them — exactly the
   un-bounded crawl M1.5.1 rules out. With no `SITEMAP` declaration and
   explicit `DOCUMENT_ARCHIVE` known_urls, the authoritative surface is exactly
   the configured listing pages (budget-bounded pagination as config: known
   `page/2` URLs for the KFI family). Full-archive reach remains a future
   operator knob in `config_json.budget`, never code.
2. **Sidebar/footer category links are not documents.** NRB category pages
   render a sidebar of repeated category links in `arrowed-list` ULs with no
   date/size. The parser now only treats a row as a document when it carries a
   date or filesize signal (the `.font-size-xs` block real entries always
   have); and the financial-metadata parser defers to `nrb-listing-v1` on the
   NRB source family, where its word-hints misfire on that sidebar. Verified by
   fixtures N1/N4 plus the live run (no "Financial Statements", no
   "Archives (…)", no "NRB Quarterly news" assertions).

## Live verification (design §6 step 4)

Spot-checked 5 outbound targets with the ControlledFetcher
(`minIntervalMs 250`, allowed hosts `*.nrb.org.np`): all resolved **HTTP 200**
to genuine NRB-hosted documents, e.g.
`/mfd/situation-of-microfinance-institutions-asar-2079/` →
`…/Situation-of-Microfinance-Institutions-Asar-2079.pdf`, and
`Interest-Rate-Structure…xlsx`, `Annual-Supervision-Report…pdf`,
`List-of-BFIs-Baisakh-2083-English.pdf`.

## Guardrails honored

- Scratch review DB only; **no production DB touched, nothing published**.
- Extraction is deterministic regex/structure parsing; AI OFF, no OCR, no
  browser automation, no per-MFB code. The only NRB-specific parser is
  `nrb-listing-v1`, gated on `sourceType === "NRB"` + archive capabilities.
- Assertions are `UNVERIFIED` by construction; document targets recorded as
  `UNKNOWN` until M1.5.2 depth-checks them.
- Budget: config-driven (`data/nrb/nrb-budget.json` → `config_json.budget`),
  defaults maxTargets 40 / maxFetches 30 / maxDocuments 14 /
  maxRuntimeMs 240000; actual per-run fetch counts were ≤ 2 per source.

## Honest limitations

- The listing page is the authoritative ledger surface; per-document content
  (PDF text, dates inside files) is **not** read in M1.5.1 — that is M1.5.2
  depth-check territory.
- Pagination beyond page 2 requires config additions (new `page/N` known_url),
  not new code.
- `nrb-mfd-home` (WEBSITE) produces no document signals — it is a discovery
  stance for the MFD department page, not an archive.

## Next

Proceed to M1.5.2 (document depth-check + `nrb_documents` projection +
verification statuses) per `docs/PHASE-15-DESIGN.md` §6–§7, then run the full
battery and ask before committing.