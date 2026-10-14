# P2-D — Canonical Documents + Jobs Audit

> Scope: canonicalise the **general document** layer (`document_title` /
> `notice_title` → `DocumentDto`) and the **job/vacancy** layer (`VACANCY` +
> `vacancy_title` → `Job`) under the frozen schema and the frozen evidence-first
> architecture — canonical identity, publisher attribution, a title
> plausibility gate, honest (mostly absent) fields, real conflict status,
> deterministic generated modules — without fabricating a single title, date,
> location, deadline, salary, employment type or vacancy count.
>
> Status: **P2-D = CLOSED**
> Owner: data layer. Evidence source: `data/durable/store.db`.
> Task id: P2-D (Documents + Jobs). Roadmap phase: content ([docs/ROADMAP.md](../ROADMAP.md)).
> Preceding: [P2-A](P2-A-PEOPLE-POSITIONS-AUDIT.md) CLOSED, [P2-B](P2-B-BRANCHES-AUDIT.md) CLOSED, [P2-C](P2-C-FINANCIAL-AUDIT.md) CLOSED.
> Follow-up: [P2-E = CLOSED](P2-E-NEWS-CONTENT-AUDIT.md) (news / content layer — canonised
> the `/news` feed + `GET /api/news`).

---

## 1. What P2-D did

| Artefact | Change |
| --- | --- |
| `scripts/build-documents-module.ts` | **NEW** builder: general-document assertions → `src/data/documents.ts` (raw assertion rows + conflict rows + provenance, mirroring `build-financials-module.ts`). `guardOrExit("build:documents")`, publisher→registry resolution, dedup by unique source claim, title gate at build, empty-store → exit 1 |
| `scripts/build-jobs-module.ts` | **REWRITTEN**: both evidence shapes (`VACANCY` entities + institution-keyed `vacancy_title` rows), publisher→registry resolution replacing the store `institutions` join, canonical re-keying of both shapes, cross-source conflicts, `PublicJob`/`Job` gained `institutionId`/`institutionSlug` columns |
| `lib/repository/projection.ts` | **+`documentsFromAssertionRows()`** (the single general-document projection), **+`titleGateReason()`** (shared gate: `GENERIC`/`OWN_NAME`/null, dot-insensitive), **+`documentEntityId()`**, **+`canonicalVacancyEntityId()`** (cross-layer id helper), **+`documentConflictRows()`/`vacancyConflictRows()`** (conflict → canonical record keys), **+`vacancy_title` field alias**, jobs title gate inside `jobsFromAssertionRows()` |
| `lib/repository/types.ts` | **+`DocumentStatus`** (`ACTIVE`/`CONFLICT`); `DocumentDto` extended with `institution_id`, `institution_slug`, `institution`, `status` (title-only contract documented) |
| `lib/repository/static-documents.ts` | **NEW** — `allPublishedDocuments()` memoized over `src/data/documents.ts` |
| `src/lib/site-data.ts` | exports `documentAssertions`, `openDocumentConflicts`, `documentsProvenance` |
| `src/data/documents.ts` | **NEW generated module** (331 assertion rows → 330 records) |
| `src/data/jobs.ts` | **REGENERATED** (100 assertions → 99 records; was 37) |
| `lib/repository/d1.ts` | **+`documentEvidence()`/`vacancyEvidence()`** (D1 path, same re-keying), `listDocuments()`/`listJobs()` implemented over them (were empty stubs) |
| `lib/api/repository.ts` | `jobsByInst` now filters `institutionSlug === inst.slug` — the pre-P2-D name-prefix match **removed** (it was how ten invented postings reached named MFIs) |
| `src/app/documents/page.tsx` | three document kinds (NRB matches, financial documents, **general documents**), honest header copy; URL column shows "— (no link in evidence)" because this layer has no URLs |
| `src/app/jobs/page.tsx` | dynamic counts, institution resolved from the canonical `institutionSlug` column (name-map removed), POSTINGS copy honest about unobserved fields |
| `src/components/documents/DocumentCatalogue.tsx` | `TYPE_LABEL` gained `DOCUMENT` ("Document link") and `NOTICE` ("Notice") |
| `package.json` | `build:documents`, `smoke:documents-jobs-p2d`; `durable:build` now chains `build-documents-module` **and** `build-jobs-module` |
| `scripts/smoke-documents-jobs-p2d.ts` | **NEW** acceptance tests PD-1…PD-10 (75 checks) |
| `scripts/smoke-api.ts` | section 07: the nine-string hand-written-title denylist replaced with **store-evidence membership** — every module title must be an observed `vacancy_title`/`JOB_TITLE` value or an observed notice filename |
| `schema/schema.sql` | **UNCHANGED** |

