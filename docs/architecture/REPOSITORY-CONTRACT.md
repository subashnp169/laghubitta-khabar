# REPOSITORY-CONTRACT — Phase P0.3 Freeze

**Status:** FROZEN (Phase P0.3). The read seam, its current state, and what is
missing.

`docs/architecture/READ-WRITE-BOUNDARY.md` froze the *boundary*.
`docs/data/TYPE-LAYERS.md` froze *type ownership*. This document freezes **the
contract itself**: what operations exist, what they guarantee, and what they
cannot express.

---

## 1. The seam

`lib/repository/contract.ts` — 57 lines, interface-only, **zero I/O**.

```ts
export interface InstitutionRepository {
  listInstitutions(opts):        Promise<Paged<InstitutionSummary>>
  getInstitutionBySlug(slug):    Promise<InstitutionDetail | null>
  getInstitutionById(id):        Promise<InstitutionDetail | null>
  listLeadership(institutionId): Promise<Paged<PersonDto>>
  listBranches(institutionId):   Promise<Paged<BranchDto>>
  listFinancials(institutionId): Promise<Paged<FinancialReportDto>>
  listDocuments(institutionId):  Promise<Paged<DocumentDto>>
  listJobs(institutionId):       Promise<Paged<JobDto>>
  getPersonBySlug(slug):         Promise<PersonDto | null>
  listNews(opts):                Promise<Paged<NewsItemDto>>
  search(query):                 Promise<SearchGroups>
  listInterestRates():           Promise<Paged<InterestRateDto>>
  resolveOutboundLink(k, slug):  Promise<OutboundLinkDto | null>
}
```

Plus `NotFoundError` and `ValidationError`. Every method returns `Paged<T>`, an
explicit `null`, or — for `search` only — a `SearchGroups` envelope. No method can
return a bare array, so a client never has to infer "no more data" from an empty
list.

This is the **whole** contract: 13 methods (`contract.ts:25-42`), all reads, all
institution-scoped or global. It is the correct design.

**One contract, three implementations — and P0.2's comparison still missed the
fourth data path.** `lib/api/repository.ts` builds the site's live read models
directly from `@/data/*`, and four `src/` modules import that instead of a
repository. The contract is not the only seam that exists; it is the only one that
is declared. See `docs/data/TYPE-LAYERS.md` §5.

---

## 2. Adapters, and who actually calls them

`lib/repository/index.ts` resolves by `LK_DB`:

| Value | Adapter | Backing store | Reads `data_conflicts`? | Reached by |
|---|---|---|---|---|
| unset / `mock` | `MockInstitutionRepository` | `data/master/master.json` | ❌ | **nothing** |
| `local` | `localRepository()` | `lk.db` via `better-sqlite3` | ❌ | `scripts/smoke-people-m33.ts` only |
| `d1` | `D1InstitutionRepository` | Cloudflare D1 binding | ✅ **only adapter that does** | `worker/src/index.ts:61` |

`better-sqlite3` is lazily imported so it never enters a Worker bundle. `LK_DB=d1`
without an injected binding **throws** rather than silently degrading.

### The measured consequence — the factory is dead code

Verified across `lib/`, `src/`, `worker/`, `scripts/`:

| Symbol | Callers |
|---|---|
| `getRepository()` | **0** |
| `withD1()` | **0** |
| `initLocal()` | **0** |
| `new D1InstitutionRepository(...)` | `worker/src/index.ts:61` |
| `localRepository()` | `scripts/smoke-people-m33.ts:502,538,561` |
| `new MockInstitutionRepository()` | `lib/repository/index.ts:54` — itself unreachable |

So the adapter-selection mechanism the contract documents is **never executed**.
The single production implementer is constructed directly by the Worker, and the
`mock` adapter — the documented default for builds and SSG — has no caller and no
test. `npm run smoke` (`scripts/smoke-api.ts`) exercises `lib/api/handler.ts`, not
the contract.

### And the static site never touches the contract at all

