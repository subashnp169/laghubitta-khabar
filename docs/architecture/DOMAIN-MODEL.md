# DOMAIN-MODEL — Phase P0.1 Freeze

**Status:** FROZEN (Phase P0.1). Logical model only. **No migration change.**

Directive §9 and §P0.2. The 53-table schema already implements most of this; the
work here is reconciliation, not invention.

---

## 1. Identity rules

1. A canonical entity has a stable internal `id` and a stable public `slug`.
2. `slug_aliases` preserves old slugs. Renaming never breaks a URL or a backlink.
3. Names are **not** identity. `institution_aliases` carries every observed
   spelling, including `FORMER` and `NAME_NP`.
4. Mergers and acquisitions are **events on entities that persist**, not deletions.
   Predecessor/successor links live in `timeline_events`, never in a hard swap.
5. Source noise is preserved, not repaired. The regulator sentinel
   `1900-01-09` on Infinity is a real observation and is retained as such.
6. Disputed identities are **retained in a non-conflicting state**. Nothing is
   deleted to make a list tidy.

---

## 2. Entities and their schema home

| Entity | Tables | Phase |
|---|---|---|
| Institution | `institutions`, `institution_aliases`, `institution_symbols`, `slug_aliases` | P1 |
| People | `people` | P2 |
| Positions / tenure | `positions` | P2 |
| Committees | `committees`, `committee_members` | P2 |
| Branches | `branches`, `branch_history` | P3 |
| Centers | *not in schema* | P10 (needs approval — new migration) |
| Geography | `branches.province/district/municipality/ward/geo_lat/geo_lng` | P3 |
| Financials | `financial_reports`, `financial_metrics`, `interest_rate_periods`, `interest_rates` | P4 |
| Dividends / closures | `dividends`, `book_closures` | P4 |
| Documents | `documents`, `document_extractions`, `document_categories` | P5 |
| Jobs | `jobs` | P6 |
| News / posts / research | `news`, `posts`, `post_sources`, `research` | P6 |
| Events / timeline | `events`, `timeline_events` | P8 |
| Digital / social | `social_accounts`, `digital_services`, `official_links`, `products`, `services` | P7 |
| Regulatory | `nrb_documents`, `nrb_directives`, `nrb_institution_links`, `regulatory_events` | P6 |
| Evidence | `sources`, `source_snapshots`, `data_assertions`, `data_conflicts` | frozen now |
| Coverage | `institution_coverage` (10 dimensions) | P1 |
| Activity / Media | *not in schema* | P10/P12 (needs approval) |
| Auth / roles | `users`, `roles` (empty) | P11 |

**Gap noted, not fixed:** Centers and Activity have no tables. Both are deferred to
P10 and will require an approved migration. This document does not authorise one.

---

## 3. Field-level provenance

Every meaningful field traces to a source. The mechanism is `data_assertions`:

```
entity_type + entity_id + field_name + value
  + source_id + source_snapshot_id
  + observed_at + valid_from + valid_to
  + confidence + verification_status
```

`verification_status`: `UNVERIFIED`, `AUTO_VERIFIED`, `HUMAN_VERIFIED`,
`CONFLICT`, `STALE`, `REJECTED`.

**Frozen:** a displayed fact is never a bare value. It carries its source, its
`as_of`, and its verification state. The UI's job is to make that visible.

---

## 4. History

The system must answer **"what was true at that time?"**, not only "what is true
now?"

| Change | Mechanism |
|---|---|
| CEO A → CEO B | Two `positions` rows; A keeps `ended_at`. A never disappears. |
| Branch opened / closed | `branches.status` + `branch_history` row |
| Branch relocated | `branch_history` `RELOCATED` with from/to |
| Merger / acquisition / rename | `timeline_events` with `predecessor_id` |
| Official URL changed | `official_links` row with `verified_at`; old stays |
| Financial period | `financial_metrics` rows are per-report and never overwritten |
| Interest-rate change | New `interest_rate_periods` row |

**Frozen:** `valid_to` on an assertion, or `ended_at` on a position, is the only
acceptable way to express "no longer true". Deleting the row is a bug.

---

## 5. Source hierarchy

| Grade | Sources | Use |
|---|---|---|
| A | NRB, official MFB, regulatory filings | Canonical truth |
| B | NEPSE, official exchange data | Supporting |
| C | Reputable media, established research | Context, corroboration |
| D | Other sources, old reference datasets | **Discovery only. Never canonical.** |

**Frozen:** Grade D never silently becomes canonical. The old SENNA dataset
(`C:\Users\Lenovo\Documents\Default Project\senna-mfi-intelligence`) is Grade D —
reference, cross-check and lineage discovery only.

---

## 6. Conflict handling

When sources disagree, the platform shows the disagreement rather than resolving
it silently.

```
NRB says capital = 261.21 crore   (as of 2025-10)
MFB site says     = 274.27 crore  (as of 2026-05)
```

→ two assertions, both retained, each with its own `as_of` and source. Surfaced as
`CONFLICT` for an operator. The live site currently shows 274.27 (from
`nrb-bfi-mid-may-2026`, grade A, `asOf 2026-05-15`) — that is a *published
preference*, not a resolution, and the older value must remain recoverable.

**Frozen:** operator-resolvable states (`confirmed`, `probable`, `needs_review`,
`conflicting`, `superseded`, `rejected`) via `data_conflicts`.

---

## 7. Coverage as a first-class concept

`institution_coverage` carries 10 dimensions per institution: identity,
leadership, branch, financial, document, news, digital, product, career, plus
`overall_status` and review dates.

This makes data quality **operational** rather than aspirational — it is the
control panel's fuel, and it is why one person can run the platform.

**Frozen:** coverage is an internal quality label. It is never shown to the
public as a score, and it never affects factual ranking.

---

## 8. Privacy boundary

**Frozen, no exceptions:**

- No borrower/member PII. No phone numbers, citizenship numbers, KYC documents,
  account numbers, or personal financial information.
- No public member database. No member MIS.
- Leadership and board members are public-role facts with sources — that is
  different from member data and is in scope.
- Identifiable people in future Activity require consent, purpose, source,
  takedown and moderation design **before** any capture.

---

## 9. AI boundary

AI may assist extraction, classification, deduplication and document parsing. AI
is never the source of truth. Every AI-derived value is still an assertion with a
source, a confidence, and a verification state.

**Frozen:** the system must distinguish `machine-extracted`, `human-reviewed`, and
`officially verified`. These are different things and are never collapsed.