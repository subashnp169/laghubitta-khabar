# PRODUCT-IA-AUDIT

Current state vs required IA. Based on existing codebase (f1465f8, staging).

## Pages audited

| Page | Purpose | Entity | Primary source | Canonical link | Evidence shown | Institution relationships | Missing-data behavior | Back to institution? |
|---|---|---|---|---|---|---|---|---|
| Homepage | Discovery hub (directory snapshot, search entry) | Multi-entity | Curated data (institutions/news/people context) | `/` | Provenance line present; counts shown honestly | Links to institutions/people/news/docs/jobs/financials/rates/research/reports/nrb/compare/alerts | Honest empty states; data-truth rules followed | N/A (global) |
| Institutions (index) | Directory of Class-D MFIs | Institution list | `src/data/institutions.ts` | `/institutions` | Evidence badges/grades on profile; identity fields | Links to `/institutions/[slug]` | Unknown states preserved where applicable | Yes (to profile) |
| Institution Profile | Canonical institutional intelligence | Institution (hub) | Canonical institution + evidence | `/institutions/[slug]` | Hero, sticky nav, per-field evidence, Grades A–D, Sources | Hub: links to People/News/Docs/Jobs/Financials/NRB/Compare; receives backlinks | Unknown/Not extracted used honestly; source anomaly handled for operation date | Self (canonical) |
| People | Leadership listing (source-owned) | People | `src/data/people.ts` + projection (M3.6B) | `/people` | Source meta, verification/conflict states (projection) | Each person links to institution profile | M3.6B semantics preserved; retired excluded | Yes (person row → institution) |
| Person Profile | Person detail with roles/sources | Person | Projection | `/people/[slug]` | Positions with evidence per role; sources list; corroboration | Links to institution profile | Honest states; no invented roles | Yes |
| News | Activity/news list | News/Post | `src/data/posts.ts` | `/news` | Dates formatted; category | Links to institution profiles where referenced | Standard empty states | Yes where institution tagged |
| News Detail | Article detail | Post | Data | `/news/[slug]` | Provenance/published date | Links back to institution(s) | N/A | Yes |
| Documents | Document catalogue (classified) | Document | `src/data/documents.ts` | `/documents` | Type, date, size, source context | Now links to owning institution profile (institutionHrefForId) | Empty states | Yes (row links to institution) |
| Jobs | Careers | Job | `src/data/jobs.ts` | `/jobs` | Deadline, location, institution | Links to institution profile | Empty states | Yes |
| Financials | Financial indicators/records | Financials | `src/data/financials.ts` + types | `/financials` | Periods, values, provenance | Links to institution profiles | Unknown preserved; no fabricated numbers | Yes |
| Interest Rates | Rates (context-aware) | Rates | `src/data/interest-rates.ts` | `/interest-rates` | Context required (0 numeric % shown as designed in current build) | Links to institutions | Shows 0 numeric % only by design constraint noted; must evolve to Unknown/Not extracted with product change | Yes |
| Research | Research findings/analyses | Research | `src/data/research.ts` | `/research` | Author/date/category/summary | Capital ranking + document-publisher link to institution profiles | Distinguish fact vs analysis (needs explicit labeling) | Yes |
| Reports | Industry reports | IndustryReport | `src/data/reports.ts` | `/reports` | Metrics with trend/change | Links to context where applicable | Honest metrics | Contextual |
| NRB | NRB documents/events/summary | NRB (docs/events/links/sources) | `src/data/nrb.ts` | `/nrb` | Types/topics, dates, institution links | Links to institution profiles | Scope clarified; organized by type | Yes |
| Compare | Comparison | Multi-institution | Institutions + related data | `/compare` | Side-by-side | References institutions | Partial data states needed; period discipline required | Yes |
| Alerts | Alerts (evidence changes) | Alerts | `src/data/alerts.ts` | `/alerts` | Evidence change basis | Links to institutions/entities | No fabricated alerts | Yes |
| Ingestion | Pipeline/telemetry (operational) | Crawl sources/summary | `src/data/ingestion.ts` | `/ingestion` | Runs/snapshots/docs/errors, cadence, due/paused; dense Stat | Links to institutions | Operational honesty; telemetry relocated to Sources on profile | Yes |

## Key findings