`lib/api/repository.ts:10-16` builds its read models from `@/data/institutions`,
`@/data/pilot`, `@/data/nrb`, `@/data/jobs`, `@/data/financials`,
`lib/repository/static-people`, `lib/repository/static-branches` — **not** from
`InstitutionRepository`. Four `src/` files import `lib/api/repository` directly.

**Frozen interpretation:** `InstitutionRepository` is a *correct and complete*
interface that currently has one production caller (the Worker, via direct
construction) and one test caller (the local adapter). It is not yet the seam the
docs describe. Making it one — wiring `getRepository()` through the Worker and
pointing `lib/api/repository.ts` at an adapter — is a P0.4/P1 contract change,
recorded here, not performed in P0.3.

`lib/repository/d1.ts:181` remains the only correct conflict read in the system:

```ts
SELECT entity_id, field_name FROM data_conflicts
 WHERE resolution_status='OPEN'
   AND entity_type='institution'
   AND field_name LIKE 'people_%'
```

Replayed directly it returns rows. It is reached only when the Worker happens to
hit that code path — `mock` and `local` cannot read that table at all, which is a
parity breach (§5), not an adapter detail.

---

## 3. What the contract guarantees

1. **Provider-agnostic shapes.** `InstitutionSummary` is identical whether served
   by `master.json`, SQLite, or D1.
2. **No D1 types leak.** `lib/repository/types.ts` contains no `D1Database`
   (verified: zero occurrences); the adapter type is imported by the factory only.
3. **Bounded pagination.** `page`/`limit` clamped; `Paged<T>` always returns
   `pagination` so a client can never infer "no more data" from an empty array.
4. **Explicit nullability.** `null` means *absent*, distinct from `""`.
5. **Errors are typed.** `NotFoundError` / `ValidationError`, not string checks.
6. **Multi-source attribution is mandatory.** `SourceMeta.sources: string[]`
   (types.ts:38) is a **required** field, not optional — and the code comment
   records why: "when the read model was dropping every source but the first, the
   loss was silent and no type flagged it". `source_url` is `string | null`
   (types.ts:51) so an unresolvable source reports "unknown provenance" rather
   than a plausible unverified link. Never fabricate a URL.
7. **Verification state travels with the record.** `verification_status` is on
   every `meta` (types.ts:53).

What is **not** a guarantee today: adapter parity (§5) is asserted in the docs and
holds only for the 13 existing methods as far as the D1 Worker path is concerned.
The contract is exercised by exactly one suite (`smoke:people-m33.ts`, local
adapter); the `mock` adapter has neither a caller nor a test.

---

## 4. What the contract cannot express

This is the important half.

| Missing | Consequence |
|---|---|
| **Conflicts** — no `listConflicts` / `resolveConflict` | 229 rows unreachable from any page. `resolveConflict` exists in `lib/ingestion/review.ts:362` but is not on the contract |
| **Coverage** | `CoverageDto` is *embedded* in `InstitutionDetail`, but there is no operation to list institutions *by* coverage — the operator's main question is unanswerable. All 51 rows are `NOT_STARTED` anyway |
| **History / as-of** | No operation returns an entity *at time T*. `valid_from` is NULL on 100% of assertions, so the answer would be wrong even if it existed |
| **Provenance for a single field** | `SourceMeta` is per *record*, not per field. The per-field `evidence` map lives only in generated TS, and 102 of its 255 entries carry no verification date |
| **Assertions** | No operation exposes `data_assertions`. The evidence layer is invisible to the read plane |
| **Sources** | No `listSources` / `getSource`. A reader cannot be shown "who says this and where" beyond one `source_url` |
| **Timeline / lineage** | `timeline_events` is embedded in `InstitutionDetail.timeline` but has no own operation; lineage (`predecessor_id`, `predecessor_name`) exists only in `master.json` and has **no schema column at all** |
| **Conflicts as a count** | No aggregate operation. `crawlSummary.conflictsOpen` is a **frontend-only** type (`src/types/index.ts:199`), so the contract is structurally incapable of carrying it |
| **Documents by category/period** | `listDocuments` is institution-scoped only |
| **Media / Activity / Centers** | No operations, no rows |

