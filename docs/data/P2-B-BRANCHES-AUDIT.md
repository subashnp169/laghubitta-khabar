# P2-B — Canonical Branches Audit

> Scope: make branches first-class at the read model and publish them from the
> durable evidence store, under the frozen schema, without fabricating geography.
> Assertion-only for the normalized `branches` table (see §4).
>
> Status: **P2-B = CLOSED**
> Owner: data layer. Evidence source: `data/durable/store.db`.
> Task id: P2-B (Branch). Roadmap phase: **B — people + branches** ([docs/ROADMAP.md:46-51](../ROADMAP.md)).

---

## 1. What P2-B did

| Artefact | Change |
| --- | --- |
| `scripts/build-branches-module.ts` | **NEW** canonical branch builder: durable store → `src/data/branches.ts`, no lk.db seed |
| `scripts/smoke-branches-p2b.ts` | **NEW** acceptance tests (33 ok / 0 fail) |
| `lib/ingestion/structured.ts` | **+`isAssertableBranchNameValue()`**: the single value gate for a `branch_name` already carried in evidence (composes the existing `declaredColumnNameLike` + `isBareDistrictName`; no second model) |
| `src/data/branches.ts` | **REGENERATED** from the durable store (was a stale single-pilot-DB export) |
| `lib/api/handler.ts` | `GET /api/institutions/:slug/branches` now serves `institutionBranches` instead of an empty-phase stub |
| `lib/repository/d1.ts` | `listBranches()` implemented over a new `branchEvidence()` reader (worker/D1 path), re-keying to branch identity |
| `scripts/smoke-api.ts` | branch route expectation updated from "empty until Phase B" to first-class collection + honest empty |
| `package.json` | `build:branches`, `smoke:branches-p2b`; `durable:build` chained to run `build:branches` after `build:people` |
| `schema/schema.sql` | **UNCHANGED** |

**Why a builder was needed.** The only writer of `src/data/branches.ts` was
`scripts/pilot-export-branches.ts`, which read **one** pilot run DB (1,331 rows)
and was **not** in the `durable:build` chain, so the committed module drifted from
the 2,930-row durable evidence. It also applied **no plausibility gate**: the
durable store carries raw pre-gate rows such as `Branch Manager` (×32),
`Regional Office` (×10), `Number of Regional Office`, `Head Office`, and bare
district names (`Morang` ×14). Publishing those as branches is exactly the
column-mix-up P2-B must prevent.

---

## 2. Coverage

| Stage | Rows | Note |
| --- | --- | --- |
| Raw `branch%` assertions, `entity_type='institution'` | **2,930** | 19 pilot stub entities, 20 distinct sources |
| Rejected as not-a-branch-name (`isAssertableBranchNameValue`) | **97** | held in evidence, not published |
| Unresolvable institution identity | **0** | every one of the 19 sources resolves to a registry `mfi-*` |
| Not individually addressable | **0** | — |
| Retired/superseded | **0** | — |
| Promoted (pre-dedup) | **2,833** | |
| **Published (deduped per source-claim)** | **1,898** | distinct branches = 1,898 |
| Institutions covered | **19** | |

Drop composition (kept in evidence, never published): `Branch Manager` 32,
`Regional Office` 10, bare districts (`Morang` 14, `Kailali` 9, `Sarlahi` 7,
`Jhapa` 4, `Parsa` 4, `Rupandehi` 4, `Palpa` 2, `Kathmandu` 2, `Surkhet` 2),
`Branch Branch Manager` 2, `Number of Regional Office` 1, `Number of Branch
Office` 1, plus other bare place tokens not carrying branch vocabulary. These are
repeated headings or a district column read as the name column — not branches.

Published branches per institution: `mfi-047`=209, `mfi-003`=203, `mfi-025`=189,
`mfi-001`=168, `mfi-036`=154, `mfi-020`=149, `mfi-031`=140, `mfi-017`=139,
`mfi-030`=134, `mfi-034`=102, `mfi-028`=89, `mfi-019`=64, `mfi-042`=58,
`mfi-011`=39, `mfi-049`=21, `mfi-040`=15, `mfi-029`=12, `mfi-005`=11, `mfi-022`=2.

---

## 3. Provenance and identity

`BranchDto` carries `meta.source`, `meta.sources`, `meta.source_url`,
`meta.last_verified_at`, `meta.verification_status`.

Identity is the load-bearing fix. The store's branch rows are
**institution-scoped** (`entity_id = mfi-0NN`), which collapses every branch of
an institution onto **one** record in the projection. The builder re-keys each
row with `branchIdentityKey(institutionId, name)` = `<inst>|<normalized name>|-`,
so one branch = one `(institution, name)` — exactly the `UNIQUE (institution_id,
branch_name)` contract in `schema/schema.sql`. Provenance:

- Institution identity is resolved from the **source** (`source_id` →
  `data/pilot/pilot-sources.json` publisher → `src/data/institutions.ts`), never
  from the pilot `mfi-0NN` `entity_id` (the pilot and the registry both number
  from 1 and disagree on rows — see P2-A §3).
- `institution_id`/`institution_slug` are canonical registry identities.
- `source_url` is the source's registered page when known, else `null` — never a
  bare path, never invented.
- The D1/worker reader (`branchEvidence`) applies the **same** re-key, so the
  static module and the worker cannot disagree about a branch's identity.

---

## 4. Geography and history — deliberately none

The `branches` table declares `province TEXT NOT NULL` and `district TEXT NOT
NULL`. The evidence states **neither** for any MFI branch: the store contains
only `branch_name` for the 19 institutions (the sole `district`/`address`/
`open_date` rows belong to `entity_type='BRANCH'` external samples for
`bank-nepal-bank`, which is not an MFI and does not resolve to the registry).