1. **Canonical hub**: `/institutions/[slug]` is established as source-backed microsite with hero, sticky nav, per-field evidence, Grades A–D, Sources & methodology (pipeline telemetry relocated there). This matches §36 goal.
2. **Identity canonicalization**: Single `institution_id/slug` referenced across People/News/Documents/Jobs/Financials/NRB/Research (many backlinks added). But need global audit for any remaining inconsistent mappings/old pilot IDs (especially any `mfi-045`-style unresolved). Current institutions use stable slugs; must enforce "no unresolved institution identity published".
3. **M3.6B frozen**: People use projection with source-owned assertions, conflict/rejection/retired semantics. Correct — do not modify.
4. **Document classification**: Documents exist as generic list; taxonomy (AR/AFS/interim/CG/AGM/notices/regulatory/vacancy/branch/M&A/policy/NRB/research) not fully surfaced as filterable classes. Connectivity to institution added.
5. **Interest rates**: Current `/interest-rates` shows 0 numeric % by design in current state; product logic requires Unknown/Not extracted with full context (product/category/rate type/effective date/period/source). This is a logic change (not just UI polish).
6. **Financials**: Period discipline (reporting period vs publication date vs as_of) and "NRB-published vs institution-published vs derived" not consistently labeled across UI. Historical never overwritten — data model supports, UI labeling partial.
7. **Branches**: Not surfaced as first-class list on institution profile yet (operations summary present; branches as structured list with address/district/province/status/events missing).
8. **Governance**: Leadership shown via People; CG report/document refs not explicit as governance section with evidence requirements.
9. **Regulatory events vs News vs Documents**: Semantics defined logically, but UI buckets overlap (NRB page mixes docs/events). Need clearer separation.
10. **Status vocabulary**: Evidence grades A–D used; product-wide vocabulary (VERIFIED/REPORTED/PARTIAL/CONFLICT/STALE/UNKNOWN/NOT_EXTRACTED/NOT_FOUND/HISTORICAL) not uniformly applied across all pages.
11. **Missing-data honesty**: Strong overall (no fabricated numbers/sentinels). Interest rates and branch coverage are main areas needing vocabulary enforcement.
12. **Connectivity**: Bidirectional links established (Research/Documents→Institution, Institution→People/News/Jobs/Financials/NRB). Good foundation.
13. **Schema**: No schema changes in this cycle (per §33). Types cover core entities; adding branch/governance structures as data shape is possible without DB migration if we keep to existing data files (static export). 
14. **Research labeling**: Must distinguish source-derived fact vs Laghubitta Khabar calculation vs analysis vs external.

## Consistency gaps (actionable)

| Gap | Impact | Fix type | Priority |
|---|---|---|---|
| Status vocabulary inconsistent across pages | Medium (semantics drift) | Shared constants + apply to UI labels | P1 |
| Interest rates missing full context + Unknown/Not extracted | High (logical correctness) | Data model fields + display rules (no naked %) | P1 |
| Branches not first-class on institution profile | High (core ops) | Add Branches section with structured fields + evidence | P1 |
| Governance explicit (CG report, committees) | High | Add Governance section + link to docs/people | P1 |
| Document taxonomy not exposed as filters/classes | Medium | Taxonomy mapping + UI filters | P2 |
| Regulatory events vs News vs Documents separation in UI | Medium | Clear labeling + filters | P2 |
| Financial period discipline labeling (reporting period vs pub vs as_of) | High | Consistent column/field labels + evidence line | P1 |
| Research: fact vs analysis labeling | Medium | Add badge/label per item | P2 |
| Compare: period discipline + partial states | Medium | Enforce same period/definition or label explicitly | P2 |
| Global institution mapping audit (pilot IDs/slugs) | High (identity correctness) | Verify all refs resolve to canonical slug/id; reject unresolved | P0 |

## Assessment

- **Strengths**: Canonical hub established, M3.6B preserved, strong data-truth, good connectivity, provenance/evidence grades present.
- **Weaknesses**: Interest rates context, branches/governance first-class, vocabulary uniformity, period discipline labeling, document taxonomy surfaced.
- **Architecture direction**: Matches hub-and-spoke (Institution canonical). Need to enforce vocabulary, period discipline, and classification across all pages.