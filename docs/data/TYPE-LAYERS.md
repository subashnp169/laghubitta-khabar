# TYPE-LAYERS — Phase P0.3

**Status:** FROZEN (Phase P0.3). Ownership of every type in the system.

The requested boundary:

```
DOMAIN → PERSISTENCE → REPOSITORY → PROJECTION → DISPLAY
```

Plus the rule that **projection types must not become hidden competing domain
models.**

---

## 1. The five layers

| Layer | Question it answers | Owns | Lives in |
|---|---|---|---|
| **DOMAIN** | What does this thing *mean*? | Vocabulary, invariants, temporal semantics | `docs/data/DOMAIN-VOCABULARY.md`, `TEMPORAL-VOCABULARY.md` |
| **PERSISTENCE** | How is it *stored*? | Row shapes, column names, nullability | `schema/schema.sql` (frozen), `lib/repository/types.ts` DTOs |
| **REPOSITORY** | How is it *fetched*? | Operations, not shapes | `lib/repository/contract.ts` |
| **PROJECTION** | How is it *shaped for a consumer*? | Read models, derivation | `lib/repository/projection.ts` |
| **DISPLAY** | How is it *rendered*? | View models, formatting | `src/types/index.ts`, `src/lib/site-data.ts` |

**Frozen direction of dependency:**

```
DISPLAY → PROJECTION → REPOSITORY → PERSISTENCE → DOMAIN
```

Each layer may reference the one below. **A layer may never reference the one
above.** `lib/` must never import `src/`; `src/` must never import a concrete
adapter.

---

## 2. Why layers exist (and when to refuse them)

Four layers is one too many if each adds nothing. The test applied here:

> **Does a layer exist because the shapes genuinely differ, or because two
> people wanted different casing?**

Genuine differences found, each justifying its layer:

| Layer | Genuine difference? |
|---|---|
| DOMAIN vs PERSISTENCE | ✅ `license_class` (display) vs `nrb_class` (column, implies the regulator). Meaning differs, not just spelling |
| PERSISTENCE vs PROJECTION | ✅ `branches` has 18 columns; `BranchDto` (types.ts:173) has 8 + `meta`. The projection exists to avoid shipping phone/email to a listing |
| PROJECTION vs DISPLAY | ✅ `FinancialReportDto.metrics: Record<string, {reported_value, normalized_value}>` (types.ts:194) must become rendered labels |
| DOMAIN vs PERSISTENCE for aliases | ❌ **No genuine difference.** `data/master/master.json` `aliases[120]` carry `normalized_alias` + `source_grade`; the `institution_aliases` table (7 columns) has neither. One layer, information dropped |
| A separate "API type" layer | ⚠️ **It already exists, half-built.** See below |

**The API type layer — measured, not imagined.** `lib/api/contract.ts` does *not*
reuse `Paged<T>`. It defines its own envelope family: `ApiMeta`,
`CollectionEnvelope<T>`, `ResourceEnvelope<T>`, `ErrorEnvelope`. And
`lib/api/repository.ts:20,49` **re-declares `InstitutionSummary` and
`InstitutionDetail`** with a third field vocabulary, while importing
`SourceMeta`, `PersonDto`, `BranchDto`, `FinancialReportDto`, `InterestRateDto`
from `../repository/types` (`:17`) — the DTOs it did *not* reinvent.

So the API layer is a partial duplication, not a layer:

| Reused from repository | Re-declared in the API layer |
|---|---|
| `SourceMeta`, `PersonDto`, `BranchDto`, `FinancialReportDto`, `InterestRateDto` | `InstitutionSummary`, `InstitutionDetail` |
| — | `ApiMeta`, `CollectionEnvelope`, `ResourceEnvelope`, `ErrorEnvelope` |

**Frozen:** the envelope types are a genuine layer (HTTP shape ≠ data shape) and
stay. The re-declared Institution types are **not** — they are the MISMATCH-3
duplicate, and consolidating them into the DTOs is a P1 type change.

**Frozen: no new type layer may be introduced without naming the boundary
difference it protects.** "It reads nicer" is not a boundary.

---

## 3. Assertion vs entity ownership — the critical distinction

```
ASSERTION      evidence about something.  Owned by a SOURCE.
ENTITY         our normalized reading.     Owned by the PLATFORM.
```

