# Laghubitta Khabar — Frozen Specification (v1)

Freeze date: 2026-09-24. Change requires updating this file + a migration.

> **Database is frozen separately in `docs/DATABASE-SPEC.md`** (canonical, 52 tables).
> `migrations/*.sql` are the DDL; `schema/schema.sql` is generated from them via
> `node scripts/build-schema.cjs`. This file covers product/UI/rules, not table DDL.

## 1. Canonical page: `/institutions/{slug}`

Ten V1 tabs; every item carries `source` + last-verified date (provenance is the product).

| Tab | Fields (all with source+verified) | Layer | Primary source | Refresh |
|---|---|---|---|---|
| Identity | Official name (EN+NP), short name, previous names, logo, NEPSE symbol, reg#, NRB license (Class D, national/provincial), operation date, head office, working area, website/email/phone, verified socials | A | NRB licensed list + official site | quarterly |
| Leadership | Tier 1 only. Board (Chair/Dir/Independent), management (CEO/DGM/GM), committees. Person = `/people/{slug}` | A | Annual report, site Board/Management | on AGM/AR |
| Financials | Snapshot + history (Q1-4 + annual, 2019→2026): paid-up capital, assets, deposits, loans, borrowings, net profit, EPS, ROE, ROA, NPL, CAR, base rate, spread, CoF | C | NRB KFI datasets + official PDFs | per quarter |
| Branches | Total + map + per-branch: province/district/municipality, address, phone, email, manager (only if published), open/close history | A | Official branch pages | daily watch |
| Documents | Annual/quarterly reports, AGM+minutes, dividends, book closure, rights, vacancy, tender, policies, press releases, NRB notices | E | Official site + report indexes | daily watch |
| News | Typed by source: **Official (institution) / NRB / Laghubitta Khabar (original) / Other media (credited)** — never merged | B | Their sites, NRB, our desk | daily |
| Timeline | Unified event stream: date, type, title, links to people/branches/documents | B | Derived from all above | auto |
| Digital | Only verified official accounts: website, FB, LinkedIn, YT, IG, X, app — with `last_checked` | A | Manual verification only | monthly |
| Products | Savings/loans (micro, agri, livestock, edu, housing), digital services, channels — rates only where public | A | Official site | quarterly |
| Careers | Current + past vacancies, category, location, deadline, application method | B | Official site | daily |

## 2. Entity model (knowledge graph in D1)

```
institutions
  ├── aliases (slug_aliases, previous names, symbols)
  ├── positions ──► people                    (tier 1/2, role, appointed_at, ended_at, committees)
  ├── institution_relationships               (RENAMED_FROM / MERGED_FROM / MERGED_INTO)
  ├── branches   (province/district/municipality, manager→people, opened/closed_at)
  ├── financial_results ── financial_metrics  (metric, value, unit)
  ├── documents  (doc_type, official_url, canonical_url, go_slug, period, content_hash,
  │               file_size, mime_type, availability_status, archive_policy,
  │               archived_locally, r2_key(NULL), published_at, extracted via extraction rows)
  ├── events     (event_type, occurred_at, ref→institution/people/doc — the timeline)
  ├── posts      (source_type: official/nrb/khabar/media, category)   ← 4 tiers, distinct UI
  ├── jobs
  ├── social_accounts (platform, url, verified, last_checked, is_active)
  └── products   (product_type, savings/loans/digital, rate where public)
nrb_documents (topic, effective_date, deadline) ── m2m institutions   (Phase 1.5)
sources       (url, fetched_at, content_hash, raw_path)   ← every table FKs here
source_snapshots (source_id, fetched_at, content_hash, r2_key, parser_version, extraction_status)
data_assertions   (entity_type, entity_id, field, value, source_id, observed_at, valid_from, valid_to, confidence, verification_status)   ← evidence engine
data_conflicts    (entity_type, entity_id, field, source_a, value_a, source_b, value_b, ...)   ← admin-visible
ingestion_runs / ingestion_errors              ← every crawl auditable
```

## 3. Engineering rules (frozen)

1. **Current state vs history**: never overwrite a time-dependent fact. `positions` uses
   `appointed_at`/`ended_at` so "current CEO" and "CEOs 2019–2026" both answer without data loss.
   Applies to branches, directors, management, names, addresses, products, socials, financials.
2. **Universal entity IDs + immutable IDs**: relationships use `institution_id`, `person_id`, etc.
   Never names. Slugs are URL-only. IDs never change.
3. **Source/evidence model**: every outside fact → `sources` + `source_snapshots` (raw preserved).
   Websites change; evidence must not.
4. **data_assertions**: every important fact is `(entity, field, value, source, observed_at,
   valid_from, valid_to, verification_status)`. The anti-"where did this come from" structure.
5. **Freshness**: `last_verified_at` + `next_review_at`. Per-field policies
   (`field_refresh_policies`): CEO 90d, branches 30d, social 30d, financials quarterly, AR annual,
   contact 90d, jobs/news daily. UI shows "Verified 12 days ago" per field.