**Why the jobs builder needed rewriting (the identity bug).** The pre-P2-D
builder joined `data_assertions.entity_id` onto the durable store's own
`institutions` copy — the same pilot-numbering defect P2-C found in
financials. The store's `mfi-038`/`mfi-042`/`mfi-045` disagree with the public
registry, and **all three carry vacancies**, so their postings were published
under the wrong company name and slug. P2-D resolves every row's publisher
(`data/pilot/pilot-sources.json` → registry via `identityKey`, alias fallback,
`officialWebsite` host tie-break) — the same rule P2-A established, applied to
both new layers. Smoke PD-3 re-resolves the store independently and compares
sets; a regression to the store join fails it.

**Why the document layer had nothing before.** General documents existed only
as `document_title`/`notice_title` assertions with no read model: the
`/documents` page showed NRB matches and financial documents, and the general
observations — link text a source put on a document — were invisible. They now
publish as `DocumentDto` with explicit, honest gaps (§6).

---

## 2. Coverage

### General documents

| Stage | Rows | Note |
| --- | --- | --- |
| Store `data_assertions` where `field_name IN ('document_title','notice_title')` | **445** | 0 `REJECTED`, 0 retired (`valid_to`) |
| − duplicate claims (same entity + field + value + source) | **−114** | evidence re-observations; kept in the store, collapsed in the module |
| **Module assertions** (`src/data/documents.ts`) | **331** | |
| − two claims of the same title (2 sources → 1 record) | **−1** | identity is (institution, title) |
| **Published records** | **330** | 1 `NOTICE` (all rows `notice_title`), 329 `DOCUMENT` links |
| Institutions with ≥1 document | **20** | |
| Title-gate drops | **0** | every observed title was a real title |
| Unresolved publishers | **0** | all 29 sources behind both layers resolve |

Gate arithmetic: 445 − 114 = 331 module assertions; 331 − 1 = **330 records**.
Nothing lost, nothing invented.

### Jobs / vacancies

