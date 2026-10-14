# SOURCE-OF-TRUTH-MATRIX — Phase P0.4

**Status:** FROZEN (Phase P0.4). Documentation only. No file was moved, renamed,
deleted, or edited to produce this document.

Directive P0.4 asks for one thing: map every data source into exactly one class —
**authoritative**, **derived**, **transitional**, **reference-only**,
**deprecated** — so that "which value is true?" has an answer that is a property of
the *file*, not of whoever last edited it.

Every classification below is measured. Counts come from the files themselves on
2026-10-05, read-only. Where a chain has a missing link, the missing link is named.

---

## 1. The five inputs, and what they actually are

```text
lk.db                  1.0 MB   53 tables, 9 populated, 425 rows
evidence/*.db         17.4 MB   13 files, 5,083 assertions, 1,458 snapshots
src/data/*.ts          26,720 lines across 7 files (1 of them hand-written)
old SENNA data         13 JSON files, no database, no exports
NRB sources            4 JSON records + 1 temp ledger DB that no longer exists
```

**Only one of the five is a store of record.** `evidence/*.db` holds primary
assertions that cannot be re-fetched. `lk.db` is a build product of a JSON file.
`src/data/*.ts` is six generated modules plus one hand-made copy of a file that
belongs to a different project. The SENNA data has lost its database and its
exports. The NRB capture has lost the scratch database it was projected from.

---

## 2. The matrix

| # | Source | Class | Basis | Regenerable? |
|---|---|---|---|---|
| 1 | `data/pilot/evidence/*.db` (12 files, frozen 12-col assertion schema) | **AUTHORITATIVE** — assertions | 5,083 assertions + 1,458 snapshots, each row carrying `source_id`, `source_snapshot_id`, `confidence`, `verification_status` | **No.** The crawls are gone; these files *are* the primary record |
| 2 | NRB BFI list, mid-May 2026 (`sources.id = nrb-bfi-mid-may-2026`) | **AUTHORITATIVE** — identity | Cited by `source_id` on **51 of 51** `institutions` rows. Grade A. The only source with total coverage | **No** — it is a dated observation of a page. The live NRB list supersedes it and must be refreshed |
| 3 | `lk.db` | **DERIVED** | `scripts/seed.cjs` = `schema/schema.sql` + `data/master/master.json` + `data/pilot/pilot-sources.json`. `seed.cjs:36` deletes the file and rebuilds it | **Yes** — if `master.json` exists. It does |
| 4 | `src/data/people.ts` | DERIVED | `scripts/pilot-export-people.ts` ← evidence DB | Yes |
| 5 | `src/data/branches.ts` | DERIVED | `scripts/pilot-export-branches.ts` ← evidence DB | Yes |
| 6 | `src/data/pilot.ts` | DERIVED | `scripts/pilot-export.ts` ← the **deleted** pilot run DB | No — see #14 |
| 7 | `src/data/financials.ts` | DERIVED | `build-financials-module.ts:31` ← `pilot-financials-ext-2026-10-01.db` (committed) | Yes |
| 8 | `src/data/jobs.ts` | DERIVED | `build-jobs-module.ts:43` ← `pilot-careers-ext-2026-10-01.db` (committed) | Yes |
| 9 | `src/data/nrb.ts` | **TRANSITIONAL** — orphaned derived | `generate-nrb-data.ts` ← a `mkdtemp` scratch DB (`nrb-ledger.ts:138`). 2,456 lines / 104 KB with no surviving input | Only by re-crawling NRB |
| 10 | **`src/data/institutions.ts`** | **TRANSITIONAL** — hand-maintained | 94 lines, 51 rows, **no generator**. Its 18 keys and its first element are identical to the old project's `data/mfi-directory.json` — it is a copy of that export, not a build product | **No** |
| 11 | `data/master/master.json` | **DERIVED, ORPHANED** — acting authoritative | Written by `build-master.cjs:241` from `*_dump.json` **which no longer exist**. It is nonetheless the only surviving carrier of the NRB identity observation, and both `seed.cjs` and `mock.ts` read it | **No** — `build-master.cjs` reads `%TEMP%/opencode/*_dump.json`, all three absent |
| 12 | `data/master/index.ts` | **DEPRECATED** | 110 KB of generated TS, 6 exports, **zero importers** (`src/`, `lib/`, `worker/` never reference it) | n/a |
| 13 | `lib/repository/mock.ts` | **TRANSITIONAL** — dead seam | The only runtime reader of `master.json` (`mock.ts:51`). `getRepository()` has zero callers, so the mock is never constructed | n/a |
| 14 | `data/pilot/*.json` run reports (11) + `data/control/schedule-report.json` | **REFERENCE-ONLY** — provenance | Record what a run did. **3 distinct `%TEMP%` DB paths across 6 keys in 4 files are deleted**; 7 relative `db_path` values all resolve | n/a |
| 15 | `data/nrb/*.json` (4) | **REFERENCE-ONLY** — provenance | `nrb-ledger-report.json` still names `…\lk-nrb-uOM0mm\nrb.db` and `…\lk-nrb-ledger-fOZZkt\nrb.db`, both gone | n/a |
| 16 | `pilot-branch-url-discovery-2026-09-27.db` | **DEPRECATED** | Legacy **6-column** `data_assertions` (`assertion_type`, `field`, `value_text`) — the pre-freeze spelling. **0 rows** | n/a |
| 17 | `pilot-careers-2026-09-29.db`, `pilot-branch-shapes-2026-09-27.db` | **DEPRECATED** | 0 assertions each; superseded by their `-ext-2026-10-01` counterparts | n/a |
| 18 | `pilot-people-2026-09-26-pre-ext-a-rejected.db` | **DEPRECATED** | 3 rows, all `REJECTED`. Kept for audit, never published | n/a |
| 19 | old SENNA `data/*.json` (13 files) | **REFERENCE-ONLY** | Grade D / different project. `mfi-directory.json` is the file `institutions.ts` was copied from. `registry.json` holds 7 sources; `metric-definitions.json` and `fact-os/*` have no counterpart here | n/a |
| 20 | old SENNA Django DB and its `*_dump.json` exports | **DEPRECATED** — absent | No `.sqlite`/`.db` anywhere in the project; no `*dump*.json`. The pipeline that read them **cannot run** | n/a |
| 21 | `src/lib/site-data.ts` | **TRANSITIONAL** — sanctioned seam | Directive P0.3 (line 1956): "Existing `src/lib/site-data.ts` may remain as transitional seam." Live, but 4 `src/` files bypass it (`TYPE-LAYERS.md` §5) | n/a |

