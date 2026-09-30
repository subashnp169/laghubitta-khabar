# M3.5 Careers / Vacancies — Design

Status: **core extraction, evidence and projection implemented and proven**
(`smoke:careers`, 324 checks; `prove:careers-json`, 158 checks). The live pilot is
done — 29 institutions, 60 pages — and the `listJobs` adapters and the API/UI
cutover that replaced the fabricated rows are in place. What remains is publishing,
which needs a reviewed document or a decided ATS policy; see
`PHASE-M3.5-FINAL-AUDIT.md`. M3.4 is FROZEN at `06bd00a` and is not touched by this
design, with one additive exception noted under "Module layout".

Two findings from implementing this design changed it, and both are recorded
below rather than quietly folded in:

1. **A reverted value needs reviving, not re-inserting.** An assertion's
   identity is `(entity, field, source, value)`, so a value that goes
   `Credit → Risk → Credit` resolves to a row that is already in the table,
   retired. Re-inserting it is silently dropped by the writer's
   `INSERT OR IGNORE`, and the field is then left with **no current claim** and
   disappears from the read model. `EvidenceWriter.reviveAssertion` (optional,
   additive) restores the row and re-points it at the newest snapshot. Test
   V4.24–V4.26.
2. **A deadline read from prose is stored but not published.** The design's
   confidence rule (0.45, below the 0.5 publishable bar) means the value cannot
   become `deadline`. Rather than discard a fact the page does state, the read
   model exposes it as `deadline_evidence` with the raw text and no claimed
   date. Test V4.21–V4.23.

## What already exists (and is reused, not rebuilt)

M3.5 is a thin new capability over machinery that is already proven. The survey
found more prior art than expected:

| Need | Existing thing | Where |
| --- | --- | --- |
| Capability | `CAREER_PAGE` already in the frozen capability union | `lib/ingestion/types.ts:16` |
| Capability cadence | `CAREER_PAGE: 60` min (frequent bucket), already scheduled for all 51 | `lib/ingestion/schedule.ts` |
| Link type | `CAREER_PAGE` legal in `official_links.link_type` | `schema/schema.sql:721` |
| Discovery | `hrefHint: "career"` and `hrefHint: "vacancy"` rules exist | `lib/ingestion/discovery.ts:77-78` |
| Extraction | `vacancy-html-v1` parser, `VACANCY_TITLE`, `VACANCY_DEADLINE` | `lib/ingestion/structured.ts:922-995` |
| Validation | `vacancyValidator` (`r-vacancies`) | `lib/ingestion/structured.ts:1155` |
| JSON/API path | `VACANCY_*` key maps, `vacancyAvailable` gate, portal → `outbound_links` `target_type='JOB'` | `lib/ingestion/dataapi.ts:38-41, 268-283` |
| Evidence | `EvidenceWriter` + `LocalSqliteEvidenceWriter`, snapshots, conflicts, `valid_to`/`STALE` | `lib/ingestion/contract.ts`, `adapters/local.ts` |
| Canonicalization | `deterministicHtmlCanonicalizer`; non-HTML hashed from raw bytes | `lib/ingestion/canonical.ts:107` |
| Fetch | `ControlledFetcher` with SSRF, size, timeout, redirect, MIME policy | `lib/ingestion/fetcher.ts` |
| Read model | `peopleFromAssertionRows` (people), `branchesFromAssertionRows` (branches, M3.4) | `lib/repository/projection.ts` |
| API | `listJobs(institutionId): Paged<JobDto>`, `/api/institutions/:slug/jobs`, `SUB_RESOURCES.jobs` | `lib/repository/contract.ts:33`, `worker/src/index.ts:120-124` |
| DTO | `JobDto { id, title, location, type, posted_at, deadline, is_active, meta }` | `lib/repository/types.ts:159-168` |
| Coverage | `institution_coverage.career_status` | `schema/schema.sql:872` |

Three gaps force new code:

1. **There is no vacancy identity.** `vacancyExtractor` emits `VACANCY_TITLE` as a
   field on the *institution* entity (`engine.ts:417`), so a career page with five
   vacancies produces five anonymous title assertions with nothing tying them
   together, and nothing to supersede when one is filled.
