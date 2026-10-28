# CONFLICT-VISIBILITY-CHAIN — Phase P0.3

**Status:** FROZEN (Phase P0.3). Trace, not fix.

Requested chain, established end to end with file:line evidence:

```
DB conflict rows → repository contract → projection/export → operator visibility
```

---

## 1. Headline: 229 rows are lost at **two independent points**

| # | Break | Location | Cause |
|---|---|---|---|
| **1** | Exporter opens the **wrong database** | `scripts/pilot-export.ts:107,112` | DB path resolves to a **deleted** `%TEMP%` scratch file |
| **2** | People exporter filters out **all** of them | `scripts/pilot-export-people.ts:268` | `source_a_id <> source_b_id` — a *correct* filter that excludes 229 same-source rows |

Break 1 is the proximate cause of `conflictsOpen: 0`. Break 2 is why fixing break 1
alone would still yield nothing on the people projection.

---

## 2. Stage 1 — DB rows exist

Measured read-only across all three pilot evidence DBs:

| Database | conflicts | cross-source | same-source | OPEN | resolved | field |
|---|---|---|---|---|---|---|
| `pilot-people-2026-09-27-ext-b-seed-first.db` | 155 | **0** | 155 | 155 | 0 | `people_ceo` |
| `pilot-people-2026-09-27-ext-c-pass1.db` | 64 | **0** | 64 | 64 | 0 | `people_ceo` |
| `pilot-people-ext-c-pass2.db` | 10 | **0** | 10 | 10 | 0 | `people_ceo` |
| `pilot-branches-ext-2026-10-01.db` | 0 | — | — | — | — | — |
| `lk.db` | 0 | — | — | — | — | — |

**Two facts that change the diagnosis:**

1. **`crossSource = 0` everywhere.** Every one of the 229 has
   `source_a_id = source_b_id` — the *same source on both sides*.
2. Distinct source pairs per DB: 6, 5, 8. So these are 19 source-level groupings,
   not 229 independent disputes.

### Why they are same-source

`lib/ingestion/review.ts:208`, in the **current** detector:

```ts
// Same value from two sources is corroboration, not a conflict, and a
// source disagreeing with ITSELF is a page artifact.
if (a.source_id === b.source_id) continue;
```

The detector's own comment at `:161-167` describes the old bug it fixed: the
earlier grouping reported *"X from A"* against *"Y from A"* — a source on both
sides, caused by a column-header collision during people extraction.

**Conclusion: the 229 rows are frozen pre-fix artifacts of a detector bug that has
since been corrected.** They are not open disputes. They are stale records of a
misclassification, preserved because evidence is never deleted
(`review.ts:263-270` dedupes rather than removes).

**This retracts the P0.2 framing.** P0.2 implied 229 open disputes awaiting
operator judgement. Measured: 0 cross-source disputes exist. The genuine problem
is narrower and different — see §6.

---

## 3. Stage 2 → 3 — contract and export

### Repository contract

`lib/repository/contract.ts` — 13 methods, **no conflict operation of any kind**:

```text
listInstitutions · getInstitutionBySlug · getInstitutionById
listLeadership · listBranches · listFinancials · listDocuments · listJobs
getPersonBySlug · listNews · search · listInterestRates · resolveOutboundLink
```

**There is no seam through which a conflict could reach any page or route
handler.** `resolveConflict` exists in `lib/ingestion/review.ts:362`, but it is
not on the contract, so no consumer may legally call it.

**No `CrawlSummary` equivalent exists in the repository layer.** `crawlSummary`
is a frontend-only type (`src/types/index.ts:182-211`), so the repository contract
is *structurally incapable* of carrying `conflictsOpen`.

### Export path

| Artifact | Generator | DB opened | Conflict query | Result |
|---|---|---|---|---|
| `crawlSummary.conflictsOpen` | `pilot-export.ts:224`, assigned `:262` | **deleted temp path** | unfiltered `SUM(resolution_status='OPEN')` | `0` |
| `openPeopleConflicts` | `pilot-export-people.ts:260-272` | `pilot-people-ext-c-pass2.db` ✅ | `+ source_a_id <> source_b_id` | `[]` |
| `openBranchConflicts` | `pilot-export-branches.ts:210,216` | branches DB (0 conflicts) | same cross-source filter | `[]` |
| `JobDto.conflicts` | `build-jobs-module.ts:72-80` | careers DB | `entity_type = 'VACANCY'` | none — all 229 are `institution`/`people_ceo` |
| `FinancialRecord` conflicts | `build-financials-module.ts:70-76` | financials DB | open cross-source conflicts | none — DB has 0 conflicts |