### The class definitions used here

| Class | Test |
|---|---|
| **authoritative** | Losing the file loses information that cannot be re-fetched. Append-only. |
| **derived** | A named script rebuilds it byte-for-byte from an authoritative input. Safe to delete. |
| **transitional** | Live and consumed, but superseded, hand-maintained, or missing its input. Must have a removal condition. |
| **reference-only** | Consulted for comparison. Never promoted to published truth (directive §10, Grade D: "Do not silently turn Grade D discovery information into canonical truth", line 692). |
| **deprecated** | No live consumer, or its schema/spelling is pre-freeze. Retained for audit only. |

---

## 3. The identity chain, drawn

```text
[NRB BFI list, mid-May 2026]                        AUTHORITATIVE
        │
        │  (captured once, into a Django-era export)
        ▼
SENNA DB  ──*_dump.json──>  build-master.cjs  ──>  data/master/master.json
   ✗ ABSENT      ✗ ABSENT          │                       │
                                       │                       │
                                       ├──> data/master/index.ts   DEPRECATED (0 importers)
                                       │        │
                                       │        └──> seed.cjs ──> lk.db ──> local.ts / d1.ts ──> Worker ──> API
                                       │                 DERIVED         DERIVED
                                       └──> src/data/institutions.ts
                                            TRANSITIONAL — copied by hand, 16 ids mean something else
```

**The chain is severed at both ends.** The NRB page is live and authoritative; the
capture that froze it is gone, and so is the generator that would take a new one.
What remains is `master.json` — an orphaned artifact that has quietly become the
identity authority because nothing else holds the data.

### `lk.db` is 9 tables and 425 rows

| Table | Rows | Cols |
|---|---|---|
| `institution_aliases` | 120 | 7 |
| `timeline_events` | 62 | 7 |
| `institutions` | 51 | 26 |
| `institution_coverage` | 51 | 14 |
| `official_links` | 51 | 11 |
| `outbound_links` | 51 | 17 |
| `sources` | 21 | 18 |
| `ingestion_sources` | 10 | 12 |
| `field_refresh_policies` | 8 | 2 |