An assertion is **not** a weak entity. They are different kinds of thing:

| | Assertion | Entity |
|---|---|---|
| Owner | the publisher | us |
| Existence | independent of our model | depends on our model |
| Created by | extraction | promotion |
| Grade | inherits `sources.source_grade` | has `verification_status` |
| Deletion | never (REJECTED) | only via a lifecycle state |
| Belongs to | one `source_id` | the platform |
| Answers | "what did the source say?" | "what do we believe?" |

**Frozen: an assertion never becomes an entity by being read more than once.**
Promotion is an explicit, auditable decision.

Concretely, from P0.2: `branches` = 0 rows while 2,932 `branch_name` assertions
exist. **Those 2,932 are not branches.** They are 2,932 statements that some pages
mention branch names. Promoting them is a P3 decision with a human gate.

### `entity_type` is not an entity reference

`data_assertions.entity_type` + `entity_id` points at **an entity that may not
exist**. An assertion can reference `branch` for an id with no `branches` row.
That is legal and correct: evidence can arrive before the entity is modelled.

**Frozen:** assertions may reference unpromoted entities. Consumers must handle a
dangling `entity_id` rather than assume referential integrity.

---

## 4. The one authoritative Institution shape

P0.2 MISMATCH-3 found **two disjoint type worlds**. P0.3 measurement found
**four**. Resolved:

### DOMAIN shape — authoritative

The canonical Institution concept is defined in
`docs/data/CANONICAL-MODEL.md` §4 and `DOMAIN-VOCABULARY.md`. It is a **document**,
not a TypeScript interface, because it must outlive any code layer.

### Four representations, three field vocabularies

| Layer | Type | Why it differs | Status |
|---|---|---|---|
| PERSISTENCE | `institutions` table (26 cols) + `institution_aliases` (7) + `official_links` | Storage: `nrb_class`, `registration_number`, `next_review_at`, `created_at`/`updated_at` | ✅ authoritative for storage |
| REPOSITORY DTO | `InstitutionSummary` (`types.ts:67`, 15 fields) + `InstitutionDetail` (`:135`) | Read model; Detail adds `aliases`, `official_links`, `timeline`, `coverage`, `go_slug`. Carries **no** license, paid-up capital, or coverage type | ✅ authoritative for the API contract |
| API envelope | `InstitutionSummary` (`lib/api/repository.ts:20`) + `InstitutionDetail` (`:49`) | HTTP envelope. **Re-declared**, snake_case, adds `evidence` = crawl-run counters | ⚠️ **duplicate of the DTO** |
| DISPLAY | `Institution` (`src/types/index.ts:1`, 20 fields) | Denormalized directory projection with the per-field `evidence` map | ⚠️ **misnamed** |

`src/data/institutions.ts` (51 hand-written rows) and
`data/master/master.json` (51 rows, 25 keys) are the two data sources behind them.
Neither has a generator that keeps the shapes in step.

### The `evidence` name collision — same word, two meanings

This is the sharpest instance of the "projection becomes a hidden domain model"
failure, so it is called out explicitly:

| Where | Type | Meaning |
|---|---|---|
| `src/types/index.ts:17` | `Record<string, {grade; sourceId?; verifiedOn?; status?; asOf?}>` | **Per-field provenance.** 255 entries |
| `lib/api/repository.ts:33-42` | `{runs; snapshots; branch_count; vacancy_count; document_count; source_status; is_due; paused}` | **Crawl-run counters.** 51 entries |

Same name, unrelated meaning, both attached to "Institution". The API layer dodges
the collision by aliasing: `InstitutionDetail.sourced_evidence` (`:60`) is typed
`Institution["evidence"]` — the **display** type, imported from `@/types` (`:8`),
inside a **lib** module. That single import is an inverted dependency and the
clearest evidence that the display type has become the de facto domain model.

**Frozen:** `evidence` is reserved for per-field provenance. Crawl/operational
counters take a different name (`crawl_stats`, `collection_state`). Not renamed in
P0.3 — renaming a field the API publishes is an observable change, so it is P1.

### Naming problem, stated

