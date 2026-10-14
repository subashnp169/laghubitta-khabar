# FIELD-PROVENANCE-MODEL — Phase P0.2

**Status:** FROZEN (Phase P0.2)

How the system knows where a value came from, how much to trust it, and who
checked it.

> Honest scope note up front: **most fields do not currently have complete
> provenance.** §7 states exactly what is missing. This document defines the
> target model and states the gap.

---

## 1. Assertion vs entity — the distinction that must never collapse

```text
ASSERTION      "A source makes or supports a statement."
               e.g.  nrb-bfi-mid-may-2026 says Nirdhan capital = 274.27 crore

ENTITY         "The platform's normalized reading of that fact."
               e.g.  Institution mfi-001.paidUpCapitalCrore = 274.27

DERIVED        "We computed something from other records."
               e.g.  sector total assets = sum(50 institutions' total assets)
```

Three different claims with three different justifications. A source observation is
never canonical truth just because it was ingested; a computed number is never a
sourced number just because it looks like one.

**Frozen:** never overwrite a value because a "better" one appeared. Add an
assertion, let the conflict machinery surface it.

---

## 2. The full provenance set

Per **field**, per **source**, the target model:

| Attribute | Owner | Meaning | In schema? |
|---|---|---|---|
| `value` | assertion | what the source says | `data_assertions.value` |
| `source_id` | assertion | which registered publisher | ✅ |
| `source_url` | snapshot/source | the clickable page | `sources.url` |
| `source_grade` | source | A/B/C/D strength of publisher | `sources.source_grade` |
| `observed_at` | assertion | **when we saw it** | ✅ |
| `as_of` | assertion | **what date the source claims** | ❌ **GAP** |
| `retrieved_at` | snapshot | when we fetched the page | `source_snapshots.fetched_at` |
| `verified_at` | entity/assertion | when a human or rule confirmed | `last_verified_at` (many tables) |
| `confidence` | assertion | extraction certainty 0–1 | ⚠️ REAL, **no scale** |
| `status` | assertion | verification verdict | ✅ 6 states |
| `source_snapshot` | assertion | which fetch produced it | ✅ |
| `parser_version` | snapshot/extraction | which extractor | ✅ on snapshots and extractions |
| `reviewer` | review | who checked | ⚠️ `data_conflicts.resolved_by` only |
| `reviewed_at` | review | when checked | ⚠️ `data_conflicts.resolved_at` only |

### The `as_of` gap — most important finding in this document

**There is no `as_of` column anywhere in the 53-table schema.** Verified by
exhaustive search: `observed_at` exists only on `data_assertions`; `as_of`,
`retrieved_at`, `observed_date` **do not exist at all**.

The closest is `as_of`, which exists only inside the **generated frontend** data:

```json
"evidence": {
  "paidUpCapitalCrore": { "grade": "A", "sourceId": "nrb-bfi-mid-may-2026",
                          "asOf": "2026-05-15" }
}
```

So the one date that tells a reader *what the source claimed* lives in a
**transitional generated artifact** (`src/data/institutions.ts`), is emitted by
`scripts/generate-nrb-data.ts`, and has **no persistence column**. If the export
stops running, that date is gone.

**FUTURE SCHEMA GAP.** Recording the difference between "we fetched this on June
20" and "the source says this is as of May 15" is the difference between a
directory and a citation. It must be persisted. Requires an approved migration —
not done in P0.2.

`observed_at` is **NOT** a substitute. `observed_at` = our access time. It cannot
express a source's own as-of date, and conflating the two systematically
overstates how current the data is.

---

## 3. Source hierarchy — frozen

Grade lives on `sources.source_grade` and is inherited by every observation from
that source.

| Grade | Sources | Use |
|---|---|---|
| **A** | NRB, official MFB websites, official regulatory documents | Canonical truth |
| **B** | NEPSE, official exchange data, audited filings | Supporting |
| **C** | Reputable media, established research | Context, corroboration |
| **D** | Old reference datasets, discovery sources, unverified candidates | **Discovery only. Never canonical.** |

### The rule that matters

**A grade is a statement about the publisher, not about our verification.**