The other **44 tables are empty**, including every evidence table:
`data_assertions` 0, `data_conflicts` 0, `source_snapshots` 0. The canonical
store has schema for people, positions, branches, financials, documents, jobs and
news — and holds none of them. **There is no populated canonical store yet.** P1
would be building the first one, not extending one.

---

## 4. Three 51-row rosters, one set of ids, three different answers

`src/data/institutions.ts`, `lk.db.institutions`, and `data/master/master.json` all
hold exactly 51 institutions with exactly 51 shared ids. `master.json` and
`lk.db` agree on everything except one column. `institutions.ts` disagrees with
both on eight fields — and on **who 16 of the ids are**.

### 4a. Field-level divergence, 51 institutions

| Comparison | Divergent |
|---|---|
| `master.json` vs `lk.db.institutions` | **0 values.** All 23 shared fields agree for all 51 rows. They differ only in shape: master carries `source_grade_identity` (`"A"` × 51), lk adds `created_at`/`updated_at` |
| `institutions.ts` vs `lk.db` — 16 of its 18 keys have **no counterpart column** | **51 / 51** — the display file does not carry these fields at all |
| `institutions.ts` vs `lk.db` — `operation_date`/`operationDate` | **17** (1 sentinel + 16 real) |
| `institutions.ts` vs `lk.db` — `slug`, `name`/`name_en` | **16** |

The 51/51 divergence is an **absence, not a disagreement** — and it is total.
`institutions.ts` shares exactly **two** key names with the canonical shape: `id`
and `slug`. The other 16 are legacy names:

| `institutions.ts` | canonical column | in lk.db? |
|---|---|---|
| `serial` | — | no (row order instead) |
| `name` | `name_en` | no |
| `sourceNameRaw` | — | no |
| `licenseClass` | `nrb_class` | no |
| `licenseStatus` | — | no (not a column at all) |
| `operationDate` | `operation_date` | no |
| `operationDateIsJointAfterMerger` | — | no |
| `headOffice` | `head_office_district` + `head_office_municipality` | no (one free-text string instead of two columns) |
| `paidUpCapitalCrore` | — | no (**financial field on the identity row**) |
| `workingArea` | `working_area` | no |
| `officialWebsite` | `official_website` | no |
| `websiteStatus` | — | no |
| `aliases` | `institution_aliases` (120 rows) | no |
| `evidence` | `data_assertions` (5,083 rows) | no |
| `coverageType` | `institution_coverage` (51 rows) | no |
| `operationDateStatus` | — | no |

So the pages render an institution from a shape that **predates the schema**, and
every one of those four nested structures (`aliases`, `evidence`, `coverageType`)
duplicates a table that `lk.db` already has — populated or not. `head_office_*`
exists as two columns in the database and is one comma-joined string in the
display file. **`paidUpCapitalCrore` has no column anywhere in `lk.db`**: a
financial fact is stored on the identity record.

`lk.db.institutions.last_verified_at` is `"2026-06-20"` for **all 51** — one
verification date, one source, no per-field variation.

### 4b. `mfi-036` … `mfi-051` are different institutions in each roster

Sixteen **contiguous** ids. This is not drift; it is a remap.

