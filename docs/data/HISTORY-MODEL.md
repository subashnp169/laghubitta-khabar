# HISTORY-MODEL — Phase P0.2

**Status:** FROZEN (Phase P0.2)

The question this model exists to answer:

> **What was known, from which source, and what was believed to be true at that
> time?**

Two distinct questions that are constantly confused:

```
WHAT HAPPENED        the real-world fact
WHAT WE BELIEVED      our reading of it, as of a date, from a source
```

---

## 1. The six dates — they are not interchangeable

| Date | Means | In schema? |
|---|---|---|
| `observed_at` | **we** saw the source say this | ✅ `data_assertions.observed_at` |
| `retrieved_at` / `fetched_at` | we fetched the page | ✅ `source_snapshots.fetched_at`, `sources.fetched_at` |
| `verified_at` | a human or rule confirmed it | ⚠️ `last_verified_at` on 14 tables + `official_links.verified_at` |
| `effective_from` / `valid_from` | the fact **became** true | ⚠️ `data_assertions.valid_from` only |
| `effective_to` / `valid_to` | the fact **stopped** being true | ⚠️ `data_assertions.valid_to` only |
| `published_at` | the source published it | ✅ 9 tables |

### The critical ambiguity: three clocks for one event

The NRB directory:

```
source claims asOf      2026-05-15     (published by NRB 2026-06-12)
we observed              2026-06-20     (universeSnapshot.observed_at)
assertion observed_at    (per assertion)
snapshot fetched_at      (per fetch)
verified                 2026-06-20
```

Five clocks. A reader asking "how current is this?" has five legitimate answers and
they differ by a month.

**Frozen:** `observed_at` means **we** saw it. It never stands in for the source's
own as-of date.

### The `as_of` gap

**No `as_of` column exists in any of the 53 tables.** The value `2026-05-15` exists
only inside the generated `src/data/institutions.ts` `evidence` map, emitted by
`scripts/generate-nrb-data.ts`.

A durable citation needs three dates:

```
what the source claims   as_of            ← MISSING from schema
when we captured it      observed_at      ✅
when we checked it       verified_at      ⚠️ partial
```

This is **FUTURE SCHEMA GAP**, and it is the highest-priority one in this
document. Without `as_of`, every date-stamped claim in the product rests on a
regenerable TypeScript file.

---

## 2. Bitemporal design

`data_assertions` is the **only** bitemporal table in the schema:

```
valid_from / valid_to    when the fact was true in the WORLD
observed_at              when WE learned it
```

Four states, and the distinction is the whole point:

| valid_from | valid_to | Meaning | Query |
|---|---|---|---|
| set | NULL | currently true | "what is true now" |
| set | set | true in a past interval | "what was true in 2024" |
| NULL | set | ended, start unknown | "known to have ended" |
| NULL | NULL | timeless / validity unknown | defaults |

**Answering "what was true at time T" requires `valid_from <= T < valid_to`
(filtering `NULL` as ±∞) — a single query, no rewriting.**

That is the property that makes mergers, CEO changes and rate changes answerable
without mutating history. Frozen.

### `valid_from`/`valid_to` exist NOWHERE else

`positions` uses `appointed_at`/`ended_at`. `committee_members` uses
`from_date`/`to_date`. `committees` uses `formed_at`/`dissolved_at`.
`nrb_documents` uses `effective_date`. `outbound_links` uses `first_seen_at` /
`last_checked_at`.

**Five temporal vocabularies in one schema.** Not wrong — domain-specific names are
more readable than `valid_from` everywhere — but they must be **documented and
mapped**, because a projection joining `positions` to `branches` must know that
`ended_at` and `to_date` mean the same thing.

Canonical mapping:

| Canonical | Domain names |
|---|---|
| `valid_from` | `appointed_at`, `from_date`, `formed_at`, `effective_date`, `opened_at`, `occurred_at`, `first_seen_at`, `published_at` |
| `valid_to` | `ended_at`, `to_date`, `dissolved_at`, `closed_at` |

### Future SCHEMA GAP: no status history

`institutions.status` is a **current value with no transition log**. There is no
`institution_status_history` table, so *"when did this institution become
MERGED?"* is unanswerable from the normalized layer. `timeline_events` with
`event_type='MERGED'` is a partial substitute — it records that a merger happened,
not that the status field changed.