### Break 1 in detail — `scripts/pilot-export.ts`

```ts
107: const dbPath = process.argv[2] ?? process.env.LK_PILOT_DB
                      ?? (fallbackPath && !fallbackPath.startsWith("<") ? fallbackPath : undefined);
112: const db = new Database(dbPath, { readonly: true });
224: const conflicts = q(db, "SELECT COUNT(*) n, SUM(resolution_status='OPEN') o FROM data_conflicts") as Row;
```

`fallbackPath` comes from `data/pilot/pilot-run-report.json:4`:

```json
"dbPath": "C:\\Users\\Lenovo\\AppData\\Local\\Temp\\lk-pilot-Iq2nti\\pilot.db"
```

Verified: **that path does not exist.** Running `npm run pilot:export` today:

```
TypeError: Cannot open database because the directory does not exist
    at new Database (better-sqlite3\lib\database.js:65:9)
    at main (scripts\pilot-export.ts:112:14)
exit=1
```

So the query at `:224` is **correct and would return 229** — it is pointed at the
wrong (and now missing) database.

**Timeline proof that the count predates the data:**

| Event | Timestamp |
|---|---|
| `data/pilot/pilot-run-report.json` written | 2026-09-26 16:57 |
| `src/data/pilot.ts` `generatedAt` | **2026-09-26T17:15:31.328Z** |
| First conflict detected (ext-b) | 2026-09-27T04:35:50.894Z |
| Next (ext-c-pass1) | 2026-09-27T06:23:40.093Z |
| Last (ext-c-pass2) | 2026-10-01T08:05:54.225Z |

**The export ran 11 hours before the first conflict was ever written, and has
never been re-run.** No CI step regenerates it — `.github/workflows/deploy.yml`
contains no reference to `pilot` or `export`.

### Break 2 in detail — `scripts/pilot-export-people.ts`

```ts
268:   AND c.source_a_id <> c.source_b_id
```

Rationale, documented at `:254-259`: *"Only a genuine CROSS-SOURCE disagreement is
a conflict. A single source listing several names under one role heading is a
multi-holder role, not a contradiction."*

**That reasoning is correct** — it implements the `shared_by` semantic frozen in
P0.2 §10. Replaying the exact query against `pilot-people-ext-c-pass2.db`
(read-only):

```text
data_conflicts rows in this DB                    → 10   (all people_ceo, all OPEN, all same-source)
rows after the JOIN to data_assertions            → 23   (an assertion per source/value, so the join fans out)
+ source_a_id <> source_b_id                      →  0   ← every row dies here
same query, cross-source predicate removed        →  8   (GROUP BY a.source_id, a.field_name)
```

The 8 surviving sources:

```text
cyc-website · dhaulagiribank-website · gilb-website · kalikabank-website
nirdhan-website · samata-website · supportmicrofinance-website · swbbl-website
```

**What the rows actually contain** (first two of the 10):

```text
value_a: Mr. Gokarna Prasad Upadhaya
value_b: Mr. Narayan Bahadur Karki
resolution_status: OPEN
resolution_note:   flagged by people-html-v2/people-json-v2 conflict detector
```

Two parsers of **the same page** disagreeing about one role heading — the HTML
extractor and the JSON extractor of `swbbl-website`, or similar. That is a parsing
bug, not a data dispute, and `source_a_id = source_b_id` is exactly how it shows
up in the table. `detected_at` is `2026-10-01T08:05:54.225Z` for all 10.

### A third loss — the payload is lossy

`pilot-export-people.ts:273-278` reduces each conflict to:

```ts
{ institution_id: inst.id, field_name: String(r.field_name) }
```

`value_a`, `value_b`, `source_a_id`, `source_b_id`, `detected_at`, and the
conflict `id` are **discarded**. Even with rows surviving the filter, an operator
could not see *what* disagrees. Rows are further dropped when
`resolveInstitution(source_id)` fails.