```
Grade A + UNVERIFIED   →  we trust this publisher, we have not checked it
Grade C + HUMAN_VERIFIED →  a weaker publisher, but a human confirmed it
```

These are different states and the UI already says so
(`app/institutions/[slug]/page.tsx`): *"A grade describes how strong the source
is, not whether we verified the claim ourselves."* Frozen.

### Old SENNA project

`C:\Users\Lenovo\Documents\Default Project\senna-mfi-intelligence` is **Grade D,
reference-only**. Useful for directory filtering, institution detail UX, the
verified-logo-with-provenance-fallback pattern, and corporate lineage discovery.

Its `hist-wean` / `hist-chautari` historical marks are contradicted by current NRB
lists. **Copying that data into canonical would inject known errors.** It is not
promoted.

---

## 4. The four distinct statements

A field value can be any of these. They must never be collapsed.

```text
SOURCE SAYS           a publisher asserted it
  → data_assertions row, verification_status UNVERIFIED

CANONICAL READING     we normalized it into an entity
  → institutions / people / branches row
  → "our interpretation", distinct from the raw claim

DERIVED               we computed it
  → metric_definitions.formula names the computation
  → §6 below

HUMAN REVIEWED        a person confirmed it
  → verification_status = HUMAN_VERIFIED
  → reviewer + reviewed_at must be retained
```

### Assertion ≠ entity ≠ derived

| | Assertion | Entity | Derived |
|---|---|---|---|
| Owned by | the source | the platform | a formula |
| Can be wrong | yes, and often | as wrong as its inputs | if an input is wrong |
| Has source | yes | by derivation | must point at inputs |
| Deleted when wrong | `REJECTED`, kept | re-derived | recomputed |
| Example | `value='274.27 crore'` | `paidUpCapitalCrore=274.27` | sector growth rate |

---

## 5. Verification status — frozen 6 states

`CHECK (verification_status IN ('UNVERIFIED','AUTO_VERIFIED','HUMAN_VERIFIED',
'CONFLICT','STALE','REJECTED'))` — identical on `data_assertions` and
`financial_metrics`.

| Status | Meaning | Current rows |
|---|---|---|
| `UNVERIFIED` | extracted, nobody checked | **5,071** |
| `AUTO_VERIFIED` | a rule confirmed it | 0 |
| `HUMAN_VERIFIED` | a person confirmed it | 0 |
| `CONFLICT` | sources disagree | 0 |
| `STALE` | was valid, source changed | 9 |
| `REJECTED` | judged wrong, retained for audit | 3 |

**99.8% of our data is UNVERIFIED.** Stated plainly: we have built an excellent
extraction engine and almost no verification. The review surface does not exist
yet. This is the honest state of the platform.

`REJECTED` rows being **retained rather than deleted** is the correct pattern and
is worth preserving: an audit trail must include what we threw away.

### Corroboration is derived, not stored

`SourceMeta.sources[]` is documented in `lib/repository/types.ts` as the place
corroboration lives: under source-owned observations, two sources agreeing
produce **two rows**, so "these sources agree" is a property of the set, never an
absence of rows. `sources.length >= 2` means corroborated by that many
independent publishers.

The field is **mandatory, not optional**, deliberately — when the read model
dropped all but the first source, the loss was silent and no type flagged it.
Frozen.

---

## 6. Derived data

Derived values are computed, never stored as if sourced.

| Derived | Current state |
|---|---|
| `shared_by` (people per role slot) | `PersonPositionDto` — documented as a count of published rows, *not* a claim the office is shared |
| province inference | `getProvinceFromHeadOffice()` — inferred from free text, **not sourced** |
| coverage percentages | planned, `institution_coverage` currently all `NOT_STARTED` |
| sector totals / growth rates / rankings | not built |
| `crawlSummary` aggregates | generated; counted from run data |

### Frozen rule

```
A calculated value must point back to the records it came from.
metric_definitions.formula   ← the computation
metric_definitions.lower_bound / upper_bound  ← sanity envelope
```

`metric_definitions` has a `formula` column and is **EMPTY (0 rows)**. That is the
designated home for derivation metadata and it is unfilled.