**Frozen interpretation:** the contract is a **publication** contract — 13
operations sufficient to render a static public site. It is not an internal
platform contract: it cannot serve an operator panel, a conflict queue, an audit
trail, or a time-travel query.

And one thing the contract does not cover but the product depends on: the live
read path bypasses it entirely (§2). That is the bigger gap.

That is why P0.4/P14 need contract additions. This is a **known, bounded gap**,
not a design error.

---

## 5. Adapter parity requirement

P0.3 measured a parity breach: one adapter reads `data_conflicts`, the other two
cannot. And `mock` — the documented default — has no caller and no test at all.

**Frozen rule:** every operation on `InstitutionRepository` must be implemented by
**all three adapters** with identical semantics for a given fixture. A single
adapter test (`smoke:people-m33.ts`, local) is the enforcement point today;
`smoke:worker.ts` covers the D1 envelope. Any new operation must land with a test
on **every** adapter before it is frozen.

A consequence worth stating: **`mock` is the documented default**, so the build
path is supposed to be `master.json`. That is correct and desirable (static export
with no DB) — and it is also currently fiction, because nothing calls
`getRepository()`. Anything production depends on must work through an adapter or
it does not work.

---

## 6. Frozen contract additions for P0.4

Documented, **not implemented in P0.3**.

```ts
// Operator/verification plane
listOpenConflicts(filter):        Promise<Paged<ConflictDto>>
getConflict(id):                  Promise<ConflictDto | null>
resolveConflict(id, resolution, note): Promise<void>
listInstitutionsByCoverage(dim, status): Promise<Paged<CoverageIndexDto>>

// Provenance plane
listAssertions(entityType, entityId): Promise<Paged<AssertionDto>>
getSource(id):                    Promise<SourceDto | null>
listSourceSnapshots(sourceId):    Promise<Paged<SnapshotDto>>

// Temporal plane
getInstitutionAt(slug, asOf):     Promise<InstitutionDetail | null>
```

Plus one structural fix, not an addition:

```ts
// lib/api/repository.ts must consume the DTOs, not re-declare them
import type { InstitutionSummary, InstitutionDetail } from "../repository/types";
```

Requirements for each:

| Requirement | Reason |
|---|---|
| `ConflictDto` **must** carry `value_a`, `value_b`, `source_a_id`, `source_b_id`, `detected_at` | The current 2-field projection is not actionable |
| `resolveConflict` requires a `note` | `resolution_note` exists; make it non-optional |
| All three adapters implement every operation | §5 parity rule |
| Contract operations, not direct table access | A UI may not read a table |
| `getInstitutionAt` is **blocked** on a valid-`valid_from` population strategy | 100% NULL `valid_from` would make it return a confident wrong answer |
| None may be exposed publicly in V1 | Operator plane is not a public API |

---

## 7. Frozen statements

1. The contract is the **only** sanctioned read seam. No consumer opens a
   database. *(Today: 4 `src/` files and `lib/api/repository.ts` bypass it. Recorded,
   not enforced — see §2.)*
2. The contract is **operation-based, not table-based**. A method may join any
   number of tables; it never leaks their shape.
3. Shapes are provider-agnostic and identical across adapters.
4. `SourceMeta.sources` is **mandatory**; `source_url` is honestly nullable.
5. `null` means absent. `""` means present-but-empty. Never interchange.
6. Every read returns `Paged<T>`, an explicit `null`, or the `SearchGroups`
   envelope. No bare arrays.
7. The contract is a **publication** contract today. Operator, provenance, and
   temporal planes are documented additions, not oversights.
8. Adapter parity is a contract requirement, verified by tests on every adapter.
9. Adding a contract operation is **not** an architecture change. Changing the
   boundary so a non-repository component can read storage **is**.
10. `LK_DB` must never be a production default. `mock` exists for builds — and
    until `getRepository()` is wired, `mock` is documentation, not behaviour.