### A fourth loss — the exports are unreferenced

`src/lib/site-data.ts:35,39` re-exports `openBranchConflicts` and
`openPeopleConflicts`. **Zero pages or components consume either.** Even fully
populated, they would render nothing.

---

## 4. Stage 4 — operator visibility

`src/app/ingestion/page.tsx:96` is the entire conflict UI:

```tsx
<Stat term="Open conflicts"
       value={crawlSummary.conflictsOpen}
       tone={crawlSummary.conflictsOpen === 0 ? "positive" : "conflict"} />
```

One scalar. No list, no institution, no field, no `value_a`/`value_b`, no source
attribution, no drill-down, no resolve action. It is the only consumer of
`conflictsOpen` in the entire `src/` tree.

**`=== 0` renders green as a health signal** — and the zero is a stale count read
from a database that no longer exists. Every other `conflict` occurrence in `src/`
is a presentation tone (`src/util/evidence.ts:16,33`, `src/components/ui/Stat.tsx:18`,
the `*_TONE` maps in `alerts`, `nrb`, `news/[slug]`, `ActivityFeed`). The one place
a conflict could be *presented as data* — `src/util/evidence.ts:58` maps
`CONFLICT → { label: "Conflict", tone: "conflict" }` — has no producer, because
`CONFLICT` is never emitted in this build (§5).

**This is the most dangerous line in the chain: it renders absence of measurement
as absence of problems, in green.**

---

## 5. Which code reads conflicts correctly

| Location | Correct? | Reachable? |
|---|---|---|
| `lib/repository/d1.ts:181` — `SELECT entity_id, field_name FROM data_conflicts WHERE resolution_status='OPEN' AND entity_type='institution' AND field_name LIKE 'people_%'` | ✅ **Yes.** No cross-source filter, and it feeds `verification_status: CONFLICT` into the D1 projection | ⚠️ Reachable **only** through the Worker (`worker/src/index.ts:61` constructs `D1InstitutionRepository` directly). On `lk.db` it returns **0** rows — `data_conflicts` is empty there. Against `pilot-people-2026-09-27-ext-b-seed-first.db` it returns 155. It is `private`, so no conflict queue can reuse it |
| `lib/ingestion/review.ts:321` `listOpenConflicts` | ✅ | 5 non-test callers: `lib/ingestion/index.ts:129` + 4 run-scripts, all for printing |
| `lib/ingestion/review.ts:362` `resolveConflict` (sole writer of `resolved_by`/`resolved_at`/`resolution_note`, `:369`) | ✅ | **Only from `scripts/smoke-people-m33.ts:508` and `smoke-people-model-b.ts`** — tests, resolving as `"ops@laghubitta"` in a temp DB |
| `lib/ingestion/adapters/local.ts:511` `saveConflict` | ✅ the writer | yes |

**Verified across all 13 evidence DBs:** 229 conflicts, **0 cross-source**, **0
with `resolved_by`/`resolved_at` set, 0 with any status other than `OPEN`.** No
human or script outside a test has ever resolved a conflict. Nothing under `src/`
or `worker/` calls either function.

### One more inconsistency worth recording

The D1 code comments its own output format at `d1.ts:183-184`:

```ts
// A role-disagreement conflict is labelled `people_a|people_b`, so one open
// row yields one key per role family involved.
```

Every one of the 229 rows is labelled plain **`people_ceo`** — no pipe, no second
role. So the projection expects a compound `field_name` convention that no row in
existence uses. The split is harmless today (one key instead of two) and would
silently mis-key a future row that did use it. **Another frozen-but-unimplemented
convention, in the same subsystem as the retracted detector bug.**

---

## 6. The actual defect, precisely

Not "229 disputes need reviewing." That was P0.2's framing and it is wrong.

```text
STALE PRE-FIX ARTIFACTS
  229 rows, 0 cross-source, 0 resolved, all people_ceo
  from a detector bug fixed at review.ts:208
  no review path exists
  reported to the operator as a green "0 open"
```

**Four defects, in dependency order:**

