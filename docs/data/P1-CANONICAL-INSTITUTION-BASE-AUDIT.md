# P1 — Canonical Institution Base Audit (P1-E)

Status: **P1 = CLOSED**
Audit date: 2026-10-06
Scope: validation and closure of P1 (canonical institution base). This document is
read-only evidence. No schema, or domain-model change was made during P1-E. Two
production/tooling fixes (B1, W1) were applied after this audit first flagged them,
with approval; see §6 and §8.

---

## 1. Verification suite (exact commands, exact results)

| # | Command | Result | Notes |
|---|---------|--------|-------|
| 1 | `npx tsc --noEmit` | PASS (exit 0) | clean |
| 2 | `npm run check:discipline` | PASS (exit 0) | "no discipline violations in committed source" |
| 3 | `npm run identity:verify` | PASS (exit 0) | fingerprint matches, 62 predecessors closed, slug routing complete |
| 4 | `npm run build` | PASS (exit 0) | static export produced |
| 5 | `node scripts/audit-export.cjs` | PASS (exit 0) | **351 pages / 14,434 links / 1,479 anchors / 0 failures** (was 64 failures — see B1) |
| 6 | `npm run smoke` | PASS (exit 0) | `smoke:api: 79 passed, 0 failed` |
| 7 | `npm run smoke:worker` | PASS (exit 0) | all checks passed |
| 8 | `npm run smoke:worker-security` | PASS (exit 0) | all checks passed |
| 9 | `npm run smoke:people-lifecycle` | PASS (exit 0) | `64 passed, 0 failed` |
| 10 | `npm run smoke:ingest-security` | PASS (exit 0) | `50 ok / 0 fail` |

Documented baseline for `audit-export` is **335 pages / 13,783 links / 1,463 anchors / 0 failures**
(`docs/architecture/WORKMAP.md`, `docs/architecture/ASSET-DECISION-MATRIX.md`,
`docs/internal/ARCHITECTURE-AUDIT.md`). The current run is **+16 pages** (the 16 canonical
slug redirects) with **0 failures**. The baseline page/link counts in those three docs are
now stale and should be refreshed (doc-drift only; not a P1 blocker).

---

## 2. P1 workstream status

| Workstream | Deliverable | Status |
|-----------|-------------|--------|
| P1-A | `data/master/canonical-slug-aliases.json` (+ `.sql`) — 16 old→new slug routes | PASS |
| P1-B | `data/master/canonical-former-aliases.json` — 62 FORMER aliases | PASS |
| P1-C | `docs/data/TIMELINE-PROVENANCE.md` — `occurred_at` stays NULL | PASS |
| P1-D | `scripts/verify-master-integrity.ts` §6 closure + 6b coverage | PASS |
| P1-F | Backfill lineage into a runtime store | PASS (W1 resolved; seeded into `lk.db` and the durable store) |
| P1-E | This audit | PASS (B1 resolved; `audit-export` 0 failures) |

---

## 3. Coverage (measured)

| Invariant | Measured | Verdict |
|-----------|----------|---------|
| Canonical institutions | 51 / 51 | PASS |
| Institution ids unique | 51 / 51 | PASS |
| Institution slugs unique | 51 / 51 | PASS |
| `source_id` present on institutions | 51 / 51 | PASS |
| Slug redirects (old→new) | 16 / 16 | PASS |
| FORMER aliases | 62 / 62 predecessors covered | PASS |
| Official links (`master.json`) | 51 / 51 (VERIFIED 4 / CANDIDATE 47) | PASS |
| Timeline events (`master.json`) | 62 (all `occurred_at` NULL) | PASS |
| Published module aliases | 169 entries across 51 institutions | PASS |
| Null paid-up capital (published) | 16 (`mfi-036`..`mfi-051`) | PASS |

---

## 4. Identity record (historical disputes preserved)

`data/master/disputed-identities.json` (28,627 bytes):

- `ids_compared` 51, `identity_agreements` 51, `identity_conflicts` **0**, `unresolved` 0
- `applied_corrections` 16, `applied_evidence_supports_master` 16
- `non_identity_field_drift` 2
- `merge_predecessor_names_unreachable_by_alias` 0, `merge_predecessor_names_closed_by_canonical_former` 62

The 16 corrected institutions (`mfi-036`..`mfi-051`) are recorded as
*historical disputes*: the previously published (wrong) identity is preserved in the
register, the corrected canonical identity is what the site serves, the old slug is
routed via `canonical-slug-aliases.json`, and the absorbed predecessor names are
carried as canonical FORMER aliases. Evidence rows were not rewritten.