### Derived values the UI must not fake

```
paidUpCapitalCrore  →  SOURCED (NRB directory column, grade A, asOf 2026-05-15)
interest rate       →  SOURCED (assertion, period-bound)
branch count        →  DERIVED (count of assertions)
sector total assets →  DERIVED (sum across institutions) — not built
growth rate         →  DERIVED (period-over-period) — not built
```

Nothing derived may appear without a visible path to its inputs. If a reader
cannot get from a number to its source, the number does not ship.

---

## 7. Current provenance coverage — the honest gap

### What exists

| Layer | Coverage |
|---|---|
| `data_assertions` | 5,083 rows, all with `source_id` + `observed_at` + `verification_status` |
| Frontend `evidence` map | 51 institutions × 5 fields (`identity`, `headOffice`, `paidUpCapitalCrore`, `workingArea`, `officialWebsite`) |
| `sources.source_grade` | present on all 21 `lk.db` sources |
| `official_links` | `verified` + `verified_at` + `status` — the best-implemented provenance in the system |
| `financial_metrics` | `verification_status` + `last_verified_at` + `reported_value` + `normalized_value` — correct design, **0 rows** |
| Snapshots | 1,458 with `content_hash` + `parser_version` + `fetched_at` |

### What is missing

| Gap | Detail |
|---|---|
| **`as_of` not persisted** | Only in the generated `evidence` map. Nowhere in 53 tables. §2 |
| **`confidence` undefined** | REAL, no CHECK, no rubric. 0 non-null in practice |
| **`parser_version` on assertions** | On snapshots and extractions only; an assertion cannot be traced to the extractor that produced it |
| **`reviewer` / `reviewed_at`** | Only on `data_conflicts`. No assertion or entity records who checked it |
| **Per-field `verified_at`** | `last_verified_at` exists on 14 tables, but a field on the frontend `evidence` map has `verifiedOn` on only 153 of 255 entries |
| **Entity-level provenance** | `institutions.source_id` is ONE pointer for 20 fields of differing grade. `evidence` map does the real work and lives in generated TS |
| **Language provenance** | `sources.language`, `documents.language` exist; `news`/`posts` have no language column |
| **Zero human verification** | `HUMAN_VERIFIED`: 0 rows. `AUTO_VERIFIED`: 0 rows |

### The frontend `evidence` map — good design, wrong home

```json
"evidence": {
  "identity":           { "grade": "A", "sourceId": "nrb-bfi-mid-may-2026", "verifiedOn": "2026-06-20" },
  "paidUpCapitalCrore": { "grade": "A", "sourceId": "nrb-bfi-mid-may-2026", "asOf": "2026-05-15" },
  "officialWebsite":    { "grade": "C", "status": "candidate" }
}
```

Per-field, grade-aware, and honest about absence (`officialWebsite` has a grade
but **no sourceId** because no verified website exists). This is the right model.

It lives in `src/data/institutions.ts` — a **generated artifact**. It is emitted by
a script, has no schema column, and would vanish if the generator stopped. **The
best provenance design in the system is not persisted.** That is the single most
important gap in this document.

---

## 8. Conflict model

### Representation

`data_conflicts`: `entity_type`, `entity_id`, `field_name`, `source_a_id`,
`value_a`, `source_b_id`, `value_b`, `detected_at`, `resolution_status`
(`OPEN`/`RESOLVED`/`IGNORED`), `resolved_by`, `resolved_at`, `resolution_note`.

Paired A/B by design: a conflict is **between two specific sources**, so
attribution survives.

### Measured state

**229 conflicts, all `OPEN`, all `field_name = 'people_ceo'`, all
`entity_type = 'institution'`.** Sample:

```
value_a: "Mr. Chandra Mani Chaulagai"
value_b: "Mr. Narendra Singh Bista"
detected_at: 2026-09-27T04:35:50.894Z
resolution_status: OPEN, resolved_by: NULL
```

Distribution: `pilot-people-2026-09-27-ext-b-seed-first.db` 155,
`...-ext-c-pass1.db` 64, `pilot-people-ext-c-pass2.db` 10.

