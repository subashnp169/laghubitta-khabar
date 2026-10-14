# TEMPORAL-VOCABULARY — Phase P0.3

**Status:** FROZEN (Phase P0.3). One temporal vocabulary, clear semantics.

Extends `docs/data/HISTORY-MODEL.md` §1 (which describes *why* the dates differ).
This document fixes the **names** and the **mapping**.

---

## 1. The seven canonical temporal fields

| Canonical | Semantics | Answers | In schema? |
|---|---|---|---|
| `observed_at` | **We** saw a source assert this | "When did we learn this?" | ✅ `data_assertions` |
| `as_of` | The date **the source itself** claims | "How current does the source say it is?" | ❌ **ABSENT** |
| `retrieved_at` | We fetched the page | "When did we last touch the source?" | ⚠️ `source_snapshots.fetched_at` — table exists, **0 rows** |
| `valid_from` | The fact became true **in the world** | "From when was this true?" | ✅ column, ❌ **always NULL** |
| `valid_to` | The fact stopped being true **in the world** | "Until when was this true?" | ⚠️ 9 of 5,083 assertions |
| `verified_at` | A human or rule confirmed it | "When did we check?" | ⚠️ 12 tables + 1 |
| `published_at` | The publisher released it | "When was it announced?" | ✅ 9 tables, all 0 rows |

### The one-line distinction that prevents most errors

```
observed_at   OUR clock
as_of         THEIR clock
valid_*       THE WORLD's clock
retrieved_at  OUR clock (fetch event)
verified_at   OUR clock (check event)
published_at  THEIR clock (release event)
```

Five clocks. Conflating `observed_at` with `as_of` systematically **overstates
how current the data is** — the single most common provenance failure mode.

---

## 2. Frozen semantics

### `observed_at` — mandatory, ours

Every assertion. *"At this moment, we read this from this source."* It is **not**
a claim about the world's state. A document fetched today describing a 2019
financial report has `observed_at` = today and `as_of` = 2019.

### `as_of` — the source's own date. **NOT PERSISTED**

**This column does not exist in any of the 53 tables.** Verified: zero occurrences of
`as_of` in `schema/schema.sql`.

The only `as_of` in the product is inside the display evidence map
(`src/types/index.ts:17` declares it optional):

```json
"paidUpCapitalCrore": { "grade": "A", "sourceId": "nrb-bfi-mid-may-2026",
                        "asOf": "2026-05-15" }
```

plus `directorySource.asOf` at `src/data/institutions.ts:60`. The evidence map has
**5 keys per institution × 51 institutions = 255 entries**. Exactly **51** carry
`asOf` — one per institution, and only ever `paidUpCapitalCrore`. The other 204
carry `verifiedOn` (153), or `grade`+`status` only (51).

**`src/data/institutions.ts` has no generator.** Verified: no script under
`scripts/` writes it (every `writeFileSync` target was listed and checked).
`scripts/generate-nrb-data.ts` emits `src/data/nrb.ts`, which contains no `asOf`
at all. `directorySource.count: 51` at `src/data/institutions.ts:62` is a
hand-written literal next to 51 hand-written rows.

**Consequence:** the platform can state, for one field, that NRB claims May 2026;
cannot state it for anything else; and cannot state it durably at all. Both the
value and the count that certify the file are hand-maintained.

**`as_of` is frozen as the correct name.** Persistence requires an approved
migration (P0.5). Not a P0.3 change.

### `valid_from` / `valid_to` — the world's clock, nullable

Only on `data_assertions`. NULL handling is part of the contract:

| `valid_from` | `valid_to` | Meaning | "True now?" query |
|---|---|---|---|
| set | NULL | currently true | ✅ |
| set | set | true in a closed interval | ❌ |
| NULL | set | ended, start unknown | ❌ |
| NULL | NULL | validity unknown / timeless | ✅ (with a caveat) |

**True-at-time-T:** `valid_from <= T AND (valid_to IS NULL OR valid_to > T)`,
treating NULL `valid_from` as −∞.

**Measured, all 13 evidence DBs, 5,083 assertions:**

| | Count | Share |
|---|---|---|
| `valid_from IS NULL` | **5,083** | **100%** |
| `valid_to IS NOT NULL` | 9 | 0.18% |

So every assertion today is "true since forever, until proven otherwise", and the
9 that are closed are the only ones the mechanism has ever expressed. A
time-travel query would return today's rows for any T in the past — which is
**exactly the kind of plausible-but-wrong answer this vocabulary exists to
prevent.** The columns are correct; nothing populates them.

`branches.opened_at` (18-column `branches` table) is the one place a real-world
start date is modelled, and it is a *different* column name on a *different*
table — see the mapping in §3.

### `retrieved_at` — the fetch event

`source_snapshots.fetched_at`. Distinct from `observed_at`: multiple snapshots of
one source produce multiple `retrieved_at` values but share assertions.

`source_snapshots` holds **0 rows in `lk.db`**. All 1,458 snapshots live in the 13
dated evidence databases, so `retrieved_at` exists as evidence but not as a
queryable part of the primary store.

### `verified_at` — the check event

Two spellings, one meaning:

| Spelling | Where | Tables |
|---|---|---|
| `last_verified_at` | persistence | **12**: `institutions`, `institution_aliases`, `people`, `positions`, `branches`, `financial_metrics`, `interest_rates`, `posts`, `jobs`, `products`, `services`, `digital_services` |
| `verified_at` | persistence | **1**: `official_links` (with `last_checked_at`) |
| `verifiedOn` | display | `src/types/index.ts:17` evidence map — **153 of 255 entries** |

**All 5,071 `UNVERIFIED` assertions have no verification date, correctly** — you
cannot verify a fact you have not verified. The 9 `STALE` and 3 `REJECTED`
assertions are where any verification date would live.

Gap: the other 102 evidence entries carry `grade`+`status` or `asOf` only, so a
reader cannot tell when `licenseClass` or `workingArea` was last checked.

### `published_at` — the publisher's clock

9 tables: `financial_reports`, `interest_rate_periods`, `documents`, `posts`,
`news`, `jobs`, `research`, `videos`, `nrb_documents`. Nullable in
`financial_reports` and `jobs` — a report can be found before its publication
date is known.

All 9 hold **0 rows in `lk.db`**, so `published_at` is currently unobservable in
the primary store.

---

## 3. Frozen mapping of the five existing vocabularies

P0.2 found five temporal naming schemes in one schema. **The canonical names above
are frozen; the domain-specific names stay** — `appointed_at` reads better than
`valid_from` on a job and costs nothing. What is frozen is the **mapping**.

Every name below was verified present in `schema/schema.sql`.

| Canonical | Domain names | Semantics |
|---|---|---|
| `valid_from` | `appointed_at`, `from_date`, `formed_at`, `effective_date`, `opened_at`, `occurred_at`, `first_seen_at`, `published_at`, `link_date` | Fact began |
| `valid_to` | `ended_at`, `to_date`, `dissolved_at`, `closed_at` | Fact ended |
| `observed_at` | `observed_at`, `detected_at`, `discovered_at` | We saw it |
| `retrieved_at` | `fetched_at`, `last_seen_at`, `last_run_at`, `last_success_at` | Fetch/check event |
| `verified_at` | `last_verified_at`, `verified_at`, `last_checked_at`, `last_checked`, `last_full_reviewed_at`, `reviewed_at`, `resolved_at`, `started_at`, `completed_at`, `next_review_at`, `next_full_review_at` | Check event |
| `published_at` | `published_at`, `announcement_date` | Publisher release |
| `as_of` | **`evidence.asOf` / `directorySource.asOf` (display only)** | Source's own claim |

### Three collisions to be aware of

| Name | Collision |
|---|---|
| `occurred_at` | `timeline_events` (nullable), `branch_history` (NOT NULL), `events` (NOT NULL) — 4 declarations, 3 different nullabilities |
| `started_at` / `completed_at` | `ingestion_runs` run timing, **not** fact validity |
| `published_at` | on `financial_reports` it means "the report was released"; on `news`/`posts` it means "the article was released"; mapped to `valid_from` **and** `published_at` above because it is both |

**Frozen:** `ingestion_runs.started_at` is a **process** timestamp and must never
be read as `valid_from`. A run start is not a fact's beginning.

---

## 4. What must never be done

| Never | Because |
|---|---|
| Use `observed_at` as a proxy for `as_of` | Overstates currency |
| Treat `1900-01-09` as an `operation_date` | Source sentinel, not a founding date |
| Rewrite `valid_to` to "correct" a fact | History is append-only |
| Use `ingestion_runs.started_at` as `valid_from` | Process time ≠ world time |
| Infer `as_of` from `observed_at` | Fabrication |
| Delete a row instead of setting `valid_to` | Erases the interval |
| Reuse `valid_from` for "when we fetched it" | Conflates the two clocks |
| Coerce NULL `valid_from` to a sentinel date | Invents history |

---

## 5. Frozen rules

1. Five clocks, five names. Never one name for two clocks.
2. `observed_at` is ours. `as_of` is theirs. Never substitute.
3. `as_of` is the correct name and is **not yet persisted** — a known gap, not a
   naming debate.
4. `valid_from`/`valid_to` are nullable with the four-state semantics in §2.
5. Domain-specific temporal column names are permitted; the **mapping** is frozen.
6. Process timestamps (`ingestion_runs`, `audit_logs`) are never fact validity.
7. Source sentinels are preserved, never normalized.
8. A temporal fact is closed by ending it, never by deleting it.

## 6. Outstanding

| # | Gap | Phase |
|---|---|---|
| 1 | `as_of` has no column — 51 of 255 display evidence entries only, hand-written, no generator | P0.5 migration |
| 2 | `valid_from` NULL on 100% of assertions → time-travel queries return today's rows for any past `T` | P0.5 |
| 3 | `valid_to` set on 9 of 5,083 assertions | P0.4 |
| 4 | No institution status history (`institutions.status` is a single current value; all 51 are `ACTIVE`) | P0.5 migration |
| 5 | `timeline_events.occurred_at` NULL for generated events → `UNIQUE (institution_id, event_type, occurred_at)` is inert in SQLite | P0.4 |
| 6 | `verifiedOn` missing on 102 of 255 evidence entries; persistence `last_verified_at` on 12 tables, all unpopulated in `lk.db` | P0.4 |
| 7 | `source_snapshots` and all 9 `published_at` tables are empty in `lk.db`; 1,458 snapshots live only in dated evidence DBs | P0.5 |

Persistence of `as_of` is the single highest-value temporal change and it is
**blocked on migration approval, not on analysis.**