Non-identity drift (recorded, not auto-resolved):
- `mfi-034` operationDate: published `1900-01-09` vs master `null`
- `mfi-035` workingArea: published `National Level` vs master `Province Level (Lumbini Province)`

### Capital handling (no fabricated figure)

- `paidUpCapitalCrore` is typed `number | null` in `src/types/index.ts` and
  `paid_up_capital_crore: number | null` in `lib/api/repository.ts`.
- The 16 corrected institutions are `null`; no generator reconstructs them.
- Rendering is null-safe: `formatCrore(x) ?? "-"` (`src/app/page.tsx:186`,
  `InstitutionDirectory.tsx:326`); the homepage capital ranking filters
  `typeof === "number" && > 0` (`src/app/page.tsx:28`).
- The 16 figures are unrecoverable offline (nrb-kfi); a future network refresh is required.

---

## 5. Evidence store (durable) — measured

`data/durable/store.db` (7,704,576 bytes), rebuilt from the 13 immutable evidence DBs:

| Table | Rows |
|-------|------|
| `ingestion_runs` | 264 |
| `source_snapshots` | 1,458 |
| `ingestion_items` | 1,491 |
| `data_assertions` | 5,083 |
| `data_conflicts` | 229 |
| `audit_logs` | 6,767 |
| `validation_results` | 3,970 |
| `ingestion_errors` | 78 |
| `sources` | 57 (56 evidence + 1 registered NRB master source) |
| `ingestion_sources` | 51 (51 distinct ids) |
| `institutions` | 51 (51 distinct ids/slugs) |
| `institution_aliases` | 62 (canonical FORMER aliases, W1) |
| `slug_aliases` | 16 (canonical slug redirects, W1) |

Assertions by `entity_type`: `institution` 4,884, `FINANCIAL` 153, `VACANCY` 38, `BRANCH` 8.
VACANCY `verification_status`: `UNVERIFIED` 38. Conflicts all `entity_type='institution'` (229).
`PRAGMA foreign_key_check`: 0 violations.

The durable `institutions` reference copy stores `slug = id` (it exists only as an FK target
for the evidence spine), so `slug_aliases.moved_to` records the canonical mapping but is not a
resolvable join *inside the evidence store*; the canonical store that resolves superseded slugs
is `lk.db` (§6 W1).

Build determinism: `npm run durable:build` (which now ends with the lineage backfill) is
**byte-identical** across consecutive runs — SHA-256
`A6D4D059B48BA4B82423AEDDEAEEFC0E5B75257AFE6AC02CFA35945C18D8AFBF`. The backfill uses a
fixed seed timestamp, not `now()`, so determinism is preserved.
Freshness guard `assertStoreFresh()` fires (exit 1) when an evidence DB is newer than the store.

The 13 evidence DBs (immutable, SHA-256 prefix):

| DB | Bytes | SHA-256 (16) |
|----|-------|--------------|
| `m34-external-sample-2026-09-27.db` | 917,504 | `1ff18fbc48fa33c1` |
| `phase-o-2026-09-26-base-51-source.db` | 5,107,712 | `13bd9574961b5dee` |
| `pilot-branch-shapes-2026-09-27.db` | 937,984 | `d49631ea931f6725` |
| `pilot-branch-url-discovery-2026-09-27.db` | 65,536 | `1a70ac49881ed8a3` |
| `pilot-branches-ext-2026-10-01.db` | 1,998,848 | `b0b622a5182f1254` |
| `pilot-careers-2026-09-29.db` | 942,080 | `b14d7703737dd8ad` |
| `pilot-careers-ext-2026-10-01.db` | 1,114,112 | `82accf570865d753` |
| `pilot-financials-ext-2026-10-01.db` | 1,548,288 | `0732cdde9e4a12af` |
| `pilot-people-2026-09-26-pre-ext-a-rejected.db` | 1,073,152 | `3581c1722b32ae57` |
| `pilot-people-2026-09-27-ext-b-seed-first.db` | 1,470,464 | `638a61b55b5f1db2` |
| `pilot-people-2026-09-27-ext-c-pass1.db` | 1,323,008 | `8185be0f5e01122c` |
| `pilot-people-2026-09-27-post-ext-a.db` | 1,048,576 | `010191c191901176` |
| `pilot-people-ext-c-pass2.db` | 1,249,280 | `8bf32198c0613d41` |

