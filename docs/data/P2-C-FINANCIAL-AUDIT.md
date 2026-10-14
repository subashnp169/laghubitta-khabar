# P2-C — Canonical Financial Documents Audit

> Scope: make financial **documents** first-class at the read model — canonical
> identity, publisher attribution, plausibility, honest status, determinism —
> under the frozen schema, without fabricating a single figure or period.
> Assertion-only for `financial_reports` / `financial_metrics` / `interest_rates`
> (see A4).
>
> Status: **P2-C = CLOSED**
> Owner: data layer. Evidence source: `data/durable/store.db`.
> Task id: P2-C (Financial). Roadmap phase: **C — financial** ([docs/ROADMAP.md](../ROADMAP.md)).
> Preceding: [P2-A](P2-A-PEOPLE-POSITIONS-AUDIT.md) CLOSED, [P2-B](P2-B-BRANCHES-AUDIT.md) CLOSED.

---

## 1. What P2-C did

| Artefact | Change |
| --- | --- |
| `scripts/build-financials-module.ts` | **REWRITTEN** to P2 discipline: publisher→registry identity resolution, canonical entity re-keying, document-title plausibility gate, real `CONFLICT` status, `guardOrExit("build:financials")`, determinism, provenance string. Was: a one-off store join with none of that |
| `lib/repository/projection.ts` | **+`financialsFromAssertionRows()`** — the single projection from `FINANCIAL` assertions to the financial document view (groups by entity, retired/unknown-field filtering, title gate fallback to file name, `CONFLICT` from open conflicts, deterministic sort) |
| `lib/repository/types.ts` | **+`FinancialKind`** (`REPORT`/`RATE`), **+`FinancialDocumentStatus`**, **+`FinancialDocumentDto`** |
| `lib/repository/static-financials.ts` | **NEW** — `allPublishedFinancials()` memoized over `src/data/financials.ts` assertions + open conflicts (the static read model) |
| `lib/repository/d1.ts` | **+`financialEvidence()`** (D1 path: `data_assertions` → `ingestion_sources` → `institutions`, re-keyed), **+`financialReportFromDocument()` / `interestRateFromDocument()`**; `listFinancials()` / `listInterestRates()` implemented over them |
| `lib/api/repository.ts` | **+`allFinancialDocuments()`**; the per-institution financial/interest-rate reads now filter on `institution_slug` instead of parsing the record id; `instForFinancial` (id-prefix join) **removed** |
| `src/lib/site-data.ts` | financial export replaced: `financialAssertions`, `openFinancialConflicts`, `financialsProvenance` (raw assertions cross the facade; the *view* lives in the repository) |
| `src/data/financials.ts` | **REGENERATED** by the new builder (was a hand-shaped module from an earlier export) |
| Pages | `src/app/page.tsx`, `financials`, `documents`, `search`, `research` now read `allPublishedFinancials()`; `src/app/institutions/[slug]/page.tsx` reads `allFinancialDocuments()` and matches on `institution_slug` |
| `scripts/smoke-financials-p2c.ts` | **NEW** acceptance tests PC-1…PC-8 (31 ok / 0 fail) |
| `scripts/smoke-api.ts` | section 08 source scan re-pointed at the assertion-shaped module; financial route expectations now assert evidence-only rows |
| `package.json` | `smoke:financials-p2c`; `durable:build` now ends with `build:financials` (the builder was **not** in the chain before) |
| `schema/schema.sql` | **UNCHANGED** |

**Why the builder needed rewriting.** Three defects, one of them an identity bug:

1. **Wrong attribution.** The old module joined
   `data_assertions.entity_id` (`financial-mfi-0NN|…`) straight onto the durable
   store's own `institutions` copy. That copy carries **pilot** numbering while the
   public registry ([`src/data/institutions.ts`](../../src/data/institutions.ts))
   uses canonical numbering, so `mfi-038` resolved to *Sahakarya* in the store and
   to *Mahila* in the registry. **23 of the 48 documents were published under the
   wrong institution**, on the wrong institution page, with URLs that prove it
   (`mlbsl.com.np/…` shown as Sahakarya, `sampadalaghubitta.com.np/…` shown as
   Surya Jyoti).
2. **No title gate.** 21 of 153 assertions carried a generic call-to-action or the
   institution's own name as `DOCUMENT_TITLE` ("Annual Report", "Click here",
   "Sahakarya Laghubitta") — not an identity for a document. They were published
   as if they were titles.
3. **Fabricated lifecycle.** Every row was stamped `ACTIVE` and `open` regardless
   of conflicts, and the module was not in `durable:build`, so it drifted from the
   evidence store silently.

---

## 2. Coverage