| # | Defect | Layer | Fix phase |
|---|---|---|---|
| 1 | No conflict operation on `InstitutionRepository` | REPOSITORY | P0.4 contract |
| 2 | Exporter DB path resolves to a deleted temp file | projection/export | P0.4 |
| 3 | Exported conflict payload drops values and both source ids | projection/export | P0.4 |
| 4 | Operator surface is a stale scalar, green on zero | display | P14 (P0.4 at minimum: invert the tone) |
| 5 | D1 `peopleEvidence` expects a `people_a\|people_b` label convention that no row uses | projection | P0.4 (with the contract work) |

**And one thing that is NOT a defect:** the cross-source filter at
`pilot-export-people.ts:268`. It correctly implements the multi-holder-role
semantic. It is the *only* code in the chain that is right about what a conflict
is.

---

## 7. Frozen conclusions

1. **A conflict is a disagreement between two *distinct* sources.** Same source
   on both sides is a page artifact or a multi-holder role, not a dispute.
2. **A conflict count is only as true as the database it was read from.** A
   generated scalar with no recorded provenance is not a measurement.
3. **Every generated scalar must record its source database and generation
   time.** `crawlSummary.generatedAt` exists; its DB does not.
4. **A count of zero must never render as a positive health signal** unless the
   read is verifiably current. Absence of measurement ≠ absence of problems.
5. **A conflict without `value_a`, `value_b`, and both source ids is not
   actionable** and must not be presented as actionable.
6. **Evidence is never deleted**, including conflicts later proven to be detector
   artifacts. They are resolved or annotated, not removed.
7. Conflicts reach operators only through the repository contract. A UI cannot
   read a table.
8. `CONFLICT` is a valid `VerificationStatus`, implemented in
   `projection.ts:73,588,818`, and presented by `src/util/evidence.ts:58` — but is
   **never produced in this build**. On the generated path the input Sets come
   from `src/data/people.ts:1306` and `src/data/branches.ts:17313`, both `[]`; on
   the D1 path from `data_conflicts`, which is empty in `lk.db`.

---

## 8. Not fixed in P0.3

Per directive: trace, not fix. The four defects above are recorded for P0.4.
No code change was made in this phase.

---

## 9. V1.1.1 conflict triage (read-only)

A deterministic triage report was produced from `data/durable/store.db` without
mutating any conflict status, evidence, assertion, history or source record.

- **Verified baseline:** 229 conflict rows, all `entity_type = 'institution'`,
  `field_name = 'people_ceo'`, `resolution_status = 'OPEN'`,
  `resolved_by`/`resolved_at` null on all, all `source_a_id = source_b_id`.
- **Categories:** 229 "same-source parser disagreement (pre-fix artifact)"
  (10 distinct sources: swastiklbs 191, swbbl 19, gilb 3, nationalmicrofinance 6,
  samata 3, supportmicrofinance 3, cyc 1, dhaulagiribank 1, kalikabank 1, nirdhan 1).
  0 cross-source, 0 indeterminate.
- **How determined:** source identity equality plus the `resolution_note` text
  (which names two parsers of the same page, e.g. people-html-v1/people-json-v1).
  Per CONFLICT-VISIBILITY-CHAIN §2 these are detector artifacts, not disputes.
- **Recommendation labels (report only, not applied):** IGNORE_CANDIDATE for all
  229. No status was changed.
- **Limitations:** no per-value observation timestamp exists in `data_conflicts`
  (only `detected_at`). Institution names resolved from the durable store;
  pilot stubs appear by id. Classification relies on source identity + note text.
- **Owner-review register:** `docs/data/CONFLICT-TRIAGE.csv` (one row per conflict,
  full values, no truncation) and `docs/data/CONFLICT-TRIAGE-SUMMARY.md`.
- **Explicit statement:** No conflict statuses, source data, evidence, assertions,
  history, or validation results were changed by this triage. Recommendations
  are labels in the report only.
- **Guard:** `npm run smoke:triage-conflicts` (11 checks) locks row count,
  categories, determinism, and the no-mutation statement.

**The one-line highest-value change for P0.4:** invert
`src/app/ingestion/page.tsx:96` so an unverified-zero does not render green. It is
a display change with no schema dependency and it stops the platform from
reporting healthy while carrying 229 unreviewed rows.