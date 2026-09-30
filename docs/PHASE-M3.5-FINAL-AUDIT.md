# M3.5 Final Audit — Live Vacancy Discovery

**Date:** 2026-09-30
**Registry:** `data/pilot/career-source-registry.json` (generated 2026-09-30T06:40:43.679Z)
**Dynamic scan:** `data/pilot/career-dynamic-sources.json` (generated 2026-09-30T06:48:38.615Z)
**Evidence DB:** `data/pilot/evidence/pilot-careers-2026-09-29.db`
**Companion reports:** `PHASE-M3.5-CAREERS-DESIGN.md`, `PHASE-M3.5-LIVE-DISCOVERY.md`, `PHASE-M3.5-DYNAMIC-SOURCES.md`

## Decision: STATE B, with one correction to the earlier reports

**No deterministic, machine-readable vacancy source exists in this pilot.** The one
same-origin JSON endpoint that a generic adapter could be built on returns zero
vacancies. This closes the dynamic-source line of enquiry and is the finding the
milestone set out to test.

One earlier statement in these reports was wrong and is corrected here: the pilot is
**not** a clean sweep of zero vacancies. It found **one real vacancy notice** that a
human could apply from, at `mfi-012` Suryodaya Womi, and it is not machine-readable
in the sense that matters. Recording "zero everywhere" would have been as much of a
false claim as publishing a fabricated row.

## What was read

| Measure | Value | Limit |
| --- | --- | --- |
| Primary career pages | 29 | 29 |
| Same-host detail pages | 31 | — |
| Total pages read | **60** | 119 |
| Registry bytes | 6,445,993 | 11,534,336 |
| First-party scripts read | 45 | 45 |
| Endpoint probes | 5 | 24 |
| Dynamic-scan bytes | 12,950,506 | 16,777,216 |

Population coverage is complete: 60 of 60 pages in the registry were read, and 60 of
60 were also scanned for dynamic endpoints. The dynamic scan reports
`pages_in_registry: 60`, `pages_scanned: 60`, `sources: 60`.

The two JSON artifacts above are committed. The evidence database is not — it is a
binary file matched by `*.db` in `.gitignore` — so it is rebuilt by
`npx tsx scripts/run-career-pilot.ts` and is not inspectable from a fresh clone. The
counts in this document are all readable from the committed artifacts, which is why
they are quoted from those files rather than from the database.

## The one real vacancy, and why it is not published

`mfi-012` Suryodaya Womi Laghubitta Bittiya Sanstha Ltd. — `https://swmfi.com.np`

The homepage carries a card headed **"नायव प्रमुख कार्यकारी अधिकृत पदपूर्ति सम्बन्धी
सूचना !!!"** (notice of recruitment for Chief Executive Officer), anchored on the
role noun `अधिकृत`, with a same-origin link to the notice PDF.

Run through the real planning code, that record asserts exactly **two** fields:

| Field | Value | Confidence |
| --- | --- | --- |
| `JOB_TITLE` | the notice title above | 0.6 |
| `APPLICATION_URL` | `…/storage/website/notice/…pdf` | 0.5 |

There is no deadline, no location, no requirement, and no employment type in the HTML.
Those are in the PDF, which this milestone does not read. So the honest description is
"a real opening exists; two of its fields are machine-readable; the rest are not", and
publishing it would put a vacancy on the public site whose only actionable content is
a link to a file the site does not render.

## Institution conclusions (29 institutions)

| Conclusion | Institutions | Meaning |
| --- | --- | --- |
| `VACANCY_FOUND` | 1 | A notice was read; the remaining fields are in an unread document. |
| `VACANCY_EVIDENCE_UNREAD` | 9 | Vacancy documents exist; this system cannot read them. |
| `NO_VACANCY_EVIDENCE` | 19 | No vacancy evidence of any kind was found. |

14 unread vacancy documents are recorded across 10 institutions, including
advertisements dated July 2026, application syllabi for named posts, and a scanned
JPG notice.

