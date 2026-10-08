# P2-F — Operational Graph Integration Audit

**Status:** Closed  
**Date:** 2026-10-08  
**Scope:** Integrate canonical layers (P2-A–P2-E) into institution-centric operational graph with evidence/source trail, historical timeline, consistent API/read-model contracts, institution-level search/discovery (graph surface) and no schema changes by default.

## 1. Objective
- Primary node: institution profile.
- Edges: People/Positions, Branches, Financial docs (reports + rate notices), Documents, Jobs, News/Activities, NRB events/links.
- Evidence/source trail; historical timeline; consistent API/read-model contracts.
- Institution-level search/discovery surface.
- No new schema unless current schema blocks graph; preserve P2-E distinction (155-item evidence-backed activity, D1 news/posts/post_sources remain 0).
- Unify read-models where divergent (static vs D1 detail shape).

## 2. Measurement baseline
- Institutions: 51  
- People (published): 151 (17 institutions with ≥1)  
- Branches (published): 1898 (19 with ≥1)  
- Financial reports: 40 (9), interest rates: 8 (5) — total 48  
- P2-D documents: 330 (20)  
- Jobs: 99 (19)  
- NRB regulatory events: 62 (25)  
- NRB institution links: 76 (51)  
- News records with institution slug: 62/155  
- Static detail + timeline/coverage added; D1 detail already has timeline.

## 3. Read-model unification (static API)
- `lib/api/repository.ts`: `InstitutionDetail` extended with `timeline` (array of `{event_type, title, occurred_at, summary}`) and `coverage: {province_count,district_count,branch_count}|null`.
- `detailFor()` maps `l.events` → timeline; timeline includes all NRB events mapped (no date-filtering removal). Coverage uses source branch_count when present.
- Verified: `GET /api/institutions/:slug` (static) now includes timeline/coverage; matches contract intent.

## 4. Canonical `institutionGraph(slug)`
- Signature: `institutionGraph(slug)` returns `ResourceEnvelope<InstitutionGraph>|ErrorEnvelope`.
- Graph shape:
  - `node`: full `InstitutionDetail` (with timeline + coverage)
  - `edges`: `{leadership, branches, financialReports, interestRates, documents, jobs, news, events, nrbLinks}`
  - `timeline`: merged historical timeline (dedup by `date|title|type`) sourced from NRB timeline, operation date (if not anomaly), branch establishments; sorted desc by date. Jobs timeline excluded by design (not "institution history" events) — branches/op date + NRB events cover history.
  - `evidence`: `{sources: string[], source_urls: (string|null)[], last_verified_at: string|null}` — aggregates sources from all edge nodes, includes registered NRB source titles, collects source URLs and event trailing URLs where present.
  - `meta`: `ApiMeta` (from `metaFor`).
- Mapping:
  - `leadership` = `allPublishedPeople()` filtered by `institution_slug`
  - `branches` = `allPublishedBranches()` filtered by `slug.startsWith(slug+'-')`
  - `financialReports` + `interestRates` from `allPublishedFinancials()` filtered by `institution_slug`, mapped via DTO mappers
  - `documents` = `allPublishedDocuments()` filtered by `institution_slug`
  - `jobs` = `jobsByInst(inst)` (column-keyed; prefix-free)
  - `news` = `newsRecords()` filtered by `institutionSlug` → classified (tier/scope) → `toNewsItem` (preserves 155 universe, only 62 have institution slug)
  - `events` = `eventsByInst(inst)` (all NRB regulatory events for institution)
  - `nrbLinks` = `linkByInst(inst.id)`
- Counts verified across 51 institutions: documents 330, financials 48, jobs 99, branches 1898, news 62 total, events 62 distributed, timeline merged total 112 items (51 have ≥1 dated timeline). Dedup logic removes obvious duplicates by key.

## 5. HTTP surface
- `lib/api/handler.ts`: added `case "graph"` → `respond(institutionGraph(slug))` on `GET /api/institutions/:slug/graph`.
- Endpoint returns full envelope; not paginated (edges are already filtered per institution).
- `GET /api/institutions/:slug/graph` smoke-tested: returns 200, edges correct.

## 6. Contracts/compatibility
- No schema changes to DB; only read-model extension in static API layer. D1 layer unchanged (already has timeline in detail).
- `InstitutionDetail` shape extended in static repo only; code that constructs/consumes still compatible (new fields optional in JSON, added fields are present). API response for existing endpoints unchanged except static detail now includes `timeline` and `coverage` — this aligns with contract ("detail includes timeline/coverage") and unifies with D1/worker semantics.
- Worker `handleInstitution` returns `inst` (D1 shape) — untouched; `handleSubResource` events path unchanged.
- `listNews`/activity unchanged; P2-E invariants preserved.

## 7. Verification (green suites)
- TypeScript: clean (`tsc --noEmit` passes).  
- API smoke: `smoke-api.ts` — 115/0.  
- News P2-E: `smoke-news-p2e.ts` — 67/0 (includes PE-8, PE-10: news/posts/post_sources remain 0 in all DBs).  
- P2-A: 32/0; P2-B: 33/0; P2-C: 31/0; P2-D: 74/0.  
- Worker: `smoke-worker.ts` — all checks passed (detail has timeline; meta.tier singular; validation 422).  
- Worker security + ingest security + people lifecycle: all green.  
- Branch external, compare, dataapi smokes: green.  
- Discipline: `check-discipline.cjs` — OK.  
- Lint (changed files): no errors/warnings.  
- Next build: successful (static export).

## 8. Files modified
- `lib/api/repository.ts`: extended `InstitutionDetail`; added `InstitutionGraph` type and `institutionGraph()` function; imports `DocumentDto`, `allPublishedDocuments`.
- `lib/api/handler.ts`: added `institutionGraph` import and `case "graph"` route.

## 9. Notes on design choices
- Timeline merged from node.timeline (NRB events) + operation date + branch establishments — avoids duplicating jobs; matches page-side construction intent and keeps it "historical timeline".
- Evidence trail aggregates across all edges (sources + URLs). Includes registered NRB source titles; captures trailing evidence URLs for events when present.
- Graph read-model is deterministic (pure over generated modules); no network, no I/O.
- No schema changes; preserves P2-E invariant (D1 zero rows).  
- Institution-level discovery exposed via graph surface; search.ts left as-is (no API contract change required by locked scope).

## 10. P2-F = CLOSED
All locked requirements satisfied with no schema changes. Suites green; build succeeds; evidence/trail + unified timeline present; contracts consistent.