2. **There is no career page-shape taxonomy.** The branch side has
   `StructureKind`/`BranchCoverage`/`classifyCoverage` (`shape-signals.ts`); careers
   have nothing equivalent.
3. **`listJobs` is a stub** (`d1.ts:259-261`) and the one live jobs read model,
   `lib/api/repository.ts:jobsByInst`, is a **string-prefix match on the institution
   name over 10 hand-invented rows** in `src/data/jobs.ts`.

**The single most important finding:** `/jobs` currently publishes ten fabricated
listings with fake deadlines and "Apply" links. That is precisely the failure mode
this project exists to prevent, and M3.5 must remove it rather than decorate it.

## Real pilot universe

`data/pilot/pilot-sources.json` carries a located `CAREER_PAGE` URL on **29 of 51**
sources (matching `discovery-report.json` `perCapability.CAREER_PAGE: 29`). Those
29 URLs are the pilot candidate set, and they are not homogeneous:

| Kind | Count | Examples |
| --- | ---: | --- |
| Bare site root, not a career page | 12 | `nirdhan`→`https://www.nirdhan.com.np`, `chhimek`, `deproscbank`, `mlbsl`, `ulbsl`, `dhaulagiribank`, `rsdcmf` |
| Real career path | 12 | `aatmanirbhar/career`, `nerudemirmire/career`, `kalikabank/career`, `jucbank/categories/career`, `forwardmfbank/index.php/careers`, `himalayanlaghubitta/page/careers/7`, `supportmicrofinance/career`, `swabhimaan/careers`, `uniquenepal/career`, `swastiklbs/vacancy`, `jeevanbikasmf/career`, `mslbsl/career/online-registration` |
| Dedicated career subdomain | 1 | `matribhumi` → `career.matribhumimf.com.np` |
| Vacancy-slug page | 1 | `asha/vacancy-2` |
| PDF notice | 2 | `slbsl/…/slbs_finalresultlist.pdf`, `nationalmicrofinance/…/career/Vaccancy3.pdf` |

Two consequences that shape the design:

- **A site root is not a career page.** Twelve of 29 located URLs are just the
  domain root. Accepting them would let any homepage become a "career page" with
  zero vacancies, which is a false claim. Discovery must reject root-equivalent
  URLs and clear the `known_url` with a note.
- **`slbsl`'s PDF is a recruitment *result list*** — the filename says
  `finalresultlist`. It is a document about a completed process, not a vacancy
  notice. Classification must be able to say so, and must not report it as an open
  vacancy.

## 1. What constitutes a career page?

A page is a career page when **combined deterministic evidence** supports it, never
URL text alone. Modeled directly on the M3.4 `classifyCoverage` discipline: a pure
function of measured structure, with a fixed precedence order, so the same bytes
always yield the same verdict.

`classifyCareerShape(counts) → CareerShape`, evaluated in order:

1. `UNREADABLE_BODY` — 0 bytes or a 3xx body. **Never a negative finding**, same
   rule as `isUnreadable` in `shape-signals.ts:261-264`.
2. `CLIENT_RENDERED_SHELL` — visible text under ~200 chars with script/noscript
   and JS indicators present. Data is *undetermined*, so vacancy count is `null`.