6. **verification_status**: UNVERIFIED / AUTO_VERIFIED / HUMAN_VERIFIED / CONFLICT / STALE / REJECTED.
7. **Source priority**: see SOURCE-POLICY.md. Lower tier never outranks higher tier.
8. **Conflicts visible to admin**: never silently choose when sources disagree.
9. **Tier 1/Tier 2 people only; no employee scraping.**
10. **AI-generated facts never enter production without human validation.** AI discovers,
    extracts, classifies, suggests, compares, flags. It never directly publishes a fact. The only
    path into D1:
    `official PDF → parser → AI extraction → validation → source evidence → confidence →
    AUTO_VERIFIED / HUMAN_REVIEW → D1`. A published fact therefore always carries source URL,
    source snapshot, document, page/section when available, observed date, confidence, and
    verification status.
11. **No financial number without source + period + unit** (unit normalized to canonical form).
    Keep `reported_value` (exactly as the source wrote it) alongside normalized typed values —
    e.g. `Rs. 1,234.56 million` reported, `1234560000` normalized.
12. **Frontend cannot directly access D1.**
13. **Schema is portable SQLite SQL** (no Postgres-only features) → D1→PostgreSQL later is a config change.
14. **Every schema change is a migration.**
15. **Every crawler run is auditable** (ingestion_runs).
16. **Every public page shows source/freshness where appropriate.**
17. **Historical data remains queryable.**
18. **Slugs are URLs, not database relationships; slug_aliases for 301s.**
19. **Build the data layer before expanding the UI.**
20. **Never silently delete evidence because newer info exists.**
21. **Documents are catalogued, not hosted.** Default = LINK_ONLY: `/go/{inst}/{go_slug}` 302-redirects
    to the official URL. R2 copies only per `archive_policy` (REGULATORY_ARCHIVE > ARCHIVE > OPTIONAL).
    `archived_locally` + nullable `r2_key` record whether WE hold the bytes. The publisher remains
    authoritative; we stay the index + evidence layer.
22. **Availability checks use GET/range, never assume HEAD** (MFB servers 405 HEAD). Resolve one
    redirect from `official_url` to `canonical_url` before hashing. Track `availability_status`.

## 4. Crawler: modular, not per-MFB

No `crawlInfinity()`. Configurable source definitions:

```
institution → source definitions → discovery rules → fetcher → classifier → extractor → normalizer → validator
```

Example source config:
```json
{ "institution": "infinity", "sections": {
  "leadership": "/about-us/board-management",
  "branches":   "/branch-network",
  "reports":    "/reports",
  "notices":    "/notice",
  "careers":    "/career" } }
```

## 5. Pilot: 5 MFBs as 5 crawler test cases

| MFB | Proves |
|---|---|
| Infinity (ILBS) | controlled/known data |
| Mero | different website structure |
| Matribhumi | large document archive |
| Chhimek (CBBL) | large/established MFB |
| Nirdhan (NUBL) | older institution/history |

Goal is **not** "five pages online" — it is "the engine ingests five materially different
institutions without hard-coded logic."

## 5a. News tiers (frozen — 4 types with unambiguous semantics)

| Tier | Means | Shown as |
|---|---|---|
| `OFFICIAL` | News/notice published by the MFB itself | "Infinity Laghubitta announces AGM" |
| `NRB` | NRB circulars, notices, directives, regulatory publications | "NRB publishes revised directive" |
| `KHABAR` | Original Laghubitta Khabar reporting/research | "What the new NRB provision means for MFBs" |
| `MEDIA` | Other media reports — always credited and linked | "[Media outlet] reports CEO appointment" |

UI badges distinguish them; the tiers give the site volume without pretending all sources have
equal authority. Tier is not a proxy for grade — `verification_status` + `source_grade` still rule.

## 5b. Architecture responsibility boundary (frozen)

```
INTERNET ── official MFB websites/PDFs + NRB publications
   └─▶ INGESTION ENGINE: discover → fetch → hash → extract/parse → AI classify
       → normalize/dedupe → validate ──▶ AUTO_VERIFIED / HUMAN_REVIEW ──▶ D1
D1 ──▶ structured data + evidence + history ──▶ repository ──▶ API Worker
   ──▶ Cloudflare Cache ──▶ Next.js frontend (MFBs · Financials · News · Jobs · NRB)
R2 = selected evidence only; official URLs remain authoritative (link-first, rule 21).
Static export is NOT used for continuously changing data — dynamic data goes through the
Worker/API path.
```

## 6. API contract (frozen)

```
GET /api/institutions/{slug}
GET /api/institutions/{slug}/leadership
GET /api/institutions/{slug}/branches
GET /api/institutions/{slug}/financials
GET /api/institutions/{slug}/documents
GET /api/institutions/{slug}/events
GET /api/institutions/{slug}/jobs
GET /api/people/{slug}
```

Predictable DTOs; frontend never depends on D1 schema.

## 7. Deliberately NOT in V1

Forum, portfolio, stock trading, AI predictions, employee profiles, social network, blockchain,
mobile app, TimescaleDB, Kafka, Kubernetes, B2B API.