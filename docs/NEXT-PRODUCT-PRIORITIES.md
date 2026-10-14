# NEXT-PRODUCT-PRIORITIES

Ranked by impact/risk. P0 = factual risk; P1 = core; P2 = coverage; P3 = UX; P4 = intelligence.

## P0 — Factual risk

| # | Capability | Rationale | Effort | Owner logic | Done? |
|---|---|---|---|---|---|
| P0-1 | Global institution identity audit (all refs resolve to canonical id/slug; reject unresolved; hunt for pilot IDs like `mfi-045`-style) | Wrong identity is highest risk. | M | Data + types + all pages | Yes (build gate scans every published `institution_id`/`institution_slug`; found + removed 10 internal `hist-evt-…`/`evt-…` keys leaked into reader-facing NRB event descriptions at the ledger→site boundary) |
| P0-2 | Enforce "no unresolved institution identity published" (hard guard) | Prevents cross-entity mixups | S | Build-time/data validation | Yes (`scripts/check-institution-identity.ts` — canonical uniqueness, alias coherence, all 5488 refs resolve, no `mfi-…`-as-slug, no internal-id/bare-evidence text leaks; wired as `prebuild` so `npm run build` cannot publish a broken reference) |
| P0-3 | Preserve M3.6B semantics; detect accidental drift | People correctness | S | Review only | Yes (frozen) |
| P0-4 | Data-truth guardrails (no sentinel dates, Rs null/undefined/NaN, fabricated counts) | Already strong; codify as invariant checks | S | Discipline script + build checks | Yes (`scripts/check-data-truth.ts` codifies the `docs/DATA-STATUS-VOCABULARY.md` missing-data rules as build invariants: no sentinel date published as fact — `1900-01-09` passes only where `operationDateStatus: "source_anomaly"`; no `null`/`undefined`/`NaN` token in any published string and no `NaN` number; no zero-for-unknown — `paidUpCapitalCrore` is null or > 0, summary counts are non-negative integers, confidences are null or within [0,1]; counts reconcile with their rows — directory, NRB document/link/event totals + event-type breakdown, crawl sources. Wired into `prebuild` beside the identity guard; negative-tested) |`
| P0-5 | Historical institutions not presented as current | Lifecycle status must be explicit | S | Institution profile + lists | Yes (`src/util/evidence.ts` owns the lifecycle vocabulary fixed by INSTITUTION-MASTER-MODEL (`ACTIVE`/`MERGED`/`ACQUIRED`/`LIQUIDATED`/`CLOSED`/`SUSPENDED`/`HISTORICAL`/`LICENSE_STATUS_UNKNOWN` via `institutionStatus` + `isCurrentInstitution`); `licenseStatus` now carries the canonical token everywhere (was the non-canonical literal `licensed`); profile shows an explicit lifecycle chip and, for any non-active institution, a "kept as a historical record, not current" notice and overview line; directory cards + homepage count route through the same helpers; `smoke:vocabulary` asserts every published institution carries a canonical token) |`

## P1 — Core product