**FUTURE SCHEMA GAP 1.** Fix requires a migration. Not done in P0.2.

---

## 3. Historical handling by entity

### Institution names

**A rename does not change identity.** Frozen.

```
identity   institutions.id          never changes
current    institutions.name_en     mutable
former     institution_aliases      alias_type='FORMER', appended
URL        slug_aliases             old_slug → moved_to
lineage    timeline_events          event_type='RENAMED'
```

The frontend's `aliases: string[]` **loses the alias type** — a former name and an
alternate spelling are indistinguishable. `AliasDto` and
`institution_aliases` both preserve `alias_type`. Reconciliation MISMATCH-4.

### Institution status

Current value only. **No history.** See §2. Pending P0.5 migration.

### Mergers and acquisitions

Lineage lives in `timeline_events` (`MERGED` 42, `ACQUIRED` 19, `RENAMED` 1 in
generated NRB data). `UNIQUE (institution_id, event_type, occurred_at)`.

**The schema has NO predecessor_id or successor_id column.** Yet `master.json`
timeline events already carry `predecessor_id` + `predecessor_name`, e.g.:

```json
{ "institution_id": "mfi-030", "event_type": "MERGED",
  "title": "Aarambha Laghubitta Bittiya Sanstha Ltd.",
  "occurred_at": null,
  "predecessor_id": "hist-aarambha",
  "predecessor_name": "Aarambha Laghubitta Bittiya Sanstha Ltd." }
```

**`occurred_at` is `null`**, so `UNIQUE (institution_id, event_type,
occurred_at)` provides no real de-duplication for these rows.

Corporate lineage is currently **unrepresentable as a relational graph**. Partial
workaround: `nrb_institution_links.link_type='MERGED_BY_NRB'` (24 rows in generated
data) links institution → NRB document, not institution → institution.

**FUTURE SCHEMA GAP 2.** A `corporate_events` structure with explicit
`predecessor_institution_id` / `successor_institution_id` is required before P8.

**Frozen rule:** merging never deletes a predecessor. Both entities persist; the
relationship is recorded.

### People positions

**M3.6B semantics preserved exactly.** A person leaving a role closes a position;
it never erases the person or the tenure.

```
positions(person_id, institution_id, role, appointed_at, ended_at, is_current)
UNIQUE (person_id, institution_id, role, appointed_at)
```

A CEO change produces two rows. The outgoing row keeps `ended_at`; the incoming row
gets a new `appointed_at`. "Who ran this institution in 2023?" is answerable
without touching the current state.

`shared_by` in `PersonPositionDto` reports how many people a source listed under
one role heading. **A role slot is not single-occupancy by default** — several
directors under one heading is normal. We report the count; we do not resolve why.

`positions` is **EMPTY**. People data is assertion-only: 629 assertions
(`people_board` 295, `people_director` 226, `people_ceo` 74, `people_chair` 34),
of which `src/data/people.ts` exposes 108. **All `UNVERIFIED`.**

`PersonAssertionRecord.valid_to` is **optional and absent** from all 108 generated
rows — so today people history has **no temporal structure in the read model at
all**. The mechanism exists in the table; nothing populates it.

### Committees

`formed_at`/`dissolved_at`; `committee_members.from_date`/`to_date`. EMPTY.
Committee data currently rides inside `people_board`/`people_director` assertion
fields with no structure — a member is a name string plus a field name.

### Branches

`branches.opened_at`, `status` (OPEN/CLOSED), plus `branch_history`:

| event_type | from_value → to_value |
|---|---|
| `OPENED` | — → branch name |
| `CLOSED` | — → close reason |
| `RELOCATED` | old address → new address |
| `RENAMED` | old name → new name |
| `TYPE_CHANGED` | old type → new type |

`branch_history` is the correct pattern and is **EMPTY**. 2,932 `branch_name`
assertions exist with `valid_to` present but **always NULL** — so branch history is
expressible in the data model and completely unpopulated in the read model.

**Directive §8 honoured:** `src/data/branches.ts` holding 1,898 assertions does not
make those branches canonical. Every row is `UNVERIFIED`.

### Financial periods

`financial_reports`: `period`, `period_end`, `fy_label_np`,
`UNIQUE (institution_id, period, report_type)`, `published_at`, `discovered_at`,
`status` (DETECTED → EXTRACTED → VALIDATED → PUBLISHED/FAILED).