| id | `institutions.ts` (published) | `lk.db` / `master.json` |
|---|---|---|
| mfi-036 | Surya Jyoti Laghubitta Bittiya Sanstha Ltd. | Sampada Laghubitta Bittiya Sanstha Ltd. |
| mfi-037 | Manakamana Laghubitta Bittiya Sanstha Ltd. | NIC Asia Laghubitta Bittiya Sanstha Ltd. |
| mfi-038 | Sahakarya Laghubitta Bittiya Sanstha Ltd. | Mahila Laghubitta Bittiya Sanstha Ltd. |
| mfi-039 | Aamra Bikas Laghubitta Bittiya Sanstha Ltd. | Manushi Laghubitta Bittiya Sanstha Ltd. |
| mfi-040 | Janasahayog Laghubitta Bittiya Sanstha Ltd. | Unique Nepal Laghubitta Bittiya Sanstha Ltd. |
| mfi-041 | Aadarsha Laghubitta Bittiya Sanstha Ltd. | Upakar Laghubitta Bittiya Sanstha Ltd. |
| mfi-042 | Aadhibhumi Laghubitta Bittiya Sanstha Ltd. | Dhaulagiri Laghubitta Bittiya Sanstha Ltd. |
| mfi-043 | Nepal Sahakarya Laghubitta Bittiya Sanstha Ltd. | CYC Nepal Laghubitta Bittiya Sanstha Ltd. |
| mfi-044 | Samanat Laghubitta Bittiya Sanstha Ltd. | NESDO Samriddha Laghubitta Bittiya Sanstha Ltd. |
| mfi-045 | Nyadi Laghubitta Bittiya Sanstha Ltd. | Swastik Laghubitta Bittiya Sanstha Ltd. |
| mfi-046 | Samaj Laghubitta Bittiya Sanstha Ltd. | Shrijanshil Laghubitta Bittiya Sanstha Ltd. |
| mfi-047 | Naya Nepal Laghubitta Bittiya Sanstha Ltd. | Matribhumi Laghubitta Bittiya Sanstha Ltd. |
| mfi-048 | Grameen Samanantar Laghubitta Bittiya Sanstha Ltd. | Jeevan Bikash Laghubitta Bittiya Sanstha Ltd. |
| mfi-049 | Srijil Laghubitta Bittiya Sanstha Ltd. | Aatmanirbhar Laghubitta Bittiya Sanstha Ltd. |
| mfi-050 | Sabase Laghubitta Bittiya Sanstha Ltd. | Sanjeevani Laghubitta Bittiya Sanstha Ltd. |
| mfi-051 | Kisan Kalyan Laghubitta Bittiya Sanstha Ltd. | Aviyan Laghubitta Bittiya Sanstha Ltd. |

**Nothing on disk can reconcile the two.** Measured:

