# DATA-FLOW — Phase P0.1 Freeze

**Status:** FROZEN (Phase P0.1)

How a fact travels from a publisher's website to a reader's screen, and where it
can currently break.

---

## 1. Canonical flow

```
SOURCES                NRB · MFB websites · filings · media
   │
   ▼  Plane A — INGESTION
DISCOVER ─ REGISTER SOURCE ─ FETCH ─ SNAPSHOT ─ EXTRACT ─ NORMALIZE ─ VALIDATE
   │                                                                    │
   │                                                            GENERATE ASSERTIONS
   │                                                                    │
   │                                                             DEDUPLICATE ─ CONFLICT CHECK
   │                                                                    │
   └──────────────────────────────────────────────────────────────►  REVIEW
                                                                            │
                                                              PROMOTE TO CANONICAL
                                                                            │
   ▼  Plane B — CANONICAL                                                   │
EVIDENCE (sources, snapshots) ── ASSERTIONS ── ENTITIES ── HISTORY
   │
   ▼  Plane C — READ
PROJECTION  (InstitutionSummary, InstitutionDetail, …)
   │
   ├──────────────► build-time: scripts/*-export.ts → src/data/*.ts → static HTML
   │
   └──────────────► runtime: lib/repository → worker/src → JSON
```

---

## 2. Ingestion pipeline stages and where they live

| Stage | Module | State today |
|---|---|---|
| Discover | `lib/ingestion/discovery.ts`, `people-discovery.ts`, `career-discovery.ts` | working, capability-driven |
| Register source | `ingestion_sources` table, `lib/ingestion/config.ts` | working |
| Fetch | `lib/ingestion/fetcher.ts`, `fetcher.node.ts` | working; host allowlist, size caps, timeouts |
| Canonicalize/hash | `lib/ingestion/canonical.ts` | working; drives idempotency |
| Extract | `lib/ingestion/structured.ts` (69 KB), `branch-external.ts` (53 KB), `people.ts` (50 KB), `careers.ts` (75 KB) | working |
| Normalize/dedupe | `lib/ingestion/canonical.ts`, `shape-signals.ts` | working |
| Validate | `lib/ingestion/validators.ts` | working |
| Assert | writes `data_assertions` + `source_snapshots` | **working, but not durable across runs** |
| Conflict check | `data_conflicts` | **229 rows in 3 evidence DBs — works, never reviewed** (P0.2 correction) |
| Review | `lib/ingestion/review.ts` | concept + module exist, not wired to a UI |
| Promote | `scripts/run-*-apply.ts` | working per-phase |
| Project | `scripts/pilot-export*.ts`, `build-*-module.ts`, `generate-nrb-data.ts` | working |

**The two structural gaps, precisely:**

1. **Runs are not durable.** Each pilot run creates a new dated DB under
   `data/pilot/evidence/`. 13 exist. Nothing accumulates into one history. This
   is P0.5.
2. **Conflicts are detected and stored, but never reviewed.** *(Corrected in
   P0.2: earlier drafts of this document claimed `data_conflicts` was never
   written. Measured: **229 rows** across 3 evidence DBs, all `people_ceo`, all
   `OPEN`.)* So detection and persistence work; **review, resolution, and coverage
   do not** — `resolved_by`/`resolved_at`/`resolution_note` are NULL on all 229,
   only `people_ceo` fields are covered, and the Nirdhan capital disagreement has
   no row at all. `crawlSummary.conflictsOpen` reports 0 because the generated
   export drops them. P0.4/P0.5 must close this.

---

## 3. Read flow, build-time

```
data/pilot/evidence/*.db  ─┐
data/master/master.json    ─┼─→ scripts/pilot-export*.ts ─→ src/data/*.ts
data/pilot/*.json          ─┘                             (GENERATED)
                                                              │
data/master/master.json ─→ scripts/seed.cjs ─→ lk.db          │
                                                    ↓         │
                                          scripts/*-export  │
                                                              ↓
                                              src/lib/site-data.ts
                                                              │
                                                              ↓
                                              Next static export → out/
```

Regenerating `src/data/*` is **not** a hand edit. Each generated file carries a
`GENERATED FILE - do not edit` header naming its generator, and the public site
displays the provenance string (e.g. `financialsProvenance` states record counts
and that contents were never read).

That provenance string is a product feature: a reader can see how much of a
number was actually verified.

---

## 4. Read flow, runtime

```
GET /api/institutions?page=1&limit=20
   │
   ├→ security.ts: OPTIONS? → 204
   ├→ security.ts: token bucket → 429 + Retry-After
   ├→ method guard → 405 unless GET
   ├→ safeSegment(slug) → reject traversal
   ├→ route match
   ├→ repository → D1
   ├→ envelope from lib/api/contract.ts
   └→ security headers + CORS + Vary: Origin
```

Read-only V1. No write path exists.

---

## 5. Provenance propagation to the reader

This is the part that makes the product trustworthy, and it must survive every refactor.

```
source_snapshots.content_hash
   → data_assertions.source_id + observed_at + confidence
   → repository DTO meta.sources[] + meta.source_url + meta.last_verified_at
   → projection
   → page renders grade + "as of" + link to source
   → public sees the chain, not just the number
```

`ApiMeta` already carries `sources[]`, `source_url`, `last_verified_at`,
`verification_status`. The frontend must keep rendering that state rather than
flattening it to a bare value.

---

## 6. Where the flow is currently unsound

| # | Issue | Impact | Phase |
|---|---|---|---|
| 1 | Evidence accumulates in parallel dated DBs, not one store | No durable history; every run restarts | P0.5 |
| 2 | Conflicts stored (229) but never reviewed or resolved | Disagreements resolve by publication preference, not evidence | P0.4, P0.5 |
| 3 | `lk.db` has 0 assertions; evidence lives only in pilot DBs | The "canonical" store holds only the universe | P0.5 |
| 3b | No `as_of` column in any of the 53 tables | A source's own as-of date exists only in generated TS | P0.5 |
| 4 | Normalized tables (`branches`, `people`, `financial_metrics`) empty while pages render | Live site fed by assertions → export → TS, bypassing normalized tables | P0.2 |
| 5 | Every institution `websiteStatus` is `candidate`; all `officialWebsite` null | No brand/logo/social features have data to show | P1/P7 |
| 6 | `review.ts` not wired to any operator surface | Human-in-the-loop gate is manual and undocumented | P14 |
| 7 | Search runs against generated TS, not an index | Fine at 334 pages; re-evaluate at scale, not before | P9 |

---

## 7. Freshness vs verification

These are different and the system must never conflate them:

```
retrieved_at     when we last fetched the source
source_as_of     what date the source itself claims
verified_at      when a human or rule confirmed the fact
```

`docs/DATA-GOVERNANCE.md` vocabulary. A record can be freshly retrieved and still
unverified (all 48 financial documents currently are). Freshness classes
(`fresh`/`aging`/`stale`/`unknown`) are planned, not yet computed.

---

## 8. Freeze statement

The **stages** and their **order** are frozen. The **storage** they write to is
deliberately open (`STORAGE-ADAPTER-STRATEGY.md`). No flow may skip a stage, and
no stage may publish directly to the public site.