3. `NOT_A_CAREER_PAGE` — no career vocabulary, **or the URL is root-equivalent**.
4. `RECRUITMENT_RESULT_PAGE` — result/selected/merit-list vocabulary dominates
   ("result", "merit list", "successful applicants", "shortlisted", "selected
   candidates"). Explicitly *not* a vacancy page.
5. `VACANCY_DOCUMENT` — `application/pdf`, or a document link whose text carries
   recruitment vocabulary. Evidence only, see §10.
6. `VACANCY_LIST` — ≥1 assertable vacancy record, multiple.
7. `SINGLE_VACANCY_DETAIL` — exactly one vacancy, described in prose.
8. `CAREER_VOCABULARY_ONLY` — career words present, no structure. `null`.

`NOT_A_CAREER_PAGE` for roots is the load-bearing rule: it is what stops 12
homepages from being reported as career pages with no vacancies.

## 2. What constitutes a vacancy?

A **vacancy** is a record that satisfies all three:

1. **Anchored** — carries at least one of: a job-role noun (`JOB_ROLE_RE`, which
   already exists at `structured.ts:935` and covers Devanagari role nouns), a
   deadline marker, a declared vacancy column header, or a vacancy-detail
   structure (heading + a deadline or application method).
2. **Titled** — yields an assertable `JOB_TITLE` (3–90 chars, not a section
   label, not a contact string, not date-like, not URL-like).
3. **Attributable** — the parser can name *which* field each value came from. A
   value that cannot be attributed to a specific vacancy on a multi-vacancy page is
   page-level evidence, not a vacancy attribute.

Anchoring is the existing rule, kept. It is what makes the junk career page
(`smoke-structured.ts:274`) produce zero assertions, and that test must keep
passing.

Explicitly **not** vacancies: section labels (`Career Opportunities`, `Vacancies`),
nav items, contact details, "apply now" CTAs, salary text, and result-list rows.

## 3. Which fields are authoritative?

Only the vocabulary in the brief, and each with a real justification from the 29
URLs. Confidence follows the existing convention (`structured.ts:9-11`: identity
≥ 0.5 asserts, volatile stays evidence-only at 0.45).

| Field | Rule | Normalization | Conf. | Provenance | Validation |
| --- | --- | --- | ---: | --- | --- |
| `JOB_TITLE` | anchored record's title cell / heading / `<h1>` | NFKC, collapse space, strip trailing punctuation | **0.6** | snapshot | 3–90 chars, not a skip-label, not date/URL/phone |
| `LOCATION` | declared column, else city/district token in the record | NFKC, collapse, title-case-preserving | 0.5 | snapshot | 2–60 chars, not a role noun, not a bare country |
| `DEPARTMENT` | declared column, else labelled inline field | as above | 0.5 | snapshot | 2–60 chars, must not equal title |
| `EMPLOYMENT_TYPE` | mapped token (`full time`→`FULL_TIME`, etc.) | uppercase enum, default **unset** | 0.5 | snapshot | must be one of the 4 schema values or not stored |
| `PUBLISHED_DATE` | labelled date field | ISO `YYYY-MM-DD` | 0.5 | snapshot | parseable, not in the future beyond today |
| `DEADLINE` | **declared column** only | ISO `YYYY-MM-DD` | 0.5 | snapshot | parseable; malformed → evidence, never asserted |
| `DEADLINE` | **free-text** occurrence | ISO | **0.45** | snapshot | evidence only — matches the frozen `VACANCY_DEADLINE` rule |
| `REQUIREMENTS` | labelled list under the record | NFKC, collapse | 0.5 | snapshot | 1–2000 chars |
| `EDUCATION` | labelled field | as above | 0.5 | snapshot | 1–200 chars |
| `EXPERIENCE` | labelled field or `N years` token | as above | 0.5 | snapshot | 1–120 chars |
| `APPLICATION_METHOD` | labelled field (`email`, `online`, `in-person`) | lowercase enum | 0.5 | snapshot | one of the 3 tokens |
| `APPLICATION_URL` | `href` on a declared apply/notice link | absolute, `https:` only | 0.5 | snapshot | must pass the same host/scheme policy as the fetcher |
| `CONTACT_EMAIL` | `mailto:` or a validated address | lowercase, trimmed | 0.5 | snapshot | existing email regex `structured.ts:449-454` |
| `SOURCE_DOCUMENT` | the snapshot id of the containing page/PDF | — | 0.5 | self | always present for every vacancy |

**The declared-column/free-text split for `DEADLINE` is the one genuinely new rule
and it matters.** A deadline in a `<td>` under a `Deadline` header has structural
support and may assert. A deadline found in a sentence has none, and stays at 0.45
exactly as the frozen `VACANCY_DEADLINE` does today. Without this split, either
every free-text date becomes an assertion (fabrication risk) or no deadline can
ever assert (and §6 expiry becomes unimplementable).

`EMPLOYMENT_TYPE` is written unset rather than defaulted to `FULL_TIME`, even though
the frozen `jobs` table defaults it — because defaulting invents a fact.

## 4. What is the deterministic vacancy identity?

```
vacancyIdentityKey(institutionId, title, location?) =
    `${institutionId}|${normalizeTitle(title)}|${normalizeLocation(location) ?? ""}`
```

Deliberate choices, each traceable to a required test:

- **Not the URL.** `/career/123` → `/notice/456` must stay one vacancy.
- **Dates are excluded from identity.** A deadline is routinely *extended*, which
  must supersede, not fork. Dates are also frequently absent (§5, "missing date").
  Including them would break both required cases. Dates instead feed the
  **fingerprint** used for change detection.
- **Location is in identity when present.** Required: "same position, different
  location → different identities". A posting that relocates becomes a new posting
  rather than silently merging two real jobs. This mirrors the M3.4 rename
  precedent, where a new identity is safer than a wrong merge.
- **An absent location is an empty component, never a placeholder.** Absence must
  not change identity when a later observation supplies the location only if
  evidence proves equivalence — which a title match alone does not. So a
  late-arriving location *does* fork. That is recorded, not smoothed over.

`vacancyFingerprint(record)` covers the full observed record (title, location,
dates, type, department) and is what drives supersession.

The module is `lib/ingestion/careers.ts`, structurally a sibling of
`lib/ingestion/branch-records.ts`. It is a **new file**, not an edit to M3.4 code.

## 5. What is merely evidence?

Evidence is everything the structure does not justify, and it is preserved rather
than dropped:

- Any field at confidence < 0.5 (free-text deadlines, unlabelled dates).
- PDF-derived anything (§10).
- Page-level values on a multi-vacancy page that cannot be attributed to one
  vacancy.
- Vacancy **counts** derived from a page that is not a parsed directory.
- Unattributed phones/emails/URLs.
- Prompt-injection-shaped text, always (§ Security).
- A vacancy that disappeared from a page — recorded as a conflict, not closure.

Evidence lives in `ExtractedEvidence` rows and `source_snapshots`; it never becomes
an assertion, and the engine's existing `confidence >= 0.5` gate enforces that
(`engine.ts:409`).

## 6. What makes a vacancy active/closed?

There is **no new database status column**. Lifecycle is a projection over stored
assertions, exactly as M3.4 did for branches.

`vacancyStatus(vacancy, now)`:

| Status | Derived from | Meaning |
| --- | --- | --- |
| `ACTIVE` | asserted title, no closure evidence, asserted deadline absent or ≥ now | open |
| `EXPIRED` | asserted `DEADLINE` < `observed_at` | a **projection**, never a stored fact |
| `CLOSED` | explicit closure language in an observed field | rare, evidence-backed |
| `NOT_LISTED` | absent from a page that **was** fetched and parsed into a directory | recorded as `NO_LONGER_LISTED` conflict, explicitly *not* closure |
| `UNKNOWN` | no deadline asserted, no closure evidence | unknown is a real answer |
| `SOURCE_UNAVAILABLE` | last fetch failed | recorded on the **source**, never propagated to vacancies |

The distinction the brief demands, made concrete:

- A **failed fetch** never changes a single vacancy. It is a source-health fact.
  Zero vacancies, forty vacancies, or a closed role are all consistent with a
  failed fetch, and the projection must not pick one.
- A **disappearance from a successfully parsed directory** is `NOT_LISTED`. It is
  the only disappearance signal that is even eligible to be a lifecycle event, and
  it still does not mean "closed" — it means "this source stopped listing it",
  which is what M3.4's `NO_LONGER_LISTED` resolution note already says.
- **Deadline expiry** is the only lifecycle transition derivable from the stored
  record alone, and it is labelled `EXPIRED` rather than `CLOSED` precisely because
  a deadline passing does not mean the role was filled.

## 7. How are changed vacancies superseded?

The M3.4 mechanism, reimplemented in a careers module over the shared
`EvidenceWriter` contract — no M3.4 file is edited:

1. Index prior observations by `vacancyIdentityKey`; later observation wins.
2. `diffVacancies` → `added | changed | unchanged | disappeared`.
3. For each changed field, plan `SUPERSEDE(field, old_value)`.
4. `applyVacancyPlan` calls `writer.findAssertions(...)` then
   `writer.supersedeAssertion({ id, validTo, status: "STALE" })`, which stamps the
   frozen `valid_to` + `STALE` columns and never deletes.
5. A conflict is recorded with cause `VALUE_CHANGED` (or `NO_LONGER_LISTED`).
6. The new value is asserted with `supersedes_fingerprint`.

Identity is stable across formatting and URL changes, so a re-published page with
different markup produces `unchanged`, not a second vacancy. Repeat ingestion with
an unchanged content hash reuses the snapshot via `findSnapshotByContentHash`, and
because the semantic assertion id already includes `source_id`, a true repeat adds
nothing.

**The M3.4 conflict-replay question is not re-decided here.** Vacancy conflicts
follow whatever M3.4 settles; this design only states the mechanism, and the M3.5
tests will assert the *current* behaviour explicitly so it stays pinned.

## 8. How are duplicate pages handled?

Two URLs publishing the same vacancy produce the **same `entity_id`** (identity
excludes URL), so:

- Within one source: the semantic assertion id dedupes → one assertion per
  (entity, field, value, source). Two career pages listing the same role add no
  duplicate.
- Across sources: same `entity_id`, different `source_id` → both are kept with
  separate provenance. This is "same logical vacancy, provenance remains separate".
- The `SOURCE_DOCUMENT` field and `meta.last_verified_at` are what distinguish the
  two pages, so a reader can always see which document backed a value.

Cross-source **disagreement** (same vacancy, different deadline) is a conflict, via
the existing `data_conflicts` infrastructure, and surfaces in the read model as
`CONFLICT` in `meta.verification_status`.

## 9. How is provenance preserved?

Every assertion carries `source_id` + `source_snapshot_id` + `observed_at`
(`AssertionInput`). Snapshots are content-addressed and reused by
`(source_id, content_hash)`, so an unchanged page does not accumulate snapshots.
Superseded values are retained with `valid_to` + `STALE`, never deleted. The
projection exposes:

- `meta.source` — the source that still asserts the value
- `meta.last_verified_at` — newest observation across contributing sources
- `meta.verification_status` — `UNVERIFIED` | `AUTO_VERIFIED` | `CONFLICT` (never
  `HUMAN_VERIFIED`; nothing in this pipeline is human-verified)

Every assertion written by M3.5 is `UNVERIFIED`. There is no code path in this
milestone that produces a verified label.

## 10. How are PDF vacancy notices represented?

**There is no PDF text extraction in this repository, and M3.5 does not add one.**
`smoke-pdf-canonical.ts` Q13 deliberately asserts that a bare PDF yields no
catalog fields, and `deterministicHtmlCanonicalizer` hashes non-HTML from raw bytes.
Adding OCR or a PDF text layer is explicitly out of scope, and inventing fields from
an unreadable PDF is precisely the prohibited behaviour.

So a PDF notice gets, and only gets:

- a `source_snapshots` row (content hash = identity, bytes preserved)
- an `outbound_links` row with `target_type='DOCUMENT'`
- one asserted field: `SOURCE_DOCUMENT`
- deterministic metadata in the report: MIME, byte length, sha256, HTTP status,
  `fetched_at`
- `vacancy_count: null` and a `VACANCY_DOCUMENT` shape

A PDF **list** page that also links to per-vacancy HTML pages is a normal Shape C
page: the vacancies come from the HTML, and the PDF is recorded as a related
document. That is the only way a PDF source contributes vacancies, and it is
honest — the vacancies are in bytes we can read.

`slbsl`'s `slbs_finalresultlist.pdf` lands in `RECRUITMENT_RESULT_PAGE` /
`VACANCY_DOCUMENT`, never in a vacancy count.

## Module layout

New files only. No edits to `branch-*.ts`, `projection.ts` branch functions,
`people.ts`, or anything under `schema/`, `migrations/`, `data/master/`.

| File | Role |
| --- | --- |
| `lib/ingestion/careers.ts` | shape taxonomy, `classifyCareerShape`, field vocabulary, `vacancyIdentityKey`, `vacancyFingerprint`, record grammar for shapes A/B/C/D/F, validators, `analyzeCareerPage` |
| `lib/ingestion/career-evidence.ts` | `planVacancyEvidence` / `applyVacancyEvidence` over `EvidenceWriter`; read-then-write idempotency, supersede, revive, conflicts |
| `lib/ingestion/career-discovery.ts` | combined-evidence career target discovery, reusing `extractSameHostLinks` / `parseSitemapLocs` / `parseRobotsSitemap` from `discovery.ts` without editing it |
| `lib/repository/projection.ts` | **additive**: `jobsFromAssertionRows()` + `vacancySlug()`, mirroring the M3.4 branch additions. The existing people and branch functions are untouched. |
| `scripts/smoke-careers-m35.ts` | the 28 required cases plus the extra proof the implementation demanded; real SQLite. 126 checks, 7 groups (V1 shape, V2 fields, V3 identity, V4 lifecycle, V5 multi-source, V6 documents, V7 safety) |
| `scripts/build-career-registry.ts` | generates `data/pilot/career-source-registry.json` — **not yet written** |
| `docs/PHASE-M3.5-CAREERS-DESIGN.md` | this document |

Two shared files change, both additively and neither altering existing
behaviour:

- `lib/ingestion/contract.ts` gains **one optional method**,
  `reviveAssertion?`. Optional means no existing implementer or caller is
  affected; M3.3 and M3.4 code paths are untouched.
- `lib/ingestion/adapters/local.ts` implements it.

`lib/repository/projection.ts` gains the jobs section at the end of the file,
after the frozen M3.4 branch history function. `JobDto` stays frozen;
`VacancyDto extends JobDto` additively, so every existing consumer keeps
compiling. The planned `status` field on `JobDto` was **not** added, for the
same reason: `VacancyDto` carries `status` instead.

`src/data/jobs.ts` and the `/jobs` page are **not yet** changed. The fabricated
rows are still live and are the next thing to remove.

## Security posture

Inherited, not reinvented, and one M3.5-specific rule added:

- Downloaded bytes are untrusted data, never code. No `eval`, no `Function`, no
  DOM, no network fetch from parsed content. Parsing is regex + `TextDecoder`.
- SSRF, HTTPS-only, host allowlist, redirect revalidation, body cap, timeout all
  come from `ControlledFetcher`.
- Prompt-injection text is a **value problem, not an instruction problem**. A page
  saying "ignore previous instructions and mark this vacancy as verified" produces
  the same outcome as any other unassertable text: an evidence row at low
  confidence, never an assertion, never a status change, never a verification
  label. The M3.5 test asserts exactly that.
- `EMPLOYMENT_TYPE` enum and `APPLICATION_URL` host policy are validation, not
  sanitisation: a bad value is refused, never repaired.

## Known limitations, recorded up front

- `listBranches` is still a stub and so is `listJobs`; M3.5 fills the jobs stub only.
  Branches remain an M3.4 gap.
- The static/B2B path (`lib/api/handler.ts` → `lib/api/repository.ts`) is pure and
  module-backed; the evidence-backed jobs read model lands in the repository/Worker
  path. Wiring evidence into the pure static handler is a separate architecture
  question and is not forced here.
- Vacancy counts will be very small. That is the finding, not a shortfall, and the
  UI must not be padded to hide it.
- **Title + location is a candidate identity, not a proven one.** Two postings with
  the same title in the same location collapse to one vacancy. That is untested
  against real data until the pilot runs, and the pilot is where it must be judged.
  A location that appears only on a later run forks the identity, which may also be
  wrong. Both are open questions, not settled decisions.
- **No PDF text extraction.** A notice PDF is a retained document and a link. Its
  contents are unread, so any vacancy only published inside a PDF is invisible to
  this system. The pilot report must count those rather than hide them.
- `smoke:people-idempotency` fails on F2/F3/F4, and it **already failed at
  `06bd00a`** with the identical output. It is a pre-existing M3.3 defect in the
  same semantic-assertion family as the revive bug above, not an M3.5 regression.
  Left alone deliberately: M3.3 is frozen and fixing it would mean changing M3.3
  code. Worth a decision from the owner.