`src/types/index.ts` calls its type `Institution`. It is **not** the domain
Institution — it is a display projection carrying `serial`, `sourceNameRaw`,
`licenseClass`, `operationDateIsJointAfterMerger`, `coverageType`, and the
`evidence` map. The API layer re-declares `InstitutionSummary` **and**
`InstitutionDetail`, and `lib/repository/types.ts` declares *different*
`InstitutionSummary`/`InstitutionDetail`. Four names, three vocabularies, zero
canonical owner.

**Frozen: the display type is a projection and must be named as one.**
`InstitutionDirectoryRow`. The API pair must be deleted in favour of the DTOs.
Both are type-only renames/consolidations — no behavioural change, verified by
`tsc` + build (§10).

### Field mapping — deliberate divergences

| DOMAIN | DISPLAY (`src/types`) | PERSISTENCE | Note |
|---|---|---|---|
| `license_class` | `licenseClass` | `nrb_class` | 3 names, 1 concept |
| `license_status` | `licenseStatus` | `status` | ⚠️ **semantic collision** |
| `operation_date` | `operationDate` | `operation_date` | + `operationDateStatus` / `operationDateNote` exist only on display |
| `paid_up_capital_crore` | `paidUpCapitalCrore` | — | ⚠️ **no column** |
| `head_office` (single string) | `headOffice` | `head_office_district` + `_municipality` + `_address` | display collapses 3 → 1 |
| `coverage_type` | `coverageType` | `institution_type` + `working_area` | display derives |
| — | `evidence` | `data_assertions` | ⚠️ **no column**; and name-collided (§above) |
| — | `aliases: string[]` | `institution_aliases` (7 cols, typed) | display discards `alias_type`, `source_id`, `last_verified_at` |
| — | `serial` | — | display-only ordinal |
| — | `sourceNameRaw` | `name_en` | master.json keeps both; display keeps only the raw |
| `as_of` | `evidence[*].asOf`, `directorySource.asOf` | — | ⚠️ **not persisted** |
| — | `source_grade_identity` | — | in `master.json` only, **no column** |

**The three dashed rows are the real problems:** `evidence`,
`paid_up_capital_crore`, and `as_of` exist in the display layer or `master.json`
with **no persistence**. The display type is, in part, holding state the database
does not have.

**Frozen:** DISPLAY may hold presentation-only fields (`serial`, `coverageType`,
`websiteStatus`) but **must never be the only home of a factual field.** If a
display-only field is factual, persistence is owed and the gap is recorded.

---

## 5. Frozen field-ownership rules

1. A factual field lives in DOMAIN first. Persistence second. Display third.
2. A display-only field must be **derived**, or **recorded as a gap**.
3. Renames are allowed freely; **semantic changes are not** without a
   domain-vocabulary update.
4. `license_status` (display) and `status` (persistence) are **different
   concepts** that currently share a name. Frozen: display `licenseStatus` means
   *is it licensed*; persistence `status` means *lifecycle state*. They must be
   disambiguated at P1.
5. `paidUpCapitalCrore` is a sourced directory fact, **not** a `financial_metric`.
   It has no period, no `metric_code`, no report. Frozen.
6. `evidence` is a **projection of provenance**, not a field on an entity.
7. Projection types carry no domain invariants and no validation logic.
8. `PersonDto.positions[].shared_by` is a **derived count of published rows**, not
   a claim about a role. Its documentation is load-bearing; keep it.

---

## 6. Assertions vs projections — who reads what

| Consumer | Layer | Reads |
|---|---|---|
| `worker/src/index.ts:61` | REPOSITORY (direct) | `D1InstitutionRepository` — **not** via `getRepository()` |
| `lib/api/handler.ts` → `lib/api/repository.ts` | PROJECTION | `@/data/*` generated modules — **not** the contract |
| `src/app/**` via `lib/api/repository` | DISPLAY | bypasses `site-data.ts` |
| `src/app/**` via `src/lib/site-data.ts` | DISPLAY | the facade |
| `scripts/smoke-people-m33.ts` | REPOSITORY (local) | `localRepository()` |

### The current violations

**1. The seam is bypassed on both sides.**

`src/lib/site-data.ts` is the sanctioned frontend path, yet **4 `src/` files import
`lib/api/repository` directly**:

```text
src/app/institutions/[slug]/page.tsx:5     institutionLeadership, institutionBranches
src/app/people/[slug]/page.tsx:4           getPerson
src/app/interest-rates/page.tsx:6          allInterestRates
src/util/search.ts:1                        search
```