`master.json` integrity: LF-normalized SHA-256
`db004145489066131cd18b65312d9038a0460efd5e3156121278b463ed253a33` matches
`data/master/master.sha256`. Contents: 51 institutions, 120 aliases, 51 officialLinks,
62 timeline events, 11 sources.

---

## 6. Issues found and resolved

### B1 — `audit-export` failed on the 16 slug-redirect stubs (RESOLVED)

- `node scripts/audit-export.cjs` exited 1 with **64 findings** = 16 pages × 4 rules
  (`single-h1`, `main-landmark`, `skip-link`, `html-lang`).
- The 16 pages are the superseded slugs P1-A added to `generateStaticParams()`
  (`src/app/institutions/[slug]/page.tsx:67-74`), emitted by the static export as
  `<html id="__next_error__">` shells with an RSC `NEXT_REDIRECT` payload and no
  `<main>`, `<h1>`, `lang`, or skip link.
- Root cause: `permanentRedirect()` in a statically exported Server Component cannot
  become a true HTTP 301; the export carried only a client redirect on an error shell.
- **Fix:** replaced `permanentRedirect()` with `src/components/institutions/MovedInstitution.tsx`,
  an accessible "This page has moved" page (client `router.replace`, single `<h1>`,
  `<main>`/skip link/`lang` from the root layout, visible link fallback). `generateMetadata`
  now points `canonical` and `og:url` at the target slug. Redirect behaviour is unchanged;
  `audit-export` is back to **0 failures**.

### W1 — Canonical lineage was not persisted in any runtime store (RESOLVED)

- The 16 slug aliases and 62 FORMER aliases existed only in
  `data/master/canonical-slug-aliases.json`, `data/master/canonical-former-aliases.json`,
  and (slug aliases only) the published module `src/data/institutions.ts`.
- `lk.db`: `slug_aliases` 0, FORMER absent (`seed.cjs` read only `master.json`).
- `data/durable/store.db`: `slug_aliases` 0, `institution_aliases` 0; the P1-F backfill
  was wiped by every `durable:build` and FK-failed because `nrb-bfi-mid-may-2026` was not
  registered in the store's `sources`.
- **Fix:**
  - `scripts/seed.cjs` now reads both canonical JSON files and seeds `slug_aliases` (16)
    and FORMER `institution_aliases` (62) into `lk.db`, with orphan + live-target
    integrity checks. Result: `institution_aliases` 182 (120 NAME_ALT + 62 FORMER),
    `slug_aliases` 16, 0 orphans.
  - `scripts/backfill-canonical-lineage.ts` registers the referenced NRB master source
    under `PRAGMA foreign_keys = ON` (no FK disabling) and uses deterministic ids and a
    fixed seed timestamp. It is now the final step of `npm run durable:build`.
    Result: durable store `institution_aliases` 62, `slug_aliases` 16, `sources` 57.
  - `scripts/verify-master-integrity.ts` note corrected to name both stores accurately.

---

## 7. What changed vs. what did not

- **NO SCHEMA CHANGES** — `schema/schema.sql` untouched.
- **NO EVIDENCE REWRITTEN** — the 13 evidence DBs are immutable (hashes above).
- **NO FABRICATED DATA** — `occurred_at` stays NULL; null capital stays null.
- **NO DOMAIN-MODEL CHANGE** — the only production edit is B1's accessible redirect page;
  the rest are local tooling (`seed.cjs`, `backfill-canonical-lineage.ts`,
  `verify-master-integrity.ts`) and one npm script chain.

---

## 8. Verdict

**P1 = CLOSED.** All ten verification commands pass, including `audit-export` at
351 pages / 14,434 links / 1,479 anchors / **0 failures**. Canonical institution identity,
slug routing, FORMER lineage, historical-dispute traceability, null-capital honesty,
evidence immutability and durable-source wiring are all verified. The two issues found
during this audit (B1, W1) were fixed and re-verified with approval.

Residual, non-blocking doc drift: the page/link counts quoted in
`docs/architecture/WORKMAP.md`, `docs/architecture/ASSET-DECISION-MATRIX.md` and
`docs/internal/ARCHITECTURE-AUDIT.md` predate the 16 redirect pages and should be refreshed.

**First task of P2-A:** model the People + Positions layer against the canonical
`institution_id`s — **start with CEOs / senior leadership** — as evidence-first assertions
(`data_assertions` + conflicts) with the same non-fabricating projection rules, seeding the
canonical store (`lk.db`) as P1 did, and **no schema change without approval**.