This is **correctly detected, correctly persisted, and never reviewed**. Some rows
are also misaligned pairings (an early batch pairs a name against the literal
`"Divisional Manager"` — a column-header collision in extraction). So detection is
imperfect too.

### Correction to P0.1

P0.1 stated `data_conflicts` was "never written". **That was wrong.** Detection and
persistence work. What is missing is review, resolution, and correct pairing.

### Nirdhan capital — the canonical example

```
NRB BFI mid-May 2026 (Grade A):   274.27 crore   asOf 2026-05-15
Earlier NRB figure (Oct 2025):   261.21 crore
LK published today:               274.27 crore   grade A, asOf 2026-05-15
```

The published value is a **preference with a stated basis**, not a resolution. A
conflict row should exist, be OPEN, and let the operator decide with evidence in
hand. Silently overwriting either number is forbidden.

**Current state: no conflict row exists for this.** `data_conflicts` holds only
`people_ceo`. **MISMATCH.**

### The Infinity `1900-01-09` source-noise case

`src/data/institutions.ts` → `mfi-034`:

```json
"operationDate": "1900-01-09",
"operationDateStatus": "source_anomaly",
"operationDateNote": "NRB displays 1900-01-09, awaiting clarification"
```

**This is exactly right and must not change.** `1900-01-09` is what NRB displays.
It is **source noise**, not an operating date.

Rules:
- The anomaly marker is preserved verbatim.
- It is **never** normalized to a plausible date (BS 1956, 2000-01-01, today).
- It is **never** treated as historical evidence of founding.
- It is a published `source_anomaly` awaiting regulator clarification.

Normalizing it would fabricate a founding date — the most damaging class of error
in a directory. Frozen.

---

## 9. Source-noise preservation — general rule

| Source artifact | Handling |
|---|---|
| `1900-01-09` operating date | Keep as `source_anomaly` + note. Never normalize. |
| 274.27 vs 261.21 capital | Both retained; conflict row OPEN; publish with stated basis |
| `(location not observed)` job fields | Literal placeholder in all 37 records — honest |
| `"(type not observed)"` | Same |
| Unread financial documents | `48 records … contents never read` shown to the reader |
| `null` official website | `websiteStatus: candidate` — absence is labelled, not blank |

The pattern is consistent: **an unobserved field is labelled, never invented.**
That is the property to protect.

---

## 10. Provenance for `data/master/master.json`

§19 of the directive: a seeded NRB-derived universe snapshot, not the permanent
canonical store.

```json
"universeSnapshot": {
  "source_id": "nrb-bfi-mid-may-2026",
  "title": "NRB BFI list (English, mid-May 2026)",
  "observed_at": "2026-06-20",
  "counts": { "institutions": 51, "aliases": 120,
              "official_links": 51, "timeline": 62, "sources": 11 }
}
```

| Element | Provenance |
|---|---|
| institutions | `source_id` → `nrb-bfi-mid-may-2026` (Grade A) + `source_grade_identity` |
| aliases | per-alias `source_grade` (sample: **C**) + `normalized_alias` for matching |
| officialLinks | per-link `verified` / `verified_at` / `status` (2 VERIFIED, 49 CANDIDATE) |
| timeline | per-event `source_id`, `predecessor_id`, `predecessor_name`, free-text `summary` with an inline evidence reference |
| sources | 11 registered publishers with `source_type`, `source_scope`, `source_grade` |

**Provenance strengths:** per-alias grade (the aliases are mostly Grade C —
honest, since alternate spellings come from aggregators, not NRB), per-link
verification state, and inline evidence pointers in timeline summaries.

**Provenance weaknesses:** no `as_of` per field, no `confidence`, no
`source_snapshot` link, and `predecessor_id` has **no schema column** to land in.

It is a **snapshot of one NRB list as of one date**. It does not grow. It is not
canonical truth.

---

## 11. Provenance for `data/pilot/evidence/*.db`

**Historical pilot evidence artifacts. Preserved. Not deleted. Not competing
production databases.**

