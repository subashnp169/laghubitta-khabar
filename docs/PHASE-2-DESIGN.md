# Laghubitta Khabar — Phase 2 Design (Compare · Alerts · AI intelligence)

Design freeze for the next phase after the closed operational layer (M1.6). Builds on
`docs/ROADMAP.md` ("Phase 2: Compare, Alerts, AI intelligence"), the M1.5 NRB ledger,
and the M1.6 ingestion control plane. Deterministic-first, evidence-first, no schema
change, no publication without review.

## Status / scope

| Slice | Ops | Deterministic? | Gate |
|---|---|---|---|
| M2.1 Compare — side-by-side MFB comparison | yes | yes (all inputs are sourced data) | none |
| M2.2 Alerts — regulatory notifications | yes | yes (regulatory_events / coverage deltas only) | none |
| M2.3 AI intelligence | **deferred** | no | requires reviewed UNVERIFIED assertions + a human-review workflow first (Phase R discipline; not this pass) |

## 1. M2.1 Compare (institution comparison)

A `/compare` page comparing N selected MFBs (UI + shareable URL), strictly from data
already in the deterministic modules:

- **Identity:** license class (`D`), NRB license no., operation date, listed status,
  joint-after-merger flag.
- **Location:** head-office district / municipality / address, working area (national /
  province / district).
- **Capital:** `paidUpCapitalCrore` (NRB KFI, A-grade, as-of `2026-05-15`) — from the
  same universe as the institution pages.
- **Evidence footprint (web):** branch count, vacancy count, document count, snapshots,
  source health status, cadence — from `src/data/pilot.ts` (M1.6 fields included).
- **Regulatory footprint (NRB):** matched NRB documents (KFI/REPORT/ENFORCEMENT),
  regulatory events count, event types (MERGED/ACQUIRED/RENAMED), CLASS/LICENSE lines —
  from `src/data/nrb.ts`.

Rules: comparison is derived, never guessed. Missing data renders as `—` (honest), not 0.
All rows carried are the same UNVERIFIED-review caveat as institution pages. No new
tables; a pure projection module `lib/compare.ts` (testable) + `/compare` route built on
the existing data modules + a `smoke:compare` fixture test.

## 2. M2.2 Alerts (regulatory notifications)

Deterministic notification surface, not a recommender:

- **Event alerts:** from `regulatory_events` — MERGED / ACQUIRED / RENAMED with the
  involved institutions + `observed_at`. Rendered newest-first with source link and the
  `documents`/`outbound_links` evidence anchor.
- **Coverage alerts:** derived from `src/data/pilot.ts` — sources that went
  `UNHEALTHY`/`DEGRADED` or that have never produced snapshots (per control-room health
  semantics + M1.6 cadence/due state).
- **No free-text/AI summaries.** Alerts are rows of facts with evidence links, exactly
  the deterministic opinion-free contract. Subscriptions/wiring (email/webpush) are a
  later slice; this pass ships the feed page + `/alerts` route.

## 3. M2.3 AI intelligence — explicitly gated

Roadmap lists AI intelligence under Phase 2, but it requires (a) the UNVERIFIED
assertion far-data to pass human review and (b) a review/verification workflow bucket,
neither of which exists. This pass keeps the Phase R discipline: AI OFF. The design
commit records the gate so the roadmap doesn't lose the item.

## 4. Constraints (unchanged R1–R5)

- Deterministic only; no schema change; no `lk.db`/D1/public-site writes.
- Compare/Alerts read the existing generated modules (`pilot.ts`, `nrb.ts`,
  `institutions.ts`, `jobs.ts`, `documents.ts`); regeneration flows already exist.
- No new capabilities; no new crawler code; no seeds of fabricated values.
- Generated files stay generated; scripts, pages, types compile under the same
  battery (typecheck, eslint-scoped, check:discipline, build, smokes).

## 5. Non-goals this pass

Per-MFI financial values (Phase C), free-text analysis or LLM summaries (M2.3 gate),
notification delivery infrastructure, schema/DDL changes, any new capability kind.