| Stage | Rows | Note |
| --- | --- | --- |
| Evidence store `data_assertions` where `entity_type = 'FINANCIAL'` | **153** | 48 distinct `entity_id`, 14 sources, `verification_status`: 144 `UNVERIFIED` + 9 `STALE` |
| − retired / superseded (`valid_to` set) | **−9** | all 9 were also the only `STALE` rows; kept in evidence, not published |
| − generic / institution-name `DOCUMENT_TITLE` | **−21** | plausibility gate; kept in evidence, not published |
| **Published assertions** | **123** | `src/data/financials.ts` |
| Distinct documents published | **48** | identity = `financial-<institution_id>\|<url>` |
| — of which reports | **40** | `kind: REPORT` |
| — of which interest-rate notices | **8** | `kind: RATE`, `RATE_KIND` on every one |
| Institutions with ≥1 document | **14** | |
| Sources behind them | **14** | every `source_id` resolves; one document reaches 10 sources |
| Open conflicts in the projection | **0** | 0 rows in `data_conflicts` for `FINANCIAL` |

Gate arithmetic: 153 − 9 − 21 = **123**, and 123 assertions group to exactly the
48 documents the evidence describes. Nothing was lost, nothing was invented.

---

## 3. Provenance and identity

**Entity identity.** Evidence stores `entity_id` as
`financial-mfi-0NN|<source_url>`. The builder keeps the URL tail **byte-for-byte**
and rewrites only the prefix to the canonical institution id resolved from the
publisher of the *observed* source:

1. `data/pilot/pilot-sources.json` → `publisher` for the row's `source_id`;
2. publisher → `src/data/institutions.ts` by identity key (case-folded, `limited`
   → `ltd`), with alias fallback and `officialWebsite` host tie-break;
3. unresolvable publisher → assertion **not published** (recorded as a drop).

This is the same resolution rule P2-A established; no new inference. The result is
the same id on both sides of every join, so `financial-<institution_id>` and the
record's `institution_id`/`institution_slug` always agree — enforced by smoke PC-4.

**What the fix changed.** The 23 previously mis-attributed documents, examples:

| Correct (registry, from publisher) | Old (store join) | Evidence URL host |
| --- | --- | --- |
| `mfi-038` Mahila Laghubitta Bittiya Sanstha | Sahakarya | `mlbsl.com.np` |
| `mfi-036` Sampada Laghubitta Bittiya Sanstha | Surya Jyoti | `sampadalaghubitta.com.np` |

**Title plausibility.** A `DOCUMENT_TITLE` is published only when it is a real
document identity: not empty, not generic ("annual report", "download",
"click here", …), not the institution's own name or domain, and not shorter than
a real title would be. Failures fall back to the file name carried by
`SOURCE_DOCUMENT` when present, and to the URL basename otherwise — a name taken
from the evidence, never composed by us. 21 rows failed the gate entirely and
were withheld (§2).

**Status is computed, not stamped.** `CONFLICT` when any assertion key
`<entity_id>|<field_name>` is in the open-conflict set, `STALE` when the evidence
row is retired, otherwise `ACTIVE`. Because 0 `FINANCIAL` conflicts exist in the
store, all 48 are `ACTIVE` — and smoke PC-6 proves that by *injecting* an open
conflict and re-projecting, rather than trusting the happy path.

**Determinism.** Same store in → byte-identical module out; the build prints its
provenance line and the smoke compares two independent runs (PC-7).

---

## 4. Figures and periods — deliberately none

`financial_reports`, `financial_metrics` and `interest_rates` in `lk.db` remain
**0 rows**, and the D1 readers for them return honest empties. Evidence carries
**document-level** fields only (`DOCUMENT_TITLE`, `SOURCE_DOCUMENT`,
`DOCUMENT_TYPE`, `RATE_KIND`) — not one number, not one period, not one
`rate_pct`. Extracting or seeding any of them would be fabrication, so:

- `FinancialDocumentDto.metrics` does not exist; a row is the *document*, never
  its contents;
- smoke PC-8 asserts `financial_reports` = 0, `financial_metrics` = 0,
  `interest_rates` = 0 in `lk.db` **and** that no published row carries a metric,
  a numeric rate or a period (`smoke-api` section 08 enforces the same on the
  module source);
- paid-up capital stays where it already is: an identity fact with provenance on
  the institution, explicitly *not* a metric (recorded in
  [`CANONICAL-MODEL.md`](CANONICAL-MODEL.md) §14, drift row 5).

A schema change to make geography/figures nullable was **not** taken — that
decision belongs to a source that publishes figures, not to P2-C.

---

## 5. Conflicts

- Store: `data_conflicts` for `entity_type = 'FINANCIAL'` = **0**.
- The builder nevertheless performs real cross-source conflict detection on
  `FINANCIAL` assertions and maps every key through the canonical re-keying, so a
  conflict on a pilot-numbered entity still lands on the registry entity.
- Published status: 0 `CONFLICT` rows — because there is no evidence of conflict,
  not because conflicts are suppressed. PC-6 injects one and proves the status
  flips.

---

## 6. Impact