**Metrics are append-only per report.** `UNIQUE (report_id, metric_code)` — a
metric value is never overwritten; a corrected report is a **new** report row.

`fy_label_np` exists alongside the period, which is the bilingual requirement
partially met.

**EMPTY.** Both tables have 0 rows. 153 `FINANCIAL` assertions exist but are
**document-level** (`document_title`, `DOCUMENT_TYPE`, `RATE_KIND`) — we know 48
financial documents exist. **Not one metric has been extracted.**

The one exception: `paidUpCapitalCrore` is sourced from the NRB BFI **directory
column** (grade A, `asOf 2026-05-15`) — a point-in-time reading with no period, no
`metric_code`, and no `financial_report`. It is an identity fact that behaves like
a metric. Reconciliation MISMATCH-5.

### Interest rates

`interest_rate_periods` (period, label, `fiscal_year`, `published_at`) →
`interest_rates.rate_pct`.

**Two-level split is correct and necessary:** a rate is meaningless without its
period. A rate change is a new row in a new period; rates are never edited
in place. EMPTY; 8 rate notices exist as assertions.

### Documents

`documents.published_at` (NOT NULL) + `discovered_at` + `last_checked_at` +
`availability_status` (AVAILABLE/MISSING/MOVED/UNKNOWN) + `content_hash`.

Three distinct clocks, correctly separated:

```
published_at     the publisher's date on the document
discovered_at    when we found it
last_checked_at  when we last confirmed the URL resolves
```

`content_hash` detects a document's **content** changing at the same URL —
`availability_status = AVAILABLE` with a changed hash means the document was
replaced. `source_snapshots.content_hash` does the same at page level across 1,458
snapshots; `crawlSummary.duplicateSnapshotGroups = 2`.

**EMPTY** in `lk.db`. `documents` = 0, `document_extractions` = 0.

### Official URLs

`official_links`: `verified`, `verified_at`, `last_checked_at`, `status`
(VERIFIED/CANDIDATE/STALE/FAILED), `canonical_url`.
`outbound_links`: `content_hash`, `first_seen_at`, `last_checked_at`,
`availability_status` (AVAILABLE/MISSING/MOVED/UNKNOWN).

A website changes without a new institution. That is a **link** change, not an
identity change — `official_links` rows are versioned by `verified_at` and the
prior value is retained. `UNIQUE (institution_id, link_type, url)` means a changed
URL is a new row, not a mutation.

**Current state: 2 VERIFIED, 49 CANDIDATE.** All 51 institutions have
`official_website: null`. Every website-dependent feature (P7 digital, social,
services, products) is blocked on this.

`slug_aliases` (UNIQUE `old_slug` → `moved_to`) is the URL-identity table.
**EMPTY** — 120 institution aliases exist, 0 slug aliases.

### Activities

Deferred. `occurred_at` / `discovered_at` / `published_at` / `moderation_status` /
`consent_status` are conceptually required. No tables. **DEFERRED.**

Gallery is a **projection of Activity + Media**, never a stored entity.

---

## 4. Derived history

Computed, never stored as sourced.

| Derived | Source records | Status |
|---|---|---|
| `shared_by` (people per role) | published `positions` rows | **IMPLEMENTED** — explicitly documented as a count, not a claim |
| branch count | `branches` or `branch_name` assertions | assertion-derived |
| `crawlSummary` (106 runs, 1,211 items, 688 snapshots, 74 errors) | `ingestion_runs` / `ingestion_items` | generated, `generatedAt 2026-09-26` |
| timeline ordering | `timeline_events.occurred_at` | **62 events, many `occurred_at: null`** |
| sector totals, growth rates, rankings | `financial_metrics` | **not built** |
| coverage percentages | `institution_coverage` | seeded `NOT_STARTED`, not derived |

**Frozen:** a derived value must point to its inputs. `metric_definitions.formula`
is the designated home and is **EMPTY**.

---

## 5. Known history defects