**2. `lib/` imports `src/`.** `lib/api/repository.ts:8-17` imports
`CrawlSource, Document, Institution, Job` from `@/types` and `@/data/*`. That is
DISPLAY → upward into the API layer, and PERSISTENCE-adjacent data read directly
by a lib module.

**3. `src/` deep-imports `lib/`.** Beyond the four above:

```text
src/util/roles.ts:1                 PersonDto          from lib/repository/types
src/util/search.ts:2                DocumentDto, InstitutionSummary, PersonDto
src/data/branches.ts:5              BranchAssertionRecord  from lib/repository/projection
src/data/people.ts:5                PersonAssertionRecord  from lib/repository/projection
src/app/ingestion/page.tsx:7        allPublishedPeople from lib/repository/static-people
```

**6 of these 7 import lines point at `lib/` files and are in `src/data/` or
`src/app/` — generated data and a page, not the sanctioned `src/lib/site-data.ts`
facade.** `src/util/` is a legitimate consumer location (`src/app` already imports
it); the two `src/util/` lines are not violations of the facade rule, they are
evidence that the util layer reaches past the contract for DTOs.

**4. R6 does not catch any of this.** R6 (P0.1) guards `@/data/*` imports from
pages; `scripts/check-discipline.cjs` passes at 0 violations while all four
patterns above exist. The boundary rule is documented but **unenforced**, and the
one enforcement point that does exist is silent about `lib/`.

**Frozen:** the sanctioned frontend path is `src/lib/site-data.ts`. A follow-on
rule (R7) should deep-import-ban `lib/` from `src/` and `@/` from `lib/`, and
require page reads through the facade. Tracked for P0.4 — a rule change is
engineering discipline, not a schema change, but it is out of P0.3's documentation
scope.

**5. `getRepository()` has no callers at all.** Verified across `lib/`, `src/`,
`worker/`, `scripts/`: zero. `withD1()` and `initLocal()` likewise. The documented
adapter-selection mechanism (`LK_DB` → mock/local/d1) is unexercised; the Worker
constructs `new D1InstitutionRepository(env.DB)` directly. See
`docs/architecture/REPOSITORY-CONTRACT.md` §2.

---

## 7. Projection types must not become domain models

The observed failure mode, all measured:

```text
lib/repository/types.ts:67      InstitutionSummary   ← DTO (authoritative)
lib/api/repository.ts:20        InstitutionSummary   ← duplicate
src/types/index.ts:1            Institution          ← display projection
src/data/institutions.ts        51 hand-written rows ← no generator
data/master/master.json         51 rows, 25 keys     ← build-master.cjs output
```

Four `Institution*` declarations plus two data sources. The generated TS is what
the pages render, which makes it **de facto** the domain model by accident — and
it is the one with no schema behind it, no generator, and a hand-written
`count: 51`.

**Frozen anti-pattern rules:**

1. A generated artifact is **never** authoritative, whatever the frontend reads.
2. A projection may not add factual fields with no persistence.
3. A projection may not encode invariants.
4. Projection types carry no `as_of`/`verified_at` semantics unless the
   underlying data has them.
5. When display and persistence disagree, **persistence is the debt holder** —
   either add the column or remove the field.
6. One concept has one domain vocabulary. Type names may vary by layer; the
   **vocabulary** may not (`DOMAIN-VOCABULARY.md`).
7. Any new type must name the layer it belongs to. Unlayered types are rejected.
8. A name reused for a different meaning is a defect, not a convenience —
   see `evidence` in §4.
9. A `lib/` module importing a `src/` type is a defect in the type system, not a
   convenience — see §6.

---

## 8. Reconciliation outcome for the 15 P0.2 mismatches