**Pages.** `/`, `/financials`, `/documents`, `/search`, `/research` and the
institution page all read the *same* single projection. 23 documents moved to the
institution whose own site they came from; the institution financial page now
matches on `institution_slug` rather than an id prefix, so no document can land on
an institution page through string shape alone.

**API.** `GET /api/institutions/:slug/financials` and
`GET /api/institutions/:slug/interest-rates` serve the canonical document layer
(P2-C) instead of the empty-phase stub; `GET /api/interest-rates` likewise. Empty
only where no document evidence resolves. Contract semantics unchanged: a row is a
document, `metrics`/`rate_pct`/periods stay `null`, `meta.verification_status`
stays `UNVERIFIED`.

**D1/worker.** `listFinancials()` / `listInterestRates()` read
`data_assertions → ingestion_sources → institutions` — a join that is safe in
`lk.db` because its `ingestion_sources.institution_id` already carries registry
numbering (verified: `mfi-038` = Mahila). They return empty until deployment
seeds `FINANCIAL` rows into D1, which is a deployment concern, not a code gap.

**Build.** `durable:build` now ends with `build:financials`, so the module can
never again drift from the evidence store without a failing build.

---

## 7. Verification

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | clean |
| Discipline (R1–R6) | `npm run check:discipline` | `OK — no discipline violations` |
| Canonical identity | `npm run identity:verify` | `OK — master.json intact` |
| Full build (SSG) | `npm run build` | OK; static export complete |
| Durable chain incl. `build:financials` | `npm run durable:build` | 123 / 48 / 40 / 8 / 14 / 0 |
| Link & anchor audit | `node scripts/audit-export.cjs` | 395 pages, 16,046 links, 1,523 anchors, **0 failures** |
| API suite | `npm run smoke` | **85 passed, 0 failed** |
| Financial acceptance | `npm run smoke:financials-p2c` | **31 passed, 0 failed** (PC-1…PC-8) |
| People acceptance (regression) | `npm run smoke:people-p2a` | 32 / 0 |
| Branch acceptance (regression) | `npm run smoke:branches-p2b` | 33 / 0 |
| Worker | `npm run smoke:worker` | all checks passed |
| Worker security | `npm run smoke:worker-security` | all checks passed |
| People lifecycle | `npm run smoke:people-lifecycle` | 64 / 0 |
| Ingest security | `npm run smoke:ingest-security` | 50 / 0 |
| Lint | `npm run lint` | no findings in any P2-C file (the 22 errors are pre-existing `require()`/`no-explicit-any` in `.cjs` builders) |

PC-1 coverage, in short: source resolution and re-key stability; title gate
21 withheld; retired 9 withheld; every published row has a source, an
`observed_at` and a status; no metric/period/`rate_pct` anywhere; determinism;
`lk.db` financial tables honestly empty; conflict status proven by injection.

---

## 8. Blockers carried forward

- **`financial_reports` / `financial_metrics` / `interest_rates` cannot be
  seeded** — no figures or periods exist in evidence. Documented as deliberate;
  the same class of blocker P2-B recorded for branch geography.
- **D1 has no `FINANCIAL` evidence yet.** The readers are correct projections and
  return empty until deployment seeds them.
- **21 generic titles and 9 retired assertions** are withheld from publication but
  retained in evidence; if a better source states the real title, the gate will
  admit it without a code change.
- **16 capital figures remain unrecoverable offline** (`nrb-kfi`) and stay
  nulled; capture day is unknown and must not be fabricated.
- **Doc drift:** stale audit-export baselines remain in `docs/architecture/WORKMAP.md`,
  `docs/architecture/ASSET-DECISION-MATRIX.md`, `docs/internal/ARCHITECTURE-AUDIT.md`.
- **Not committed:** all P2-A/P2-B/P2-C work sits uncommitted in the working tree
  (44 modified, 13 staged additions, 27 untracked at P2-C completion); `.gitignore`
  was modified by an earlier step and must not be committed without approval.
- **P2-D (Documents + Jobs) is CLOSED** - see
  [`docs/data/P2-D-DOCUMENTS-JOBS-AUDIT.md`](P2-D-DOCUMENTS-JOBS-AUDIT.md).

---

## 9. Verdict

**P2-C = CLOSED.** The canonical financial **document** layer is built from the
frozen schema and evidence alone: 123 assertions grouped into 48 documents across
14 institutions and 14 sources, identity re-keyed through the real publisher so a
document is never published under the wrong institution's name (23 were), titles
gated to real document identities (21 withheld), status computed rather than
stamped and proven by injection, zero conflicts, zero fabricated figures or
periods, `financial_reports`/`financial_metrics`/`interest_rates` left honestly
empty, the builder chained into `durable:build`, and no schema or production
change. All verification is green. **P2-D (Documents + Jobs) is CLOSED** - see
[`P2-D-DOCUMENTS-JOBS-AUDIT.md`](P2-D-DOCUMENTS-JOBS-AUDIT.md).
