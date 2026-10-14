# SYSTEM-ARCHITECTURE — Phase P0.1 Freeze

**Status:** FROZEN (Phase P0.1)
**Authority:** `Laghubitta Khabar — Master Architecture, Workmap & Execution Directive` v1.0
**Scope:** the whole system. This document defines what may not change without approval.

---

## 1. Mission (the one sentence)

> Laghubitta Khabar collects information from authoritative and traceable sources, preserves evidence and history, converts it into a canonical microfinance-sector information graph, and exposes reliable projections through public pages, research tools and future controlled contributions.

If a proposed feature does not strengthen that sentence, it does not belong.

---

## 2. Planes

Four planes. Data flows one direction only.

```
Plane A  INGESTION      discover → register → fetch → snapshot → extract →
                        normalize → validate → assert → dedupe → conflict →
                        review → promote

Plane B  CANONICAL      entities, relationships, historical states, evidence
                        bindings. Storage-independent.

Plane C  READ           projections, DTOs, search indexes, SEO models, views.

Plane D  WRITE          DEFERRED. auth → authz → submit → validate → moderate →
                        audit → promote. Not implemented.
```

**Frozen rules**

- No plane may import from a later plane. C never reaches into A or B directly.
- Plane B never knows it is stored in SQLite or D1.
- Plane D does not exist yet. No partial write path, no "just this one endpoint".
- Ingestion never publishes a fact directly. It produces an assertion; promotion
  to canonical is a separate, reviewable step.

---

## 3. The evidence chain

Every fact in the product travels this path. No stage is optional.

```
SOURCE → INGESTION → EVIDENCE → ASSERTION → CANONICAL ENTITY → HISTORY →
PROJECTION → QUERY/API → FRONTEND
```

Concretely, in schema terms:

| Stage | Tables |
|---|---|
| Evidence | `sources`, `source_snapshots` |
| Assertion | `data_assertions`, `data_conflicts` |
| Canonical entity | `institutions`, `people`, `positions`, `branches`, `financial_metrics`, `documents`, `jobs`, … |
| History | `valid_from` / `valid_to` on assertions; `positions.ended_at`; `branch_history`; `timeline_events` |
| Operational | `ingestion_sources`, `ingestion_runs`, `ingestion_items`, `ingestion_errors`, `validation_results`, `audit_logs` |

**Frozen:** a fact with no `source_id` may not be displayed as fact. Discovery
(Grade D) may never be promoted to canonical truth without evidence.

---

## 4. Layers and who owns what

| Layer | Location | Owns | May import |
|---|---|---|---|
| Pages / routes | `src/app/**` | rendering, metadata, internal links | `@/lib/site-data`, components, utils |
| Components | `src/components/**` | presentation | same as pages |
| Site-data facade | `src/lib/site-data.ts` | the single sanctioned read seam | `@/data/*`, `@/types` |
| Generated snapshots | `src/data/*` | build output only | `@/types` |
| API Worker | `worker/src/**` | HTTP surface, security policy | `lib/api`, `lib/repository`, `./security` |
| Repository | `lib/repository/**` | the only module that knows SQL/D1 | `lib/*` |
| Contracts | `lib/api/contract.ts`, `lib/repository/contract.ts` | wire + domain interfaces, zero I/O | — |
| Ingestion | `lib/ingestion/**` | evidence production | ports only, never a concrete fetcher |
| Canonical store | SQLite / D1 | durable facts | — |

**Frozen:** the browser never queries a database. Enforced by R5.

---

## 5. The two read paths (both sanctioned)

The platform has deliberately two consumers of the same canonical data. This is
intentional, not duplication.

```
                      ┌─→ build-time projection → src/data/*.ts → static HTML
canonical store ──────┤
                      └─→ repository → API Worker → JSON consumers
```

- **Static path** (current): SEO-first, cheap, immutable per deploy. Pages read
  `src/lib/site-data`.
- **API path** (current, read-only): freshness for third parties and any data
  that changes between deploys. Worker serves the same projections.

**Frozen:** no second conceptual data model. The API and the static site are two
projections of one canonical store, never two stores.

---

## 6. Frozen decisions

Per directive §56, these may not change without explicit approval:

- Product definition and this four-plane architecture
- Database migration history (`migrations/0001..0007`, `schema/schema.sql`)
- M3.6B people lifecycle semantics
- Evidence principles and the assertion chain
- Source hierarchy (Grade A→D)
- Repository boundary (no browser DB access; repository owns SQL)
- Production domain and production data
- Privacy boundary — no borrower/member PII
- Activity contribution direction (institution-authorized first)
- Security baseline (CSP, HSTS, nosniff, frame-deny, CORS allowlist, rate limit,
  safe redirects, safe segments)

**If the architecture must change:** stop at the relevant phase, write an
`ARCHITECTURE CHANGE PROPOSED` block (why / impact / alternatives /
recommendation / approval required), and wait. Do not silently alter it.

---

## 7. What is explicitly NOT here

No Kubernetes, no microservices, no message broker, no Elasticsearch-class
search cluster, no Redis, no vector database, no auth system yet, no payments.

Rationale: one operator, low cost (§57, §58). Complexity is added only when a
measured limit forces it, and that decision is recorded, not assumed.

---

## 8. Verification

Architecture claims are checked, not asserted:

```bash
npm run typecheck            # 0 errors
npm run check:discipline     # R1–R6, 0 violations
npm run smoke                # repository contract
npm run smoke:worker         # API Worker end-to-end
npm run smoke:worker-security# edge security negative cases
npm run build                # static export
node scripts/audit-export.cjs# routes, links, anchors
```

Current state on this freeze: all green. See `WORKMAP.md` §P0.1 for the report.