Publishing a normalized `branches` row therefore **requires fabricating
geography**, which the frozen rules forbid (schema change unavoidable → STOP and
report; never fabricate). P2-B therefore:

- publishes the branch layer **from evidence only** (`src/data/branches.ts`), and
- **does not seed** `lk.db.branches` / `lk.db.branch_history` — both stay at
  **0 rows**, asserted by `PB-9`.

No `opened_at`, `ended_at`, `branch_history`, `manager_person_id`,
`branch_type`, or `status` is invented. Geography that is not in evidence stays
`""` in the read model (asserted by `PB-7`), so a consumer cannot mistake "not
published" for a fabricated value.

This matches `docs/data/CANONICAL-MODEL.md` §11: presence in `src/data` does not
make a branch canonical; an `UNVERIFIED` assertion is a lead for verification.

---

## 5. Conflicts

- **Open cross-source branch conflicts: 0.** `data_conflicts` holds only the
  already-known same-source `people_ceo` rows.
- Same-source rows that normalize to the same branch identity are duplicate
  observations, collapsed by `(entity_id, field_name, value, source_id)` keeping
  the latest `observed_at`; they are **not** a conflict.
- Only a genuine cross-source disagreement (`source_a_id <> source_b_id`) is
  emitted to `openBranchConflicts`; the read model then degrades that branch to
  `CONFLICT`. Nothing is resolved, merged, or deleted.

---

## 6. Impact

| Metric | Before (committed module) | After (P2-B) |
| --- | --- | --- |
| `src/data/branches.ts` rows | 1,331 (from 1 pilot DB, ungated) | 1,898 (durable store, gated) |
| Distinct published branches | 1,331 | 1,898 |
| Institutions with published branches | 13 | 19 |
| `GET /api/institutions/:slug/branches` | empty-phase stub (`data: []`) | real collection, institution-scoped + paginated |
| Institution page branch panel | names from stale module | names from canonical module (unchanged component) |
| Worker/D1 `listBranches` | hardcoded empty stub | `branchEvidence` projection (empty until D1 carries branch evidence) |
| `lk.db` branches / branch_history | 0 / 0 | 0 / 0 (deliberate, §4) |
| Schema | — | unchanged |

No source, assertion or conflict row was deleted or rewritten (the durable store
is opened read-only).

---

## 7. Verification

All commands run from the repo root on Windows/PowerShell.

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm run check:discipline` | OK — no violations |
| `npm run identity:verify` | OK — fingerprint intact |
| `npm run durable:build` | OK — ends with `build:branches` (1,898 branches) |
| `npm run build` | compiled successfully (Next static export, 395 pages) |
| `node scripts/audit-export.cjs` | pages 395, links 16,018, anchors 1,523, **failures 0** |
| `npm run smoke` | 83 passed / 0 failed |
| `npm run smoke:worker` | all checks passed |
| `npm run smoke:worker-security` | all checks passed |
| `npm run smoke:people-lifecycle` | 64 passed / 0 failed |
| `npm run smoke:ingest-security` | all security tests passed |
| `npm run smoke:people-p2a` | PASSED (P2-A stays green) |
| `npm run smoke:branches-p2b` | **33 passed / 0 failed** |

`smoke:branches-p2b` asserts: non-empty + unique id/slug; canonical entity shape
`<inst>|<name>|-`; identity is institution-scoped (same name at two institutions
≠ merged); headings/generic sections/bare districts are not published and the
gate rejects them while accepting `Waling Branch` and `Sijuwa, Morang`; every
branch maps to a canonical institution id and its slug is prefixed by the
institution slug; provenance present + `source_url` absolute-or-null;
same-source repeats are not a conflict while an OPEN cross-source key degrades to
`CONFLICT`; no fabricated district; deterministic projection; and `lk.db`
branches/branch_history remain 0 rows.

---

## 8. Blockers carried forward

- **Normalized `branches` table cannot be seeded** without province + district,
  which no MFI branch evidence states. This is a schema/evidence mismatch, not a
  bug: the fix is a source that publishes branch geography, or an explicit
  decision to make geography nullable. Recorded here; not forced.
- **D1 has no branch evidence yet.** `listBranches()` is now a correct
  projection, but returns empty until D1 `data_assertions` carries branch rows
  (a deployment/seeding concern, out of scope for offline P2-B).
- **Doc drift:** prior docs quote "1,331 branches across 13 institutions"
  (`LIVE-DATA-ISSUES.md`, `PHASE-M3.4-*`). Current canonical figures are 1,898 /
  19. Not rewritten here to preserve historical records; noted as drift.
- **P2-C (Financial) is CLOSED** — see
  [`docs/data/P2-C-FINANCIAL-AUDIT.md`](P2-C-FINANCIAL-AUDIT.md).
- **P2-D (Documents + Jobs) is CLOSED** — see
  [`docs/data/P2-D-DOCUMENTS-JOBS-AUDIT.md`](P2-D-DOCUMENTS-JOBS-AUDIT.md).

---

## 9. Verdict

**P2-B = CLOSED.** Branches are first-class at the read model: 1,898 branches
across 19 institutions published from the durable evidence store, identity
re-keyed so a branch is never collapsed into an institution, a single reused
plausibility gate holding 97 heading/district rows in evidence, full provenance,
no fabricated geography, and no schema or production change. The normalized
`branches` table is intentionally left empty because the evidence cannot satisfy
its NOT NULL geography without fabrication — the one architectural constraint
P2-B surfaces rather than violates.