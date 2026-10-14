# STORAGE-ADAPTER-STRATEGY — Phase P0.1 Freeze

**Status:** FROZEN (Phase P0.1)

Directive §8: do **not** prematurely declare the current `lk.db` the permanent
production canonical database. Define the logical model, then the contract, then
the adapter.

---

## 1. The three layers

```
CANONICAL LOGICAL MODEL      storage-independent. What a fact means.
        ↓
REPOSITORY CONTRACT         lib/repository/contract.ts. Which operations exist.
        ↓
STORAGE ADAPTER             SQLite now, D1 now, future adapter later.
```

The domain model never learns it is stored anywhere. The contract is the seam.

---

## 2. Adapters available today

`lib/repository/index.ts` resolves by `LK_DB`:

| `LK_DB` | Adapter | Backing store | Use |
|---|---|---|---|
| unset / `mock` | `MockInstitutionRepository` | `data/master/master.json` in memory | dev, build, SSG |
| `local` | `localRepository()` | `lk.db` via `better-sqlite3` | local tooling, smoke tests |
| `d1` | `D1InstitutionRepository` | Cloudflare D1 binding | staging, production |

`local` is lazy-imported on purpose: `better-sqlite3` is a dev-only dependency and
must never enter a Worker bundle.

**Frozen:** this factory is the only way to obtain a repository. `withD1(binding)`
is how a Worker injects its binding. `LK_DB=d1` without injection throws rather
than silently degrading.

---

## 3. The storage decision that is NOT yet made

The directive explicitly declines to pick a permanent production store. What is
actually known, measured:

| Store | Size | Contents |
|---|---|---|
| `lk.db` | 1 MB | 51 institutions, 120 aliases, 62 timeline events, 51 coverage, 51 official links, 51 outbound links, 21 sources, 10 ingestion sources, 8 field policies. **44 of 53 tables empty**, including `data_assertions`, `source_snapshots`, `data_conflicts`, `validation_results`, `branches`, `people`, `financial_metrics`, `interest_rates`, `jobs`, `users`, `roles`. |
| `data/pilot/evidence/*.db` | ~18 MB, 13 files | The real extracted evidence: ~**5,083 `data_assertions`, 1,458 `source_snapshots`** (P0.2 measured). Branch 1,773 · base 2,482 · people 629 · financials 153 · careers 38. |
| `data/master/master.json` | 139 KB | 51 institutions, 120 aliases, 51 official links, 62 timeline, 11 sources, `source_id: nrb-bfi-mid-may-2026`, observed 2026-06-20. This is what `seed.cjs` loads into `lk.db`. |

**The critical structural gap:** every ingestion run writes a **new dated
database**. Evidence therefore accumulates as parallel snapshots, not as one
evolving history. `lk.db` holds the universe but zero assertions.

This is P0.5. It is the highest-value structural decision outstanding, and it is
deliberately not pre-empted here.

---

## 4. Decision criteria for the durable store

| Criterion | Favours |
|---|---|
| One operator, low cost (§57, §58) | SQLite locally; D1 only if a runtime is genuinely needed |
| Append-only evidence with run identity (§14) | Both — needs the *model*, not a specific engine |
| Portability (§8) | SQLite first; D1 is Cloudflare-coupled |
| Availability for third-party API | D1 |
| Backup simplicity (§44) | SQLite file copy; D1 needs export tooling |
| Row-billing awareness | D1 Free tier caps reads (5M/day); SQLite has no such limit |

**Neither choice changes the repository contract.** That is the point of the
adapter seam. The decision is reversible; the model is not.

---

## 5. Interim position (in force now)

Frozen for P0–P2:

- `src/data/*.ts` is the **transitional build/read artifact** for the public site
  (directive §7). Do not delete it. Do not treat it as conceptual source of truth.
- `src/lib/site-data.ts` remains the sanctioned seam during migration.
- `data/master/master.json` remains the seeded universe of record.
- `lk.db` remains a local, gitignored development store. Never committed (R4).
- Production D1 ids never appear in the repo (R2); env configs are gitignored
  templates.

**Frozen:** `migrations/0001..0007` and `schema/schema.sql` do not change without
approval. P0.5 tooling must **import** existing evidence, never rewrite history.

---

## 6. Migration path

```
NOW     SQLite (local)  +  D1 (staging/prod)  +  generated TS read layer
        evidence in dated pilot DBs                    ← the gap

P0.5    one durable store, append-only runs,
        pilot DBs imported as historical runs

LATER   add adapters only if a measured limit demands it
        (search engine, cache, object storage for media)
```

No migration is planned that would require rewriting ingestion code. Adapters are
selected by `LK_DB`; the engine is unchanged.

---

## 7. Verification

```bash
npm run seed            # rebuild local lk.db from master.json
npm run smoke           # contract against mock + local adapters
npm run smoke:worker    # contract against a local D1 shim
```

If an adapter change breaks these, the change is wrong.