`VACANCY_EVIDENCE_UNREAD` is the state that matters most. Publishing "no current
vacancy" for an institution whose vacancies are in an unread PDF would be a false
statement about a real institution.

## The dynamic sources: the test that was run and its result

Every one of the 60 pages was scanned for same-origin content endpoints, following
first-party script sources and the page's own request calls. Every candidate carries
its own verdict in the artifact (`probed`, `response_class`, `http_status`,
`content_type`, `vacancy_records_found`, `not_probed_reason`).

| Classification | Sources |
| --- | --- |
| `JSON_EMBEDDED` | 3 |
| `NO_ENDPOINT_FOUND` | 54 |
| `UNSUPPORTED` | 3 |
| `MACHINE_READABLE` / `HTML_FRAGMENT` / `BROWSER_REQUIRED` / `SESSION_REQUIRED` | 0 |

All 5 probes were spent, and all 5 are recorded with a verdict:

| Institution | Endpoint | Result |
| --- | --- | --- |
| `mfi-014` | `/content/Careers/7` | 200 JSON, `pagecontent: []` → 0 records, `envelopeShape: EMPTY` |
| `mfi-014` | `/content/Careers/7/Vacancy/17` | 200 JSON, 1 fragment → 0 records, off-site ATS pointer |
| `mfi-014` | `/content/Careers/7/Application%20Form/25` | 200 JSON → 0 records |
| `mfi-040` | `/like` | 404 `UNAVAILABLE` |
| `mfi-040` | `/career/syllabus/like` | 404 `UNAVAILABLE` |

The mapper's own warning on the first endpoint is worth keeping verbatim: *"endpoint
returned an empty envelope, which is not evidence that no vacancy exists."* An empty
`pagecontent` array is a page that has not been populated, not a page that is empty.

### The plain-HTTP ATS pointer, and why it was not followed

The `Vacancy/17` fragment carries exactly one field of substance, and the mapper
recorded its own verdict on it:

> `content links off-site (http://himalayanlaghubitta.rigojobs.com/) and carries no
> vacancy of its own; the vacancy is published elsewhere`

The fragment's full contents are a `mainlocation_id`, an `id`, a `sublocation_id`, a
`date` of `2025-10-16`, and that anchor. The link target is
`http://himalayanlaghubitta.rigojobs.com` — another organisation's site, over plain
HTTP. It was not fetched.

Reaching it would cross an ownership boundary and would require a policy decision on
plain-HTTP third-party sources, neither of which belongs to a parsing milestone.
Recording the pointer as evidence with no parsed fields is cheap and honest, and is
available immediately; **whether to cover an off-site ATS at all is the single open
product question from M3.5**, and it is unresolved by design.

> Note on a detail this audit initially got wrong: an earlier run of this
> investigation observed the deeper path
> `http://himalayanlaghubitta.rigojobs.com/vacancy/detail/17`. That path does not
> appear in the current artifact, and this document quotes only what the artifact
> above actually contains.

## A false positive this audit caught and fixed

The first pass over the live pages scored `mfi-012` as a **verified** vacancy source
with two records. One was real. The other was a card headed with the institution's
own registered name — "Suryodaya Womi Laghubitta Bittiya Sanstha Ltd." — carrying a
date and a contact email, which satisfied every anchor the card parser had.

`parseVacancyDetail` had always refused this shape, and its `detailAnchored` comment
records exactly this pilot failure. The **card path had no equivalent check**, so the
same mistake was still possible there.

`titleRejection` now refuses a title ending in a registration suffix (`Ltd`, `Limited`,
`Sanstha`, `LLP`, `Co-operative`, and the Nepali `सहकारी`/`समुदाय`), and every parser
path inherits it. The rule is a suffix rule on purpose: the same words appear inside
genuine notice titles, where refusing on substring would hide a real recruitment.

Five permanent assertions cover it (`V1.33a`–`V1.33g`), including the two that
matter most:

- a genuine notice whose title also ends in the entity name is still judged and kept;
- the real CAO posting from the same live page still yields exactly one record, with
  its title and its application link intact.

