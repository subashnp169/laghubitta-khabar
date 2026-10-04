# NEXT-PRODUCT-PRIORITIES

Ranked by impact/risk. P0 = factual risk; P1 = core; P2 = coverage; P3 = UX; P4 = intelligence.

## P0 — Factual risk

| # | Capability | Rationale | Effort | Owner logic | Done? |
|---|---|---|---|---|---|
| P0-1 | Global institution identity audit (all refs resolve to canonical id/slug; reject unresolved; hunt for pilot IDs like `mfi-045`-style) | Wrong identity is highest risk. | M | Data + types + all pages | Partial (hub+backlinks done; full audit needed) |
| P0-2 | Enforce "no unresolved institution identity published" (hard guard) | Prevents cross-entity mixups | S | Build-time/data validation | No |
| P0-3 | Preserve M3.6B semantics; detect accidental drift | People correctness | S | Review only | Yes (frozen) |
| P0-4 | Data-truth guardrails (no sentinel dates, Rs null/undefined/NaN, fabricated counts) | Already strong; codify as invariant checks | S | Discipline script + build checks | Strong (verified in build) |
| P0-5 | Historical institutions not presented as current | Lifecycle status must be explicit | S | Institution profile + lists | Partial |

## P1 — Core product

| # | Capability | Rationale | Effort | Owner logic | Done? |
|---|---|---|---|---|---|
| P1-1 | Branches as first-class (list + fields + evidence + status/events) on institution profile | Core ops; Unknown ≠ 0 | M | Institution model + UI | No |
| P1-2 | Governance section explicit (Board/committees/CG report refs + evidence) | Governance required by directive | M | Institutions + Docs + People | Partial (People linked) |
| P1-3 | Interest rates: full context + Unknown/Not extracted/NOT_FOUND; never naked % | Logical correctness; current 0% is design artifact to evolve | M | Data model + UI rules | No (needs logic change) |
| P1-4 | Financial period discipline labeling (reporting period vs publication date vs as_of; NRB vs institution vs derived) | Comparability + correctness | M | Financials + Institution profile | Partial |
| P1-5 | Document taxonomy surfaced (class filters + institution profile grouping) | NRB requires separation (regulatory vs docs) | M | Documents + Institution | Partial (connectivity done) |
| P1-6 | Regulatory Events vs News vs Documents separation (clear UI buckets + filters) | Semantics correct | M | NRB/News/Docs | Partial |
| P1-7 | Uniform status vocabulary across all pages (use DATA-STATUS-VOCABULARY) | Semantic consistency | S | Shared constants + UI | No |
| P1-8 | Timeline unified per institution (evidence-backed) | History coherent | M | Institution + Events | No |
| P1-9 | Canonical hub completeness: ensure all cross-links use canonical identity | Connectivity solid; finish audit | S | All features | Partial |

## P2 — Coverage

| # | Capability | Rationale | Effort | Owner logic | Done? |
|---|---|---|---|---|---|
| P2-1 | Research: label fact vs analysis vs calculation vs external | Clarity | S | Research | No |
| P2-2 | Compare: enforce period/definition equality or explicit labeling; partial states | Comparability | M | Compare | No |
| P2-3 | Digital presence/branding only if verified (no guessing colors/logos) | Data-truth | S | Institution | Partial (rules exist) |
| P2-4 | Branch coverage completeness state (Unknown/Partial/Not extracted) | Honest | S | Branches | No |
| P2-5 | Career→Document/Notice linkage where applicable | Connectivity | S | Jobs/Docs | No |
| P2-6 | NRB section: stronger categorization (Directives/Circulars/MFI Situation/KFIs/Interest Rates/Progress/Sources&Uses/Supervision/Reg Events) | Maps to NRB-SOURCE-MAP | M | NRB | Partial (existing types) |

## P3 — UX

| # | Capability | Rationale | Effort | Owner logic | Done? |
|---|---|---|---|---|---|
| P3-1 | Mobile nav/IA polish (drawer extras already added in source; keep consistent) | Usability | S | Layout | Done (source) |
| P3-2 | Institution profile nav remains usable at 320–1440 | Mobile-first IA | S | CSS/layout | Partial (static only) |
| P3-3 | Shared primitives (Stat/Panel/SectionNav/Breadcrumb) consistently applied | Uniformity | S | Components | Done |
| P3-4 | Empty/Partial/Conflict states standardized | UX consistency | S | Shared | Partial |

## P4 — Intelligence

| # | Capability | Rationale | Effort | Owner logic | Done? |
|---|---|---|---|---|---|
| P4-1 | Alerts driven by actual evidence changes (not fabricated) | Future | L | Alerts | Concept only |
| P4-2 | Search: entity-type labels + coverage expansion (branches/reg events/metrics) | Discovery | M | Search | Partial |
| P4-3 | AI sits above evidence layer (never replaces) | Architecture | L | Future | Explicit rule |

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