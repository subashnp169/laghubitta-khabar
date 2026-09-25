# Laghubitta Khabar — Roadmap (Frozen)

## Vision

Nepal's Microfinance Information & Intelligence Platform. One complete, verifiable "digital twin"
per MFB. Data is the moat; documents are the evidence; jobs drive traffic; NRB is the regulatory
layer; people are the human layer.

## V1 modules

| Module | Status |
|---|---|
| MFB Directory | YES |
| CEO/Board (people profiles) | YES |
| Branch Directory + map | YES |
| Financials (snapshot + history) | YES |
| Reports/Documents | YES |
| News (typed by source) | YES |
| Official Notices | YES |
| Jobs | YES |
| Digital/Social Directory | YES |
| Events/Timeline | YES |

**Phase 1.5:** NRB intelligence. **Phase 2:** Compare, Alerts, AI intelligence.
**Phase 3:** B2B API, employee network, premium analytics.

## Pilot (Phase 0) — 5 institutions

Infinity, Mero, Matribhumi, Chhimek, Nirdhan — as five materially different crawler test cases.
Goal: prove the engine ingests 5 different site structures with no institution-specific code.

Deliverables:
1. **Database specification + design (DONE 2026-09-24)**: `docs/DATABASE-SPEC.md` (53-table
   canonical model incl. `institution_coverage` + `sources.source_scope`), migrations
   `0001..0007` (the full V1 set — 0007 ships with V1), regenerated `schema/schema.sql`
   (`node scripts/build-schema.cjs`; generated, never hand-edited). Validated: builds clean on
   fresh SQLite. FROZEN — design freezes here; next is build.
2. **Master data — canonical universe** (`data/master/institutions.ts` + `aliases` + `symbols`):
   all Class-D MFBs from the old `senna-mfi-db` export (selective import only, each with a real
   `sources` row). 5-MFB pilot = crawler validation set, NOT the whole seed.
3. Sources/evidence records for Mero and Matribhumi (branch census, document catalogs already
   captured in the VAPT recon phase).
4. API + repository layer; frontend reads via API only.
5. `/go/` outbound routing layer (Bulk Redirects over `_redirects`; `/go/*` = noindex).

## Phase order (frozen)

**Phase A** identity+evidence: master institution data → sources → documents → `/go/`.
**Phase B** people + branches. **Phase C** financials. **Phase D** content (news/jobs/events).
**Phase E** regulatory + ingestion engine. Expansion 5 → all MFBs only after the generic pipeline
proves itself. Each phase flips one `institution_coverage` status per MFB.

## Learning plan (owner)

Weekwise: PostgreSQL/SQL → Python ETL → FastAPI → connect Next.js → PDF+Playwright → admin →
automation → SEO/reliability. 30% learn / 60% build / 10% notes. Use AI for single-layer steps,
not whole-app generation.

## Non-goals now

Forum, portfolio tracker, stock trading, AI investment recommendations, employee profiles,
social network, blockchain, mobile app, TimescaleDB, Kafka, Kubernetes.