| # | Mismatch | Layer decision | Phase |
|---|---|---|---|
| 1 | `entity_type` mixed case | DOMAIN vocabulary frozen; alias map | P0.4 |
| 2 | `field_name` two casings | DOMAIN vocabulary frozen; alias map | P0.4 |
| 3 | Disjoint type worlds — **4 shapes**, not 2 | 3 layers + 1 API duplicate; display + API pairs to be renamed/consolidated | P1 |
| 4 | `aliases: string[]` loses type | DISPLAY must project `AliasDto[]` | P1 |
| 5 | `paidUpCapitalCrore` on entity | DOMAIN: identity fact, not a metric. **Gap recorded** | P4 / P0.5 |
| 6 | Province inferred from text | DERIVED; must be labelled inferred | P3 |
| 7 | `confidence` undefined | Needs a 0–1 rubric | P0.4 |
| 8 | 4 event tables | PRECEDENCE: `timeline_events` institution-scoped; `events` polymorphic superset; `regulatory_events` NRB-specific; `branch_history` branch-scoped | P0.3 doc, P8 impl |
| 9 | 3 temporal vocabularies | Mapping frozen in `TEMPORAL-VOCABULARY.md` | done |
| 10 | `jobsProvenance` mismatch | **RETRACTED** — false finding | closed |
| 11 | `ingestion_errors` empty | PERSISTENCE gap; `ingestion_runs.error_count` is not itemization | P0.5 |
| 12 | Coverage all `NOT_STARTED` (51/51) | Derived from assertions, human override preserved | P0.5 |
| 13 | Document × 5 representations | 3 layers: document record / financial doc view / projection | P0.3 doc, P5 impl |
| 14 | Duplicate `Job` interface | **Both are live** (API vs frontend); `src/data` shape is richer. Consolidate, don't just delete | P1 |
| 15 | No `Person` domain type | DISPLAY projection, not the DTO | P2 |
| **16** | **`lib/api/repository.ts` re-declares `InstitutionSummary`/`InstitutionDetail`** *(new in P0.3)* | API envelope must consume the DTOs; envelopes stay, duplicate types go | P1 |
| **17** | **`evidence` means per-field provenance in `src/types:17` and crawl counters in `lib/api/repository.ts:33-42`** *(new in P0.3)* | `evidence` reserved for provenance; rename the API field | P1 |
| **18** | **`getRepository()` has zero callers; R6 misses all four import paths** *(new in P0.3)* | Wire the factory or delete it; add R7 | P0.4 |

---

## 9. Dead and duplicated type surface — confirmed by grep

### Dead: zero consumers in `src/`, `lib/`, `worker/`, `scripts/`

```text
src/types/index.ts:23   Post
src/types/index.ts:46   Video
src/types/index.ts:117  ResearchItem
src/types/index.ts:127  ReportMetric      (referenced only by IndustryReport:140)
src/types/index.ts:134  IndustryReport
```

`ReportMetric` is reachable only from another dead type, so the dead set is
closed. None is re-exported by `src/lib/site-data.ts`.

### Live but duplicated under the same name

| Name | A | B | Both used by |
|---|---|---|---|
| `Job` | `src/types/index.ts:35` (9 fields) | `src/data/jobs.ts:18` (richer: `kind`, `sourceDocument`, `conflicts`, …) | A: `lib/api/repository.ts:73,101,278` · B: `src/lib/site-data.ts:50` |
| `InstitutionSummary` / `InstitutionDetail` | `lib/repository/types.ts:67,135` | `lib/api/repository.ts:20,49` | A: the frozen contract · B: the live HTTP envelope |
| `Document` | `src/types/index.ts:107` | `lib/repository/types.ts:199` `DocumentDto` | A: `lib/api/repository.ts:200` · B: the contract |
| `Institution` | `src/types/index.ts:1` | `lib/api/repository.ts:49` (`sourced_evidence: Institution["evidence"]`) | both, across the layer boundary |

`src/types/index.ts:36-46` carries a comment acknowledging the `Job` collision;
`src/lib/site-data.ts:45-49` does the same. Two comments, zero enforcement.

**Frozen:** the 5 dead types are deletable with `tsc` as the only required proof.
The duplicated live names are not deletions — each pair has a real consumer, so
consolidation is a P1 type change with build verification. Neither was executed in
P0.3 (documentation phase).

---

## 10. Verification for any type-layer change

```bash
npx tsc --noEmit                  # 0 errors — no consumer broken by a rename
npm run check:discipline          # R6 still green
npm run build                     # static export unchanged
node scripts/audit-export.cjs     # 335 pages / 13,783 links / 0 failures
npm run smoke                     # 79 passed
npm run smoke:worker              # DTO shape unchanged at the API boundary
```

**A type-layer change that requires no test beyond `tsc` is a rename.** Anything
that changes a JSON shape needs the full suite, because the Worker envelope and
the API contract are observable outputs.