- `institution_aliases` holds **120 rows, every one `NAME_ALT`**, and every one is
  a short or "Limited"-form of the institution's **current** name. There is not a
  single `FORMER` row, and **15 of the 16 published names appear nowhere** in the
  database. (The 16th, `Nepal Sahakarya` → `CYC Nepal`, matches only because
  `CYC Nepal` is also the new name's alias — coincidence, not lineage.)
- `slug_aliases` is **empty**. So the old slugs are not recorded either.
- `timeline_events` holds 62 rows — `MERGED` 42, `ACQUIRED` 19, `RENAMED` 1 — and
  **62 of 62 have `occurred_at = NULL`**. The merge wave is named but undated.

**Consequence, stated plainly:** the site publishes
`/institutions/surya-jyoti-laghubitta-bittiya-sanstha-ltd` while the database
believes `mfi-036` is Sampada and has never heard of Surya Jyoti. Any
`/go/mfi-036/...` door resolves against a different institution. This is the single
largest correctness defect found in any phase so far, and it is a **data**
defect, not a code defect.

---

## 5. Evidence layer: 13 files, 12 of one schema

| File | Assertions | Role |
|---|---|---|
| `phase-o-2026-09-26-base-51-source.db` | 2,482 | the base universe crawl |
| `pilot-branches-ext-2026-10-01.db` | 1,773 | branches |
| `pilot-people-2026-09-27-ext-b-seed-first.db` | 384 | people, 155 conflicts |
| `pilot-people-ext-c-pass2.db` | 146 | people |
| `pilot-people-2026-09-27-ext-c-pass1.db` | 91 | people |
| `m34-external-sample-2026-09-27.db` | 8 | the only `BRANCH` entity rows in existence |
| `pilot-people-2026-09-27-post-ext-a.db` | 5 | applied extension |
| `pilot-people-2026-09-26-pre-ext-a-rejected.db` | 3 | **deprecated** — all REJECTED |
| `pilot-financials-ext-2026-10-01.db` | 153 | financials |
| `pilot-careers-ext-2026-10-01.db` | 38 | vacancies |
| `pilot-branch-shapes-2026-09-27.db` | 0 | **deprecated** |
| `pilot-careers-2026-09-29.db` | 0 | **deprecated** |
| `pilot-branch-url-discovery-2026-09-27.db` | 0 | **deprecated** — legacy 6-column schema |

5,083 assertions, 1,458 snapshots, 229 conflicts. **These files are the only
retained primary evidence, and they are the one input in the entire system with no
missing link.** Everything else can be rebuilt from them; they cannot be rebuilt
from anything.

Two consequences for P0.5:

1. There is no writer that appends to them. Each crawl opens its own dated file,
   so "the evidence database" is 13 files and no index.
2. Nothing correlates them. `pilot-people-report-ext-b-baseline.json` names
   `pilot-people-2026-09-27-ext-b-seed-first.db`; the sibling files are found only
   by date-prefix convention.

---

## 6. Provenance that exists, and provenance that does not

| Fact | Value | Verdict |
|---|---|---|
| `sources` rows | 21 (11 from `master.json` + 10 from `pilot-sources.json`) | populated |
| Identity coverage | `nrb-bfi-mid-may-2026` on **51/51** institutions | total |
| `sources.url` duplicates | **0** | the `seed.cjs` UNIQUE rule holds |
| `sources.domain` collisions | `www.nrb.org.np` × **8**, `www.aarambhachautari.com` × 2, plus bare `aarambhachautari.com` × 1 | 21 sources over **13 domains** (12 logical hosts — one host is recorded twice, `www.`-prefixed and bare) |
| `lk.db` `sources.content_hash` | **0 / 21** | no fingerprint on the registry row |
| `lk.db` `sources.r2_key` | **0 / 21** | no raw artifact referenced |
| `lk.db` `sources.fetched_at` | **0 / 21** | **the registry never records when it was read** |
| evidence `source_snapshots.content_hash` | **1458 / 1458** real sha256, 1144 distinct | **corrected in P0.5** — retrieval *was* fingerprinted |
| evidence `source_snapshots.r2_key` | **0 / 1458** | **the fingerprint is real but the bytes it fingerprints were never kept** |
| evidence `source_snapshots.parser_version` | **1458 / 1458**; also on **264 / 264** runs | the parser that produced each observation is recorded |
| `institution_coverage` | 51 rows, all ten axes `NOT_STARTED` | a vocabulary that can only say "not started" |
| `institutions.listed` | `"0"` × 51 | present, uniformly false |
| `institutions` empty columns | `name_np`, `registration_number`, `nrb_license_number`, `official_email`, `official_phone`, `logo_url` — **51/51 each** | 6 of 26 columns never populated |

**Correction issued in P0.5.** An earlier draft of this table reported "no content
fingerprint anywhere" on the strength of the `lk.db` registry alone. That was wrong
in scope. The 13 evidence databases do fingerprint every retrieval: 1458 of 1458
`source_snapshots` carry a real 64-character sha256, and all 264 runs carry a
`parser_version`. What is missing is the *other half* — `r2_key` is NULL on all
1458, so no retrieved payload was ever retained. Directive §15 asks "what did the
source say at that time?" and the honest answer today is: **the store can prove a
page was read and that its bytes differed, but it cannot show what they said.**

So the registry in `lk.db` is still a **list of names** rather than a record of
having read anything — that verdict stands, but it belongs to the registry, not to
the evidence. The evidence is in a better state than this table first claimed, and
in a worse state than a sha256 column suggests. `CONFLICT-VISIBILITY-CHAIN.md` §7
reached the registry conclusion from the other direction; the same evidence
confirms it.

---

## 7. Three deleted paths, six keys, recorded in committed files

Every run report is committed. Three of them point at databases that no longer
exist:

| Dead path | Cited by |
|---|---|
| `…\Temp\lk-pilot-Iq2nti\pilot.db` | `pilot-run-report.json:dbPath`, `discovery-report.json:dbPath`, `schedule-report.json:dbPath` |
| `…\Temp\lk-nrb-uOM0mm\nrb.db` | `nrb-run-report.json:dbPath`, `nrb-ledger-report.json:intakeDbPath` |
| `…\Temp\lk-nrb-ledger-fOZZkt\nrb.db` | `nrb-ledger-report.json:ledgerDbPath` |

Seven more `db_path` values are relative and all resolve correctly
(`data/pilot/evidence/*.db` × 7).

`npm run pilot:export` reads `pilot-run-report.json` when given no argument, so it
opens the first dead path and dies with `TypeError: Cannot open database because
the directory does not exist`. **The failure is correct behaviour on a broken
input**: the script will not silently substitute a different database. What is
wrong is the committed report, not the script.

Two generators read **committed** evidence DBs by hardcoded relative path
(`build-financials-module.ts:31`, `build-jobs-module.ts:43`) and write an **empty
module** with an explanatory header when the file is absent. That is the pattern
the rest of the pipeline should copy: no evidence → an empty, labelled module, never
a guess.

---

## 8. Frozen conclusions

1. **Two things are authoritative: the evidence snapshots (for assertions) and the
   dated NRB BFI capture (for identity).** Everything else in the repository is a
   copy, a build product, or a report about one of those two.
2. **`lk.db` is derived, not a store of record.** `seed.cjs` deletes and rebuilds
   it from `master.json`. Treating it as the system of record would invert the
   dependency.
3. **`master.json` is orphaned but load-bearing.** Its input exports are gone, so
   it cannot be regenerated — and it is the only carrier of the identity
   observation. **It is the highest-value file in the repository and has no backup
   inside it.**
4. **`src/data/institutions.ts` is a copy of the old project's export**, not a
   generated module. It is the live display source for all 51 institutions and it
   is wrong about 16 of them.
5. **There is no populated canonical store.** 44 of 53 tables are empty, including
   every evidence table. P1 populates the first rows of the canonical model.
6. **Identity is one source with total coverage** (`nrb-bfi-mid-may-2026`, 51/51),
   which is the strongest provenance fact in the system.
7. **Source granularity is unresolved:** 21 sources over 13 recorded domains (12
   logical hosts — `www.aarambhachautari.com` and `aarambhachautari.com` are both
   present), 8 of them the same NRB host, no URL duplicates, no fetch times on the
   registry row. A host is not a source identity; P0.5 needs to know which.
   *(P0.5 confirmed the fingerprint half: see the correction in §6.)*
8. **Committed reports must not point at scratch paths.** A report is evidence; an
   evidence file that cites a deleted database is a liability.
9. **Reference-only means reference-only.** The SENNA JSON files are the input for
   this matrix and nothing else; no Grade D value may reach a page.
10. **Nothing is deleted in P0.4.** Every "deprecated" row above is retained; the
    class records the removal condition, not the removal.

---

## 9. Reconciliation actions for P0.4

Ordered. Each is a decision or a small change, none is a schema migration.

| # | Action | Class affected | Why it is first |
|---|---|---|---|
| 1 | Decide the canonical `name`/`slug` for `mfi-036`…`mfi-051` and populate `slug_aliases` + `FORMER` aliases so both rosters resolve | authoritative | 16 institutions are published under identities the database rejects |
| 2 | Copy `master.json` into version control with a `content_hash`, and record the NRB capture date as `universeSnapshot.observed_at` | derived (orphan) | the identity authority has no backup and no hash |
| 3 | Re-point `npm run pilot:export` at a committed path, or mark the three run reports superseded | reference-only | one command is broken on a committed input |
| 4 | Retire the 16 legacy keys: generate the display institution from `master.json` (or add the 8 real columns the pages need) and delete the hand copy | transitional | pages render a pre-schema shape that nests four things `lk.db` already holds as tables |
| 5 | Write `sources.fetched_at` on every read, and retain the fetched payload where `r2_key` can point at it | authoritative | the evidence fingerprints every read (1458/1458 sha256) but keeps no bytes — freshness is not answerable |
| 6 | Date the 62 `timeline_events`, or mark them explicitly undated | authoritative | the merge wave is the reason 16 ids moved |
| 7 | Retire `data/master/index.ts` (0 importers) and the 3 empty/legacy evidence DBs | deprecated | dead generated code that reads as canonical |
| 8 | Give the vocabulary enforcer, the alias map, and the confidence rubric a home in this matrix as they land | all | `DOMAIN-VOCABULARY.md` froze them without a store |

**Item 1 needs no migration.** `alias_type` already accepts `'FORMER'`
(`schema/schema.sql:157`) and `slug_aliases` exists with 0 rows — both containers
are in place and empty. Nothing blocks writing the lineage except the decision of
which name is canonical.

**Items 1 and 2 are the ones that cannot wait.** Item 1 is a published-data
correctness defect; item 2 is a single point of failure for identity.

---

## 10. Not fixed in P0.4

Directive P0 (line 1870): "No destructive changes." Line 1901: "STOP and report
before destructive restructuring." This phase is a mapping. No file was moved,
renamed, deleted, or edited. The matrix, this document, and the WORKMAP phase report
are the only outputs.

Approval is required before: changing `institutions.ts` or `master.json` (§56),
populating any of the 44 empty tables, dropping or rewriting any evidence DB,
deleting `data/master/index.ts` or the deprecated evidence files, and any refresh
of the NRB identity capture.

Production impact: **NONE.**