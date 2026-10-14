# Durable Ingestion Memory

**Phase:** P0.5 · **Status:** complete · **Schema change:** none · **Data destroyed:** none

This document is the conceptual durable run model the directive asks for, mapped
onto the tables that already exist, together with the evidence that the thirteen
pilot databases can be consolidated safely and the two places where the model
still has no home.

Written after measuring all thirteen databases in `data/pilot/evidence/`, not
before.

---

## 1. The weakness P0.5 was opened for

> Do NOT continue creating isolated dated evidence databases that cannot
> accumulate into a durable canonical history. The evidence engine must
> eventually become cumulative. — directive §14

Thirteen dated databases exist. Each is a complete, self-consistent run store.
None can see another:

| | |
|---|---|
| Evidence databases | 13 `.db` files under `data/pilot/evidence/` |
| Distinct ingestion runs recorded | **264** |
| Runs any one database can see | the **21–106** it recorded itself |
| Correlation between databases | none — no shared key, no shared file, no query path |
| What the pipeline could ask | "what did this run find?" |
| What nobody could ask | "what changed between 26 Sep and 1 Oct?" |

The failure is not that the runs lack identity. `ingestion_runs.id` is
`run-<ISO timestamp>-<source slug>` — e.g.
`run-2026-09-26T10:35:24.298Z-nirdhan-website` — and all 264 are distinct, none
collision, none left `RUNNING` (`completed_at` NULL in 0 of 264). **Durable run
identity was already built and already correct.** What is missing is a place for
the runs to meet.

---

## 2. The conceptual model, mapped to real tables

The directive names seven concepts. Five have a table, one is polymorphic by
design, and one is genuinely absent.

| Directive name | Table(s) | State | What it holds |
|---|---|---|---|
| `source` | `sources` (17 cols) | present | one publisher/URL, with `source_grade`, `source_scope` |
| — registration | `ingestion_sources` (12 cols) | present | how a source is polled: interval, enabled, config, `institution_id` |
| `source_snapshot` | `source_snapshots` (8 cols) | present | one fetch: `fetched_at`, sha256 `content_hash`, `http_status`, `mime_type`, `parser_version`, `r2_key` |
| `ingestion_run` | `ingestion_runs` (11 cols) | present | `started_at`/`completed_at`, `status`, `items_found/changed/new/failed`, `parser_version`, `error_count` |
| — per-item | `ingestion_items` (7 cols) | present | one URL touched by a run, `NEW`/`CHANGED`/`UNCHANGED`/`FAILED` |
| — per-run errors | `ingestion_errors` (8 cols) | present | error type/message, `retry_count` |
| `assertion` | `data_assertions` (12 cols) | present | `(entity_type, entity_id, field_name) → value`, `source_id`, `source_snapshot_id`, `observed_at`, `confidence`, `verification_status` |
| `entity` | `institutions`, `people`, `branches`, `financial_metrics`, `documents`, … (26-col institutions) | present but **empty** | the thing an assertion is about; `data_assertions` is already polymorphic via `entity_type` + `entity_id` |
| `relationship` | **no table** | **absent** | see §6 |
| `review` | **no table** | **absent** | see §6 |
| — conflict record | `data_conflicts` (13 cols) | present, 229 rows | the *pair* that disagrees; `resolution_status`, `resolved_by`, `resolved_at`, `resolution_note` |
| — validation | `validation_rules` (7) + `validation_results` (9) | present | rule id/severity, per-target pass/fail with `evidence_json` |
| — audit | `audit_logs` (9 cols) | present, 6767 rows | `actor_id`, `action`, `target_type`/`target_id`, `before`/`after` JSON |

**The pipeline did not need a new table to have a run model.** It has had one all
along, in all twelve full-schema evidence databases. `CONFLICT-VISIBILITY-CHAIN.md`
§4 already noted `data_conflicts` was structurally sound; this phase confirms the
whole spine above it is too.

### What is missing from the model, stated plainly

- **`relationship`.** There is no generic edge table. `institutions` has
  `parent_id`/`merged_into_id`, and `nrb_institution_links`, `committee_members`,
  `positions`, `post_sources`, `outbound_links` each encode one narrow edge in
  their own shape. A question like "show me every entity connected to mfi-001,
  whatever kind of link it is" cannot be asked. Not built here — see §7.
- **`review`.** `data_conflicts.resolution_status` is the queue and
  `audit_logs` is the trail, but there is no first-class review record: no
  reviewer, no decision, no reason, no queue ordering, no "who is on the hook".
  An operator resolving a conflict writes into the conflict row itself, which is
  one column set doing two jobs. Not built here — see §7.

---

## 3. The consolidation is safe, and this is why

`scripts/build-durable-store.ts` merges all thirteen databases into one. The load
strategy per table is not a judgement call; it follows from a primary-key
collision audit run over every row of every database.

**Method.** For each table, read every row from every database, key by `id`.
If the same id appears once → nothing to reconcile. If it appears more than once,
compare the full row.