The fix is why this audit reports one vacancy rather than two. It is a change to
shared grammar behaviour, so it is called out here rather than buried in a commit.

## Response variance, and what a negative claim covers

Two runs disagreed about one Himalayan page. A run served a variant of the page with
no request call at all, and that run reported `NO_ENDPOINT_FOUND` where another
reported `JSON_EMBEDDED`.

Rather than smooth this over, the artifact now records, for every source, the
`page_bytes`, the SHA-256 `page_content_hash`, and a `classification_scope` field
stating that the verdict is a claim about **this response, at this hash**. A negative
is a negative for those bytes. It is not a claim about the institution's practices,
and a per-host aggregate across many runs would be a stronger statement than this
single-pass evidence supports.

The registry has the same property. Live page content moves: between two runs of the
same pilot, the detail-page shape tallies shifted
(`CAREER_VOCABULARY_ONLY` 13→14, `RECRUITMENT_RESULT_PAGE` 2→3, `UNREADABLE_BODY`
2→1). Every entry carries an explicit `page_shape` and a reason, so a shift is
visible rather than silent. Counts quoted in these reports are from the final runs
named at the top of this document.

## Consistency checks that are enforced, not assumed

| Check | Result |
| --- | --- |
| Registry entries with a blank `page_shape` | 0 |
| Entries with `status: UNREADABLE` and a readable shape | 0 |
| Documents correctly classified `DOCUMENT_NOT_HTML` | 2 (both HTTP 200) |
| `rendering_required` primary entries | 1 (corrected from 5) |
| Dynamic scan coverage | 60 / 60 |
| Vacancy records found by any probe | 0 |
| Vacancy assertions written to the evidence DB | 0, by design |

The `UNREADABLE` rule was fixed in this pass: `shapeOf` previously described the
*error page* returned by a 404 or 522 as if it were content, which put
`page_shape: NOT_A_CAREER_PAGE` next to `status: UNREADABLE` — a pairing that reads
as "this institution has no careers page" when the truth is "this request failed". A
non-2xx response is now always `UNREADABLE_BODY` with the status in the reason.

## Verification

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | 0 errors |
| `npm run smoke:careers` | 324 passed, 0 failed |
| `npm run prove:careers-json` | 79 / 79 |
| `npm run smoke:api` | 45 passed, 0 failed |
| `npm run build` | success |
| `npm run smoke:people-idempotency` | **30 passed, 3 failed** — pre-existing, unrelated |

The `people-idempotency` failures (F2/F3/F4) and the pre-existing `npm run lint`
errors are in files this milestone does not touch, and were failing before it began.
They are recorded here rather than fixed, because fixing them is a different
milestone's work.

`prove:careers-json` exercises the whole path in one process against the real schema:
payload → mapper → validation → SQLite writer → projection, over eight observations
covering replay idempotency, field-level supersession, resurrection refusal, source
agreement and disagreement, re-convergence, and the audit trail for every retirement
and revival.

## Frozen scope

Unmodified and verified unchanged: `schema/`, `migrations/`,
`data/pilot/pilot-budget.json`, frozen M3.3, frozen M3.4. The M3.5 budget used for
these runs is `data/pilot/career-pilot-budget.json`, a research budget.

## What is not established

Stated plainly, so the next milestone does not inherit a false premise:

1. **No publishable vacancy exists** from any source in this pilot. One notice is
   real and two of its fields are readable; the rest is a PDF.
2. **The 14 unread vacancy documents are unexamined.** No text was extracted from
   them. Each is a real recruitment that this system cannot see.
3. **19 institutions have no vacancy evidence of any kind.** That is a statement about
   this pass over these pages, not a statement that they are not recruiting.
4. **The plain-HTTP off-site ATS is unresolved**, and resolving it is a policy
   decision, not a technical one.
5. **Live content moves.** Every count here describes the runs named above, and the
   artifacts carry hashes so that claim is checkable.
