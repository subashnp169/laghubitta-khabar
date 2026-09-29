# M3.4 — Phase 2: Branch Data Model Review

**Scope:** document the existing branch representation before adding
functionality. No schema change, no new column, no new table.
**Baseline:** `docs/PHASE-M3.4-BRANCH-BASELINE.md` (HEAD `0b680e4`).

---

## 1. In-code branch representation

### `BranchRow` — the parser's only internal record type

`lib/ingestion/structured.ts:29`

```ts
interface BranchRow { name: string; district: string | null; place: string | null; phone: string | null; }
```

Four fields. Three producers, all funneled through the extractor:

| Producer | Line | Shape |
| -------- | ---- | ----- |
| `parseBranchRows` | `structured.ts:146` | record table (or 2-column label/value rows) |
| `parseBranchBlocks` | `structured.ts:240` | M3.4 heading-delimited card grid |
| `parseBranchCells` | `structured.ts:278` | M3.4 `<br>`-delimited many-record cell |

Fallback precedence is explicit at `structured.ts:326-335`: the record table
runs first, and a fallback is adopted only if it yields at least one
`isAssertableBranchName` value, which the table path did not.

### Emitted evidence

`structured.ts:336-346` — the **only** four `BRANCH_*` fields the branch parser
emits today:

| field | confidence | reaches `data_assertions`? |
| ----- | ---------: | --------------------------- |
| `BRANCH_NAME` | 0.6 | **yes** (engine gate is `>= 0.5`) |
| `BRANCH_DISTRICT` | 0.45 | no — evidence-only |
| `BRANCH_PLACE` | 0.45 | no — evidence-only |
| `BRANCH_PHONE` | 0.45 | no — evidence-only |

The engine gate is `ev.confidence >= 0.5` (`lib/ingestion/engine.ts:409`).
So the 0.45 attributes are structurally incapable of becoming assertions, which
is the intended identity/volatile split recorded in the M3.3 header comment.

### Attributes named in the phase brief that are NOT yet extracted

`email`, `manager`, `mobile`, `map/location URL` are **not** captured anywhere
in the branch path. `BranchRow` has no field for them and the extractor emits no
such `BRANCH_*` field.

Per the standing instruction not to invent schema, these stay **unrepresentable
→ not asserted** until a generic extractor produces them. They must not be
fabricated and must not be back-filled from the raw snapshot by hand. Phase 14
reports them as `Extracted 0` honestly rather than omitting the row.

The underlying `branches` table *does* have `email`, `manager_person_id`,
`geo_lat/geo_lng`, `address`, `municipality`, `ward` columns — but see §4: that
table is not written by this path.

---

## 2. Persistence path

`lib/ingestion/engine.ts:403-428` (mirrored in `lib/ingestion/dataapi.ts`):

```
if (ev.kind === "FIELD" && ev.confidence >= 0.5) {
  key = `${field.toLowerCase()}|${text}`      // per-snapshot dedup
  saveAssertion({
    entityType: source.institutionId ? "institution" : "source",
    entityId:   source.institutionId ?? source.id,
    fieldName:  ev.field.toLowerCase(),       // -> "branch_name"
    value:      ev.text,
    sourceId, sourceSnapshotId, observedAt, confidence,
    verificationStatus: "UNVERIFIED",
  })
}
```

Provenance carried on every branch assertion:

| Attribute | Source |
| --------- | ------ |
| institution | `entityType="institution"`, `entityId=institutionId` |
| source | `source_id` |
| snapshot | `source_snapshot_id` |
| content hash | on the snapshot row (written before extraction, `engine.ts:310`) |
| observed time | `observed_at` |
| parser version | `parserId` on the evidence; **not** a column on `data_assertions` |
| extraction method | implied by `parserId` in evidence; not persisted on the assertion |
| validation result | `validation_results`, joined via snapshot |

### Two structural gaps in the assertion model

**Gap A — there is no branch entity.** A branch assertion is
`(entity_type='institution', entity_id=<institution>, field_name='branch_name',
value=<one branch name>)`. 212 chhimek names become 212 rows all attached to the
same institution. There is no `branch_id`, so:

- two branches cannot be linked to each other,
- a branch's district/phone cannot be attached to *that branch* in the ledger,
- `branches.branch_name` (the real projection table) is never populated,
- `branch_history` (`OPENED/CLOSED/RELOCATED/RENAMED/TYPE_CHANGED`) has no
  writer at all.

**Gap B — no cross-snapshot semantic dedup.** The dedup key is computed *within
one snapshot's* evidence list. A new snapshot containing the same 24 branches
re-asserts all 24. Idempotency today comes only from the content-hash
short-circuit at `engine.ts:288-305`: same canonical hash → `UNCHANGED`, no
snapshot, no extraction, no re-assertion. Any real page edit therefore
re-asserts the entire directory. This is the Phase 11 work item, and it is
shared with People — the M3.3 pattern must be reused rather than reinvented.

---

## 3. Validation

`directoryValidatorFor(BRANCH_DIRECTORY_RULE_ID, "BRANCH_NAME")` →
`r-branch-directory`, `severity: "warning"`, shared with vacancy and financial
metadata.