| # | Capability | Rationale | Effort | Owner logic | Done? |
|---|---|---|---|---|---|
| P1-1 | Branches as first-class (list + fields + evidence + status/events) on institution profile | Core ops; Unknown ≠ 0 | M | Institution model + UI | Yes (branches panel: list + source link + verification status) |
| P1-2 | Governance section explicit (Board/committees/CG report refs + evidence) | Governance required by directive | M | Institutions + Docs + People | Yes (Governance panel: board/officer counts, committees Not extracted, CG refs) |
| P1-3 | Interest rates: full context + Unknown/Not extracted/NOT_FOUND; never naked % | Logical correctness; current 0% is design artifact to evolve | M | Data model + UI rules | Yes (context fields + `rateValue` rule; never naked %) |
| P1-4 | Financial period discipline labeling (reporting period vs publication date vs as_of; NRB vs institution vs derived) | Comparability + correctness | M | Financials + Institution profile | Yes (period fields + `source_owner`; labelled reporting/pub/as-of/observed) |
| P1-5 | Document taxonomy surfaced (class filters + institution profile grouping) | NRB requires separation (regulatory vs docs) | M | Documents + Institution | Yes (evidence-derived classes + filters on `/documents`; institution Documents panel grouped by class) |
| P1-6 | Regulatory Events vs News vs Documents separation (clear UI buckets + filters) | Semantics correct | M | NRB/News/Docs | Yes (shared content-bucket vocabulary + legend on `/nrb`/`/news`; consistent labels across `/alerts` + institution; kind filters) |
| P1-7 | Uniform status vocabulary across all pages (use DATA-STATUS-VOCABULARY) | Semantic consistency | S | Shared constants + UI | Yes (single `evidence.ts` vocabulary for source health incl. `UNHEALTHY`/`NEVER-RUN`, run outcome, and evidence field state; ingestion/Provenance/people/institution chips routed through it; canonical `Unknown` fallback) |
| P1-8 | Timeline unified per institution (evidence-backed) | History coherent | M | Institution + Events | Yes (dated timeline built only from verifiable-dated records — operation date + branch openings; undated NRB lineage events excluded from the date axis and left to the "Regulatory events" panel; the observation-date fallback is never rendered as an event date) |
| P1-9 | Canonical hub completeness: ensure all cross-links use canonical identity | Connectivity solid; finish audit | S | All features | Yes (acceptance suite `smoke:canonical-links` locks every cross-link to a canonical slug/id; superseded slugs now resolve to their canonical hub instead of being dropped) |

## P2 — Coverage