| File | assertions | snapshots | conflicts |
|---|---|---|---|
| `phase-o-2026-09-26-base-51-source.db` | 2,482 | 688 | — |
| `pilot-branches-ext-2026-10-01.db` | 1,773 | 51 | — |
| `pilot-people-2026-09-27-ext-b-seed-first.db` | 384 | 47 | 155 |
| `pilot-people-ext-c-pass2.db` | 146 | 42 | 10 |
| `pilot-financials-ext-2026-10-01.db` | 153 | 335 | — |
| `pilot-people-2026-09-27-ext-c-pass1.db` | 91 | 44 | 64 |
| `pilot-people-2026-09-26-pre-ext-a-rejected.db` | 3 | 2 | — |
| `pilot-people-2026-09-27-post-ext-a.db` | 5 | 2 | — |
| `pilot-careers-ext-2026-10-01.db` | 38 | 118 | — |
| `m34-external-sample-2026-09-27.db` | 8 | 4 | — |
| `pilot-branch-shapes-2026-09-27.db` | 0 | 35 | — |
| `pilot-branch-url-discovery-2026-09-27.db` | 0 | 30 | — |
| `pilot-careers-2026-09-29.db` | 0 | 60 | — |
| **Total** | **5,083** | **1,458** | **229** |

Three files carry **0 assertions but 35/30/60 snapshots** — discovery-stage
artifacts. They are evidence that we looked and found nothing publishable.
**That is a result, not a failure, and deleting them would erase it.**

Two filenames encode provenance decisions directly: `...-pre-ext-a-rejected` and
`...-post-ext-a` are the before/after pair proving an extraction change was
measured, not guessed. Preserve both.

`ingestion_runs` appears only in 5 files (106 runs in the base DB, 18 in branches,
11/50/50/50/25 in the people DBs). Run identity exists but only within a dated DB —
which is precisely the P0.5 gap.

---

## 12. Frozen rules

1. A displayed fact is never a bare value. It carries source, as-of, and status.
2. Source observation ≠ canonical truth ≠ derived value. Three layers, never merged.
3. Grade describes the publisher, not our verification. Never substitute one for
   the other.
4. Unobserved fields are labelled, never invented.
5. Source noise is preserved verbatim, never normalized into a plausible value.
6. Conflicts are recorded and attributed to two sources; resolution requires a
   reviewer and a note.
7. Derived values must point back to their inputs via `metric_definitions.formula`.
8. Every value needs `as_of` persistence. **Currently a gap** — FUTURE SCHEMA GAP.
9. Old SENNA data is Grade D and never promoted without evidence.
10. `HUMAN_VERIFIED` requires a reviewer identity and a timestamp.
11. Corroboration is derived from a set of source-owned observations, never
    stored as a flag.
12. Rejected values are retained for audit, not deleted.

---

## 13. Outstanding gaps for P0.3 / P0.4 / P0.5

| # | Gap | Phase |
|---|---|---|
| 1 | No persisted `as_of` column anywhere | P0.5 migration |
| 2 | `parser_version` not on assertions | P0.5 migration |
| 3 | No `reviewer`/`reviewed_at` on assertions or entities | P0.5 migration |
| 4 | `confidence` has no defined scale | P0.4 |
| 5 | `entity_type` / `field_name` casing registries | P0.4 |
| 6 | Conflicts only for `people_ceo`; Nirdhan capital has none | P0.5 |
| 7 | `crawlSummary.conflictsOpen: 0` while 229 exist | **Root-caused in P0.3.** Not a filter bug: `pilot-export.ts:107` resolves a now-deleted `%TEMP%` scratch DB, and the export ran 11 h before the first conflict existed. Second independent drop at `pilot-export-people.ts:272` (`source_a_id <> source_b_id` excludes all 229, correctly — they are same-source) | P0.4 |
| 7a | `jobsProvenance` disagrees with its array (**RETRACTED in P0.3**) | False finding — text-match counted the interface declaration. String is correct | closed |
| 8 | `jobsProvenance` count disagrees with its own array | P0.4 |
| 9 | No language columns on `news`/`posts` | P0.4 |
| 10 | `metric_definitions` empty — no derivation registry | P4 |