| Table | Rows | Distinct ids | ids in >1 db | Same id, different content | Load |
|---|---|---|---|---|---|
| `ingestion_runs` | 264 | 264 | 0 | 0 | **append** |
| `source_snapshots` | 1458 | 1458 | 0 | 0 | **append** |
| `ingestion_items` | 1491 | 1491 | 0 | 0 | **append** |
| `data_assertions` | 5083 | 5083 | 0 | 0 | **append** |
| `data_conflicts` | 229 | 229 | 0 | 0 | **append** |
| `audit_logs` | 6767 | 6767 | 0 | 0 | **append** |
| `validation_results` | 3970 | 3970 | 0 | 0 | **append** |
| `ingestion_errors` | 78 | 78 | 0 | 0 | **append** |
| `sources` | 525 | 56 | 51 | **51** | **upsert** |
| `ingestion_sources` | 421 | 51 | 51 | **51** | **upsert** |
| `institutions` | 421 | 51 | 51 | **51** | **upsert** |
| `validation_rules` | 18 | 8 | 5 | **1** | **upsert** |
| `users` | 0 | 0 | 0 | 0 | **upsert** |

**Why the append set is safe by construction, not by luck.** Assertion, snapshot
and conflict ids embed a base-36 timestamp token: `as-mui97agw-13`,
`snap-mui979sm-5`, `cf-people-mujbso38-1`. `mui…` is SQLite's `unixepoch` in
base 36, so each generator produced a globally sortable, per-workspace unique id.
Zero collisions across 13 files and 6 days is the expected result, not a
coincidence.

**Why the upsert set needs upsert.** `sources.id = 'nirdhan-website'` appears in
13 databases with 13 different rows — different `title`, different `url`, and
sometimes a different column set:

```text
"nirdhan-website"  title="nirdhan-website pilot source"             publisher="pilot (mfi-001)"
"nirdhan-website"  title="nirdhan-website branch url discovery"     (8 columns only)
"nirdhan-website"  title="Nirdhan Utthan Laghubitta Bittiya Sanstha Ltd. — official website"
```

These are **per-run registrations of one logical source**, not competing copies of
one record. A durable store must keep one row and remember it changed, so the
importer upserts in chronological order — most recent registration wins — and
reports every superseded row (467 for `sources`, 370 each for `institutions` and
`ingestion_sources`, 10 for `validation_rules`). Nothing is dropped: the earlier
versions remain in the evidence databases, which are the record.

Chronology comes from each database's own newest run, not from the filename. Two
evidence files carry no date in their name, and one of them
(`pilot-people-ext-c-pass2`) holds a later run than its alphabetically
neighbours — filename order would have made the wrong row win.

**`institutions` is a reference copy, deliberately.** 421 rows collapse to 51, so
370 entity versions are not carried into the durable store. That is intentional:
canonical entity state is P1's job, and loading the latest version here would
pre-empt it and imply entity history that the store does not have. The table is
loaded because `ingestion_sources.institution_id` references it and the store
would otherwise be dangling.

---

## 4. What the merged store contains

Built from `schema/schema.sql` — the same DDL production uses, no migration:

```text
table              strategy  in store  appended  upserted
sources            upsert           56        58       467
users              upsert            0         0         0
institutions       upsert           51        51       370
ingestion_sources  upsert           51        51       370
source_snapshots   append         1458      1458         0
ingestion_runs     append          264       264         0
ingestion_items    append         1491      1491         0
ingestion_errors   append           78        78         0
data_assertions    append         5083      5083         0
data_conflicts     append          229       229         0
validation_rules   upsert            8         8        10
validation_results append         3970      3970         0
audit_logs         append         6767      6767         0
TOTAL                          19506
```

`foreign_key_check`: **0 violations**. Rebuild is **byte-identical**
(`sha256 225ffccd5b36662100da9e7ec8333198acdc4f93673f5c4aac6618166e93c525`,
7,704,576 bytes).

Every appended count equals the count in the store — the script fails loudly if it
ever does not. Every one of the 13 evidence databases was sha256'd before and
after the load and is **unchanged**; the script aborts if any differs.

### The capability that did not exist before

Every run ever run, in one query:

```text
date        runs  items_seen  changed   new  sources  errors
2026-09-26   121       1273       87   602       51      74
2026-09-27   100        168        0    91       25       0
2026-10-01    43         97        4    89       33       4
```

One source's history across five days, from eight runs that lived in six
different files:

```text
2026-09-26T10:35:24  PARTIAL  found=18 changed=7
2026-09-26T10:35:54  PARTIAL  found=13 changed=2
2026-09-27T04:33:48  SUCCESS  found=3  changed=0
2026-09-27T04:36:04  SUCCESS  found=3  changed=0
2026-09-27T06:21:23  SUCCESS  found=3  changed=0
2026-09-27T06:23:50  SUCCESS  found=3  changed=0
2026-10-01T08:03:04  SUCCESS  found=3  changed=0
2026-10-01T14:06:14  PARTIAL  found=4  changed=0
```