| Condition | Status | Effect |
| --------- | ------ | ------ |
| any value > 160 chars | `FAIL` | junk value |
| 0 `BRANCH_NAME*` rows | `PENDING` (info) | "no branch_name evidence" |
| ≥3 rows and top value ≥3 and ≥50% of rows | `PENDING` (warning) | repeated heading, not distinct records |
| otherwise | `PASS` with `evidence.attrs` | structured detail for review |

Two notes:

- The validator filters on `field.startsWith("BRANCH_NAME")`, so it inspects
  only the name column. It cannot see `BRANCH_DISTRICT`/`BRANCH_PLACE`/
  `BRANCH_PHONE` at all.
- With **zero** surviving names the validator returns `{ count: 0 }` and **no
  `attrs` key**. B6 had to assert against the extractor directly for this
  reason. Any later tooling must not assume `evidence.attrs` exists.

Severity is `warning`, so a `FAIL` does not by itself block the assertion write
path; the assertion gate is purely the confidence threshold.

---

## 4. Classification of branch values

### Assertable facts (may become `data_assertions` rows)

| Value | Why |
| ----- | --- |
| Branch name with distinguishing information | identity of the location; 0.6 → asserts |
| District | **no** — 0.45, volatile, stays evidence |

Only the branch name currently asserts. District/place/phone are deliberately
below the 0.5 gate.

### Evidence-only attributes (recorded, never asserted)

`BRANCH_DISTRICT` (0.45), `BRANCH_PLACE` (0.45), `BRANCH_PHONE` (0.45) — the
"volatile" class: a branch can be relocated or renumbered, so the value is
useful for review but not a durable fact.

The whole structured detail also lands in
`validation_results.evidence_json` as `attrs`, which is the review surface.

### Derived values

| Value | Derivation |
| ----- | ---------- |
| `district` | `DISTRICT_WORDS` match against place/name text (generic vocabulary) |
| `place` | best cell in a heading-card block, or the second `<br>` line |
| `phone` | first `PHONE_SEARCH_RE` match in the block's text |
| `name` (br-cell) | office-type line + place line, composed |
| `name` quality | `isAssertableBranchName` gate |

All derived, all deterministic, none persisted as new columns.

### Unsafe to assert

| Value | Reason |
| ----- | ------ |
| Bare `Branch Office` / `Branch` / `Regional Office` / `Head Office` / `Corporate Office` | no distinguishing information |
| Bare district (`Jhapa`, `Morang`) | district-only, asserted as a "branch" by the pre-gate parser |
| Province-only | no location identity |
| Repeated column header (`Branch Manager`) | heading read as data |
| `Contact Us`, `Office Hours`, `Location` | navigation/section labels |
| Department names, menu/footer/nav text, notices, press titles | not branch records |
| Job titles | person attribute, not a place |
| Phone-only / email-only cells | a contact value, not a name |
| `Total No. of Branch offices: 24` | aggregate statistic, not a record |

`isAssertableBranchName` currently enforces the name class of this table. The
attribute class is enforced only structurally, by confidence: a bad phone stays
at 0.45 and never asserts, which satisfies "a bad phone number must remain
rejected while the branch-name assertion survives" — but by construction rather
than by validation. Phase 15 makes that explicit.

---

## 5. Audit trail

`appendAudit` calls in `engine.ts` give the branch path:

`INGESTION_STARTED` → `FETCH_STARTED` → `FETCH_COMPLETED` (contentHash, status,
mime) → `INGESTION_ITEM_UNCHANGED` **or** snapshot write → `EXTRACTION_COMPLETED`
(evidenceCount) → `VALIDATION_*` → `INGESTION_COMPLETED`.

A `branch_name` assertion is therefore answerable months later by walking
`data_assertions.source_snapshot_id → source_snapshots.content_hash →
ingestion_sources`, plus the audit log for why a run produced nothing.
`audit_logs` currently has 0 rows in the M3.4 DBs, which is expected: nothing
has been ingested through the engine in M3.4.

---

## 6. Consequences for the remaining phases

1. **No schema change is needed or permitted.** Every gap above is solvable in
   extraction/validator/review code, or must be left unasserted.
2. **P3** must extend the gate to attributes without inventing columns:
   `isAssertableBranchAttribute` governs evidence quality, not new fields.
3. **P10** must treat the *institution-level* assertion shape as the model, and
   must not pretend a branch entity exists.
4. **P11** must add cross-snapshot semantic dedup at the branch-claim level,
   reusing the M3.3 pattern, while keeping a genuine rename visible.
5. **P12** conflicts must be recorded against the same
   `(entity_type, entity_id, field_name)` triple that assertions use.
6. **P13** provenance must resolve `assertion → snapshot → source → institution`
   using `source_id` + `source_snapshot_id` + `entity_id`, since no `branch_id`
   exists.
7. **P19/P20** must not read D1 from a page and must not require a populated
   `branches` table — the read model has to be built from `data_assertions`
   evidence, or explicitly left for a later phase.