| Defect | Evidence | Phase |
|---|---|---|
| `as_of` not persisted anywhere | 0 columns; value only in generated `evidence` map | P0.5 |
| No institution status history | no table; `status` is current-value only | P0.5 |
| No lineage columns | `predecessor_id` in `master.json`, nowhere in schema | P0.5 |
| `timeline_events.occurred_at` NULL for generated events | 62 events, `occurred_at: null` in samples | P0.4 |
| `UNIQUE (institution_id, event_type, occurred_at)` ineffective with NULLs | NULL never collides in SQLite | P0.4 |
| `valid_to` always NULL in branch assertions | 2,932 rows, all NULL | P0.4 |
| `valid_to` absent from people assertions | optional, not emitted in 108 rows | P0.4 |
| Five temporal vocabularies | mapped in §2, not normalized | P0.3 |
| `slug_aliases` empty | 0 rows; renames would break URLs | P0.5 |
| `crawlSummary.conflictsOpen: 0` vs 229 real conflicts | export drops them | P0.4 |

---

## 6. Source noise in temporal data

### Infinity `1900-01-09`

`mfi-034`, NRB displays `1900-01-09` as the operating date. The generated data
carries:

```json
"operationDate": "1900-01-09",
"operationDateStatus": "source_anomaly",
"operationDateNote": "NRB displays 1900-01-09, awaiting clarification"
```

**Correctly handled. Must not change.** `1900-01-09` is a **sentinel value**, not
a founding date.

Rules:
- Preserve verbatim.
- **Never** normalize to BS 1956, 2000-01-01, or any plausible date.
- **Never** use as evidence of founding in any derived calculation.
- Publish as `source_anomaly`, awaiting regulator clarification.

Converting it would fabricate a founding date — the most damaging error class in a
directory, because it becomes permanent, citable, and wrong.

### Other observed noise

| Artifact | Handling |
|---|---|
| 274.27 vs 261.21 capital | Both retained; conflict row required; publish with stated basis |
| `(location not observed)` / `(type not observed)` | Literal placeholders in all 37 job records |
| `"contents never read"` on 48 financial documents | Disclosed to the reader |
| `sourceType` 51 crawled vs `sources` 21 registered | Registry is smaller than the crawl set — a real gap |
| `evidence.officialWebsite` has grade but no `sourceId` | Absence labelled, not blank |

---

## 7. How the model answers the question

```
"Capital of Nirdhan as of 2026-05-15"
  → assertion: value 274.27, source nrb-bfi-mid-may-2026, asOf 2026-05-15
  → grade A (NRB), observed 2026-06-20
  → published with that basis visible

"Capital of Nirdhan in October 2025"
  → assertion: 261.21, source NRB Oct 2025, asOf 2025-10
  → distinct assertion row; no mutation of the 2026 row

"Both disagree — which is right?"
  → data_conflicts row, OPEN, two attributed sources
  → ⚠️ TODAY: no such row exists. See FIELD-PROVENANCE-MODEL §8

"Who was CEO in 2023?"
  → positions: person with appointed_at <= 2023-12-31
                 and (ended_at IS NULL or ended_at > 2023-12-31)
  → ⚠️ TODAY: positions is EMPTY. Answer exists only as
    flat assertions with no temporal structure

"When did this institution merge?"
  → institution status history
  → ⚠️ TODAY: does not exist. Partial: timeline_events MERGED

"When was this branch at its old address?"
  → branch_history RELOCATED
  → ⚠️ TODAY: EMPTY. valid_to always NULL

"Which institutions existed when the roster was captured?"
  → universeSnapshot.observed_at 2026-06-20
  → ⚠️ TODAY: one snapshot only. No prior universe snapshots retained
```

**Five of seven cannot be answered from the current read model.** This is the
accurate state, and it is the case for P0.5.

---

## 8. Frozen rules

1. `observed_at` = **we** saw it. Never a source's as-of date.
2. `valid_from`/`valid_to` express world-time validity and are never mutated to
   "correct" a fact.
3. Closing a temporal interval is **ending a row**, never deleting it.
4. A rename changes `name_en` and appends a `FORMER` alias. Identity is untouched.
5. A merge records a relationship. **Neither predecessor nor successor is deleted.**
6. An institution's identity is its `id`, not its name.
7. `reported_value` is preserved beside `normalized_value`, always.
8. Source noise is preserved verbatim. Never normalized into a plausible value.
9. URL changes create new `official_links` rows; old values are retained.
10. Derived history must point to its inputs via `metric_definitions.formula`.
11. **A question we cannot answer is a known gap, documented — not approximated.**
12. `slug_aliases` must be populated before any slug changes.