| Stage | Rows | Note |
| --- | --- | --- |
| Store `vacancy_title` rows (institution-keyed, title-only observations) | **75** | 0 rejected, 0 retired, 0 empty |
| − duplicate claims | **−13** | |
| **Unique title claims** | **62** | → 62 records |
| Store `VACANCY` rows | **38** | 37 distinct entities; the one multi-row entity is `mfi-012` (`JOB_TITLE` + `APPLICATION_URL`) |
| **Module assertions** (62 + 38) | **100** | `src/data/jobs.ts` |
| **Published records** (62 + 37) | **99** | **63 `POSTING`** (62 title-derived + the 1 parsed `JOB_TITLE`), **36 `DOCUMENT`** (filename fallback — the notice's own text was never read) |
| Institutions with ≥1 vacancy | **19** | |
| Title-gate drops | **0** | 99 = 62 + 37 exactly |
| Conflicts | **0** | see §7 |

Both representations publish; identity never comes from matching one
representation's title against the other's (§4).

---

## 3. Provenance and identity

**Document identity:** `document-<institution_id>|<normalizeObservedTitle(title)>`
where the only normalisation is trim + whitespace collapse — observed wording
is never rewritten. Built by `documentEntityId()` so the builder, the D1
adapter and the projection cannot disagree about what a record **is**.

**Vacancy identity:** `vacancy-<institution_id>|<tail>`:

- entity-keyed rows (`vacancy-mfi-0NN|…`): **only the institution segment is
  rewritten** to the publisher-resolved registry id; the tail (a source URL or
  parsed title) stays byte-for-byte;
- institution-keyed title-only rows (`vacancy_title` on `mfi-0NN`): the entity
  id carries no institution, so identity is **synthesised** as
  `vacancy-<registry id>|<title>`;
- no institution resolves → the row is left alone and never published under a
  guess.

**Attribution (both layers):** source → `pilot-sources.json.publisher` →
registry by identity key (case-folded, `limited`→`ltd`, `ltd`/`co`/`pvt`
stripped), alias fallback, `officialWebsite` host tie-break. Measured: **29
distinct sources, 0 unresolved**. Smoke PD-3 re-implements this resolution
**independently** in the test and asserts set equality of ids *and*
institution ids — including that `mfi-038`/`042`/`045` vacancies carry their
registry identity (at least one such vacancy exists, so the check is not
vacuous).

**Module columns:** every published record carries `institution_id`,
`institution_slug`, `institution` straight from the registry — never from the
store's pilot-numbered copy, never parsed out of the id, never matched by name
prefix. Smoke PD-1/PD-2 verify columns against the registry for every row.

---

## 4. Two representations, one vacancy layer — never merged

Evidence speaks vacancies two ways:

1. **`VACANCY` entities** — careers pages parsed field-by-field (title,
   `APPLICATION_URL`, `SOURCE_DOCUMENT`, …), keyed by a URL- or title-derived
   entity id;
2. **`vacancy_title` rows** — title-only observations recorded against the
   institution entity (link text like "Province Managers").

Rules, all enforced by smoke PD-7:

- the published set is exactly 62 + 37 = 99 — every unique title claim and
  every entity, once each;
- **no two records share (institution, title)** — the two representations
  cannot double-count;
- the one parsed `JOB_TITLE` (mfi-012, Nepali wording) publishes exactly once
  as its own record; it does **not** match that institution's `vacancy_title`
  wording, and no code path merges records on title similarity;
- records are keyed by id, never by fuzzy text — "similar" titles at the same
  institution stay separate records unless they are the same observed claim.

**Kind is evidence, not editorial:** `POSTING` when a title was read from the
source's own page; `DOCUMENT` when the record exists only as a link to a
notice whose text was never read (display title = the file's own name — a fact
about the file, not a claim about its contents).

---

## 5. Title plausibility gate

`titleGateReason(title, institutionName)` → `"GENERIC" | "OWN_NAME" | null`,
one pure function shared by both layers (projection) and the documents builder
(build-time drop):

- **GENERIC** — a bare call to action or filler ("Download", "Read more",
  "Click here", "Notice", "PDF", …) or an empty/whitespace title;
- **OWN_NAME** — the institution's own registered name standing in as a
  document or vacancy title;
- both comparisons are **dot-insensitive**: a period a scraper leaves on link
  label text ("Download.", "… Sanstha Ltd.") is punctuation, not identity or
  meaning. The published title keeps its dots; only the gate tests a dot-free
  form.

Withholding behaviour: a gated **document** title means no record (there is
never a URL to fall back to in this layer); a gated **vacancy** title falls
back to the notice filename when a `SOURCE_DOCUMENT` exists (→ `DOCUMENT`),
and the record is not published at all when there is nothing else to show.

The gate is applied at three levels — documents builder (row dropped from the
module), documents projection (defence in depth for the D1 path), jobs
projection (display withheld, evidence untouched) — all through the one
function. Measured: **0 drops today** (every observed title is a real title);
smoke PD-4 proves both branches by injection rather than trusting the happy
path, and proves the published sets are gate-clean.

---

## 6. No fabrication — fields deliberately empty

Evidence in this layer is **title-and-link text only**: no dates, no URLs on
the document side, no deadlines, locations or employment types on the vacancy
side. Therefore:

| Field | Value | Why |
| --- | --- | --- |
| `DocumentDto.official_url`, `go_slug`, `period` | `null` on all 330 | evidence carries no URL/date/period for these records; the URL column on `/documents` shows "— (no link in evidence)" |
| `Job.deadline` | `null` on all 99 (API: `""`) | no deadline evidence exists |
| `Job.location` | `"(location not observed)"` on all 99 | no location evidence exists |
| `Job.type` | `"(type not observed)"` on all 99 | no employment-type evidence exists |
| `meta.verification_status` | computed (`UNVERIFIED` today) | no review happened; the API never pretends it did |

Smoke PD-5 asserts every one of these on every record — a single fabricated
deadline or composed title fails the suite. No vacancy count is ever stated as
a total beyond the evidence-derived record count; `/jobs` copy says the
unobserved fields are unobserved.

---

## 7. Conflicts

- Store: **229 conflict rows, all `entity_type = 'institution'`, all
  people-class (`people_ceo`, …), all `resolution_status = OPEN`** — none on
  `document_title`, `notice_title` or any vacancy field. Many even have
  `source_a_id = source_b_id` (two extraction passes of one source).
- The P2-D conflict scope is therefore honest, not permissive: cross-source
  only (`source_a_id <> source_b_id`, both non-null) **and** document/vacancy
  fields only → **0 document/vacancy conflicts measured**.
- The builders nevertheless run real cross-source detection on both layers and
  map every key through the canonical re-keying (`documentConflictRows` /
  `vacancyConflictRows`: institution-keyed conflicts become one row per
  disputed value; entity-keyed conflicts are re-keyed only on the institution
  segment; an unresolvable conflict's owner is **skipped, never guessed**).
- Published status is computed: an OPEN conflict → document `status:
  "CONFLICT"` + `meta.verification_status: "CONFLICT"`; a vacancy reports the
  disputed field in `conflicts` and `CONFLICT` meta. All records are `ACTIVE`
  today **because there is no dispute, not because disputes are suppressed** —
  smoke PD-6 injects conflicts and proves the flip on both layers.

---

## 8. API exposure

- **`GET /api/institutions/:slug/jobs`** serves the canonical layer. The
  pre-P2-D implementation matched jobs to institutions by **name prefix** —
  how ten invented postings reached named MFIs; it now filters the canonical
  `institutionSlug` column. Smoke PD-9 asserts all 19 serving institutions
  return exactly their own records; `smoke:api` asserts every row is keyed to
  the institution's own slug prefix and carries a `deadline` of `""`, never a
  date.
- **`GET /api/institutions/:slug/documents`** (Next/B2B contract) keeps its
  frozen meaning: **NRB-matched documents**. It is deliberately **not**
  repurposed for this layer — smoke PD-9 walks all registry slugs and proves
  no `document-…` id ever appears on that route.
- **No new V1 route exists for general documents** — the frozen contract has
  none, and inventing one is out of scope. Exposure is the `/documents` page,
  the repository (`allPublishedDocuments()`), and the D1/worker path
  (`listDocuments`, §10). *Limitation recorded, not hidden.*
- **Known divergence:** the worker's `GET /api/institutions/:slug/documents`
  calls `repo.listDocuments()` → serves **P2-D general documents**, while the
  Next handler on the same path serves **NRB documents**. The path layout
  predates P2-D; P2-D made the worker's answer non-empty. Recorded as a
  contract divergence to resolve when a general-documents route is designed —
  not silently papered over.

---

## 9. Pages

- **`/documents`** now shows three kinds with honest headers: NRB matches,
  financial documents (P2-C), and general documents (P2-D — "link text a
  source put on a document"). Date column shows the observation date with the
  caveat printed on the page; URL column shows "— (no link in evidence)".
  `DocumentCatalogue` labels the two new types (`Document link`, `Notice`).
- **`/jobs`** derives counts from the module (no hard-coded numbers),
  resolves institutions via the canonical `institutionSlug` column (the old
  name map — same prefix family as the API bug — is gone), and states that
  deadline/location/type are unobserved rather than implying a full posting.
- Both pages read the same single projection the API and D1 path use.

---

## 10. D1 / worker read model

- `listDocuments()` / `listJobs()` join `data_assertions → ingestion_sources →
  institutions` **in `lk.db`** with the same re-keying helpers, then project
  through `documentsFromAssertionRows` / `jobsFromAssertionRows` — one code
  path with the static modules, no second interpretation.
- `lk.db` carries **0 `data_assertions` rows today**, so both return honest
  empties (P2-C precedent: the readers are correct projections; seeding is a
  deployment concern). The worker's documents/jobs routes are wired to them.
- **Assertion-only is preserved:** `lk.db` `documents` and `jobs` **tables
  stay at 0 rows** — there is no structured document/job evidence to seed
  (no URL, date, period, deadline, location), and writing rows would be
  fabrication. Smoke PD-10 asserts both are 0.

---

## 11. Determinism and build chain

- `durable:build` now ends with `build-documents-module` **and**
  `build-jobs-module`: neither module can drift from the evidence store
  without a failing build.
- Same store in → byte-identical module out: both builders were run twice and
  SHA-256 compared — **identical**. Provenance strings derive from the same
  bindings as the arrays (count drift structurally impossible).
- Provenance printed and embedded: `330 current document record(s)…`,
  `99 current vacancy record(s) as of 2026-10-01…` (as-of overridable via
  `M35_AS_OF`; builders `guardOrExit` their env).

---

## 12. Verification

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | clean |
| Discipline (R1–R6) | `npm run check:discipline` | `OK — no discipline violations` |
| Canonical identity | `npm run identity:verify` | `OK — master.json intact` |
| Durable chain (both builders) | `npm run durable:build` | documents 331/330/1/329/20/0; jobs 99/63/36/19/100/0 |
| Full build (SSG) | `npm run build` | OK; static export complete |
| Link & anchor audit | `node scripts/audit-export.cjs` | 395 pages, 16,442 links, 1,523 anchors, **0 failures** |
| API suite | `npm run smoke` | **87 passed, 0 failed** (incl. new evidence-membership title guard) |
| Documents+jobs acceptance | `npm run smoke:documents-jobs-p2d` | **75 passed, 0 failed** (PD-1…PD-10) |
| People acceptance (regression) | `npm run smoke:people-p2a` | 32 / 0 |
| Branch acceptance (regression) | `npm run smoke:branches-p2b` | 33 / 0 |
| Financial acceptance (regression) | `npm run smoke:financials-p2c` | 31 / 0 |
| Worker | `npm run smoke:worker` | all checks passed |
| Worker security | `npm run smoke:worker-security` | all checks passed |
| People lifecycle | `npm run smoke:people-lifecycle` | 64 / 0 |
| Ingest security | `npm run smoke:ingest-security` | 50 / 0 |
| Determinism | rebuild both modules ×2, SHA-256 | byte-identical |
| Lint | `npm run lint` | **0 findings in any P2-D file** (22 errors are pre-existing `require()`/`no-explicit-any` in P0-era `.cjs` scripts; 1 pre-existing `_opts` warning in `d1.ts` exists at HEAD) |

PD coverage, in short: identity shape + registry columns for every record;
independent store parity for both layers (catches the store-join regression,
including the three drifted institutions); title gate proven by injection on
both layers plus published-set cleanliness; null/placeholder honesty on every
fabrication-prone field; conflict projection proven by injection including the
skip-never-guess rule; cross-representation disjointness; determinism;
API parity per institution; NRB route non-repurposement; store evidence
untouched (445/75/38 rows) and `lk.db` structured tables honestly empty.

---

## 13. Blockers carried forward

- **No URL/date/period on general documents; no deadline/location/type on
  vacancies** — evidence does not carry them; the fields stay null/placeholder
  until a source states them. Withheld titles (0 today) would likewise publish
  the moment a real title is observed — a gate change, not a code change.
- **D1 has no document/vacancy assertions yet** → `listDocuments`/
  `listJobs` return empty until deployment seeds them (seeding concern, not a
  code gap).
- **API divergence:** worker `/documents` serves P2-D general documents, Next
  `/documents` serves NRB documents; no V1 route exists for the general layer
  (§8). Needs a contract decision before any consumer depends on either.
- **Doc drift:** stale baselines remain in `docs/architecture/WORKMAP.md`,
  `docs/architecture/ASSET-DECISION-MATRIX.md`,
  `docs/internal/ARCHITECTURE-AUDIT.md`; `CANONICAL-MODEL.md` §16/§17 were
  updated by this task.
- **Not committed:** all P2-A…P2-D work sits uncommitted in the working tree
  (13 staged evidence DBs, 45 modified, 31 untracked entries at P2-D
  completion); `.gitignore` is modified and must not be committed without
  approval.

---

## 14. Git state (at completion — nothing committed by this task)

```
HEAD:       14b96d4 feat: add card/table view toggle to the institution directory
staged:     13   (evidence DBs under data/pilot/evidence/, added earlier)
unstaged:   45   modified files (incl. .gitignore)
untracked:  31   entries (incl. docs/data/, scripts/smoke-*p2*.ts, src/data/documents.ts)
modified:   .gitignore, and the P2-A…P2-D source/docs edits above
```

No `git add`/`commit`/`reset`/`clean`/`discard` was performed. The staged
evidence databases and the `.gitignore` modification must not be committed
without explicit approval.

---

## 15. Verdict

**P2-D = CLOSED.** The canonical general-document and vacancy layers are built
from the frozen schema and evidence alone: 445 document observations collapse
to 330 records (1 NOTICE, 329 links, 20 institutions) and 75 + 38 vacancy
observations to 99 records (63 POSTING, 36 DOCUMENT, 19 institutions), both
resolved through publisher→registry identity (29 sources, 0 unresolved; the
three pilot-numbered institutions corrected), both representations kept
disjoint and never merged on title similarity, every title gated against
call-to-action labels and the institution's own name (proven by injection,
0 drops today), every fabrication-prone field null or explicitly unobserved
(proven per record), conflicts computed and injection-proven (0 real,
229 store conflicts all out of scope), the name-prefix API matching removed,
the NRB documents route left untouched, both modules chained into
`durable:build` and byte-identical on rebuild, `lk.db`'s structured
document/job tables left honestly empty, and the full verification suite green
(75 P2-D checks, 87 API checks, all prior-phase suites, lint clean in every
P2-D file). **P2-E = CLOSED** — see
[P2-E-NEWS-CONTENT-AUDIT.md](P2-E-NEWS-CONTENT-AUDIT.md).