| # | Capability | Rationale | Effort | Owner logic | Done? |
|---|---|---|---|---|---|
| P2-1 | Research: label fact vs analysis vs calculation vs external | Clarity | S | Research | Yes (every `/research` section carries a statement-kind chip defined once in `src/util/research.ts`: Fact / Calculation / Analysis / External; a reader legend defines all four and declares `external` deliberately unused — the project cites no third-party research; `smoke:research` locks the four-kind vocabulary and the "unknown falls back to analysis, never fact" rule) |
| P2-2 | Compare: enforce period/definition equality or explicit labeling; partial states | Comparability | M | Compare | Yes (every row declares its `source` and a `comparability` class in `lib/compare.ts` — `comparable` / `context` / `telemetry`; the view labels each row with a basis badge and the page legend explains all three; per-row coverage is computed by `metricCoverage` and a partly-recorded row shows a `partial n/m` marker; `smoke:compare` locks the labeling, the source/class pairing and the coverage states — 27 → 42 checks) |
| P2-3 | Digital presence/branding only if verified (no guessing colors/logos) | Data-truth | S | Institution | Yes (one `websiteStatus` vocabulary + `isVerifiedWebsite` gate in `src/util/evidence.ts`; a candidate website is shown as an `unconfirmed` lead, never as the official site, and the profile's "Official website" row reads `Not confirmed` unless verified; `BRANDING_NOTE` states logos/colours are never shown and no institution carries a brand-asset field; `smoke:vocabulary` 91 → 208 checks) |
| P2-4 | Branch coverage completeness state (Unknown/Partial/Not extracted) | Honest | S | Branches | Yes (one `branchCoverage()` mapping in `src/util/branches.ts` — Partial / Not extracted / Unknown; the profile's Branches panel shows the state as a chip and the empty state reads "Not extracted — a coverage gap, not a statement that the institution has no branches" instead of "No branches published"; `smoke:branch-coverage` locks the three states and the never-zero rule) |
| P2-5 | Career→Document/Notice linkage where applicable | Connectivity | S | Jobs/Docs | Yes (one `careerDocumentLinks()` mapping in `src/util/linkage.ts`; the profile's Careers and Documents panels point at each other when both exist, and `/jobs` ↔ `/documents` link to each other; every link is a canonical in-hub anchor `/institutions/<slug>#careers|#documents`, never a name or a parsed id; `smoke:linkage` locks the applicability rule and the canonical identity over all 51 institutions) |
| P2-6 | NRB section: stronger categorization (Directives/Circulars/MFI Situation/KFIs/Interest Rates/Progress/Sources&Uses/Supervision/Reg Events) | Maps to NRB-SOURCE-MAP | M | NRB | Yes (one `nrbCategory()` vocabulary in `src/util/nrb.ts` maps each document to the NRB-SOURCE-MAP publication series — Directives, Circulars, MFI Situation, KFIs, Interest Rates, Progress, Sources & Uses, Supervision, Licensed list, Annual Reports, AML/CFT, Enforcement — evaluated in order so a narrower series wins over the generic "Annual report" rule; the NRB page groups and jumps by series and says plainly which declared series this snapshot does not contain instead of hiding them; `smoke:nrb` locks the vocabulary, the one-series-per-document rule and the declared-but-absent rule) |

## P3 — UX

| # | Capability | Rationale | Effort | Owner logic | Done? |
|---|---|---|---|---|---|
| P3-1 | Mobile nav/IA polish (drawer extras already added in source; keep consistent) | Usability | S | Layout | Done (source) |
| P3-2 | Institution profile nav remains usable at 320–1440 | Mobile-first IA | S | CSS/layout | Yes (the mobile bar's targets are now 44px (`min-h-11`) and it scrolls rather than wraps (`lk-scroll-x` + `min-w-max`), so it works at 320; the desktop rail and the mobile bar are one list shown one-per-breakpoint (`hidden lg:block` / `lg:hidden`) and the sticky offset tracks the header height (`top-14`/`h-14`, `sm:top-16`/`sm:h-16`); `smoke:profile-nav` locks the tap target, the no-duplicate-links rule and that every `#anchor` resolves to a section id) |
| P3-3 | Shared primitives (Stat/Panel/SectionNav/Breadcrumb) consistently applied | Uniformity | S | Components | Done |
| P3-4 | Empty/Partial/Conflict states standardized | UX consistency | S | Shared | Yes (one `StateNote` primitive in `src/components/ui/EmptyState.tsx`, beside `EmptyState`; `tone` reuses the status vocabulary so amber = partial/attention and red = conflict, and the padding/size/colour live in exactly one place; the five pages that carried hand-rolled amber callouts now use it; `smoke:ui-states` locks the tones and fails any reintroduced ad-hoc callout) |

## P4 — Intelligence

| # | Capability | Rationale | Effort | Owner logic | Done? |
|---|---|---|---|---|---|
| P4-1 | Alerts driven by actual evidence changes (not fabricated) | Future | L | Alerts | Concept only |
| P4-2 | Search: entity-type labels + coverage expansion (branches/reg events/metrics) | Discovery | M | Search | Done |
| P4-3 | AI sits above evidence layer (never replaces) | Architecture | L | Future | Done (`docs/AI-ABOVE-EVIDENCE.md` consolidates the rule from the 7 scattered docs into one accepted ADR: AI may propose claims but never publishes one, the read plane cannot see `data_assertions`, and M2.3 stays gated until UNVERIFIED assertions are reviewed) |

## Top 10 recommendation (next engineering cycle)

1. **P0-1/P0-2**: Complete global institution identity audit + unresolved-identity guard (factual correctness).
2. **P1-1**: Add Branches as first-class on institution profile (structured list + evidence + status).
3. **P1-2**: Add Governance section (Board/committees + CG report refs) linking to People/Documents.
4. **P1-3**: Evolve Interest Rates to full context + Unknown/Not extracted (replace naked % display rule with vocabulary).
5. **P1-4**: Enforce financial period discipline labeling (reporting period/pub/as_of; NRB vs institution vs derived).
6. **P1-5**: Surface document taxonomy (filters/classes) + group on institution profile.
7. **P1-6**: Separate Regulatory Events/News/Documents (clear buckets/filters).
8. **P1-7**: Apply DATA-STATUS-VOCABULARY uniformly (shared constants).
9. **P1-8**: Build unified Timeline per institution (evidence-backed).
10. **P2-1**: Research labeling (fact vs analysis vs calculation vs external) + link back to sources/institutions.

**Focus**: Foundation correctness (identity + branches + governance + rates context + period discipline + vocabulary). Do not redesign everything visually; fix logical consistency.