`branch_name` has been asserted **2932** times from **20** sources with **1787**
distinct values. Before P0.5 that number was spread across thirteen files and
could not be produced at all. 229 unresolved conflicts, all `OPEN`, are now
visible in one place instead of in three.

---

## 5. Where the durability is still weak

The store accumulates runs. It does not yet make them authoritative, and three
facts decide whether that happens next:

**The evidence is not in version control.** `.gitignore:28` is `*.db`, so
`git ls-files -- data/pilot/evidence` returns **0 files**. A fresh clone of this
repository contains **zero assertions** — not a stale copy, none. The only
authoritative record in the system (§8.1 of the source-of-truth matrix) lives on
one disk, unversioned, with no backup. The durable store is derived from it and so
is equally at risk. **This is the highest-priority item P0.5 found.**

**A fingerprint is not the payload.** `source_snapshots.content_hash` is a real
sha256 on **1458 / 1458** rows, 1144 distinct, and `parser_version` is recorded on
every snapshot and every run. That is better provenance than the source-of-truth
matrix first credited. But `r2_key` is NULL on all 1458: **no retrieved page was
ever retained.** Directive §15 asks "what did the source say at that time?" — the
store can prove a page was read and that its bytes differed from another read, and
it cannot show what they said. This corrected an earlier claim in the matrix; see
its §6.

**The hardcoded-path pattern is now closed (P1).**
`build-financials-module.ts` and `build-jobs-module.ts` originally each named one
evidence file by relative path, so `src/data/financials.ts` and
`src/data/jobs.ts` were built from an arbitrary one-day slice of a history that
is now queryable. Both generators now read `data/durable/store.db` by default,
with `M35_FINANCIALS_DB` / `M35_JOBS_DB` to pin a single database for a
reproducible rebuild. On the current evidence the regenerated modules are
byte-identical to the previous single-database output — the retarget changes the
source, not the rows — and a staleness guard refuses to build when any
`data/pilot/evidence/*.db` is newer than the store (run `npm run durable:build`
first). P0.5 deliberately left this to P1 because retargeting a generator is a
content change to a published page, not a memory fix.

**Concurrency is unproven.** Every recorded run was written by a single operator
to a private scratch database, so nothing has ever tested two runs writing at
once. The merge importer is sequential by construction. A live writer needs
`BEGIN IMMEDIATE` around run creation, which is untested territory — not a
hypothesis this phase is entitled to make.

---

## 6. The two holes, and why they were not filled here

`relationship` and `review` have no table (§2). Both are absent by design at this
point, and both would be wrong to invent now:

- **`relationship`** cannot be generic before entities are canonical. An edge
  table that stores `from_type`/`from_id`/`to_type`/`to_id` is only meaningful
  once `entity_type` values are a closed, agreed vocabulary — which is P0.2's
  output being enforced in P1. Adding the container now yields a table nothing
  can populate correctly. When it lands: one row per edge with `source_id`,
  `source_snapshot_id`, `observed_at` and the same `verification_status`
  discipline as `data_assertions`, because an edge is an assertion about two
  entities.
- **`review`** is a work queue, and this repository has exactly one operator
  (`docs/OPERATIONS.md` §"one-person operability"). Its first requirement is
  workflow — who reviews, in what order, under what SLA — not a table. The
  existing `data_conflicts` + `audit_logs` pair covers single-operator review
  adequately; a queue adds a second place for state to live and nothing else. It
  should be specified alongside P1's conflict resolution, not ahead of it.

Neither is a blocker. P1 populates the first canonical entity, and both land
naturally after it.

---

## 7. What P0.5 changed, and what it did not

**Built**

- `scripts/build-durable-store.ts` — read-only importer, `npm run durable:build`,
  self-verifying (row reconciliation, foreign-key check, evidence sha256 before
  and after, byte-identical rebuild).
- `data/durable/store.db` — 19,506 rows, gitignored, fully rebuildable.
- This document.

**Not touched:** the schema. `schema/schema.sql` and all seven migrations are
unchanged; the durable model needed no new table. The evidence databases are
byte-identical. No entity table was populated. No generator was retargeted by
this phase (the two module generators were retargeted later, in P1).

**Still to do, in order**

1. **Put the evidence in version control, or an equivalent backup.** 5083
   assertions and 1458 snapshots exist on one unversioned disk. Everything else
   in this model is rebuildable from that; that is not.
2. ~~Retarget `build-financials-module.ts` and `build-jobs-module.ts` at
   `data/durable/store.db`.~~ **Done (P1).** Both default to the durable store,
   accept a pinned-database override, and refuse to build from a stale store.
3. Decide whether the durable store is a build artifact (rebuildable, gitignored)
   or a tracked database (like the old project). Currently it is the former, which
   depends on (1) succeeding.
4. Specify `review` with P1's conflict-resolution work.
5. Add a run-table read to the repository layer once a caller needs it
   (`REPOSITORY-CONTRACT.md` §contracts — `IngestionRunRepository` is not on the
   13-method list yet).