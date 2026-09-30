# M3.5 Live Career Discovery — Findings

**Run:** `npx tsx scripts/run-career-pilot.ts`
**Registry:** `data/pilot/career-source-registry.json`
**Snapshots:** `data/pilot/evidence/pilot-careers-2026-09-29.db` (content hash per response)
**Budget:** `data/pilot/career-pilot-budget.json` — research only; `data/pilot/pilot-budget.json` is untouched

## What this run was for

Find out, from real pages, whether a non-AI system can identify real vacancies in
Nepali microfinance career sites well enough to publish, and if not, say exactly
where the evidence stops. No field is inferred from a document, no page outside the
pilot's host allowlist was fetched, and no browser rendered anything.

## Usage

| Measure | Used | Limit |
| --- | --- | --- |
| Targets | 29 | 29 |
| Fetches | 60 | 119 |
| Bytes | 6,445,993 | 11,534,336 |
| Timeouts / redirects | 20,000 ms | max 5 |

29 primary career pages and 31 same-host detail pages were read.

## The headline result

**Exactly one vacancy was machine-readable across all 60 pages, and it carries no
publishable fields. That is the correct answer, not a parser failure.**

One institution, `mfi-012` Suryodaya Womi, publishes a real notice whose title and
application link are in the HTML — "नायव प्रमुख कार्यकारी अधिकृत पदपूर्ति सम्बन्धी
सूचना" (notice of recruitment for Chief Executive Officer) — and whose deadline,
requirements and everything else live in a PDF this system does not read. A posting
with a title and a link and nothing else is real evidence of a real opening, and it
is not yet a publishable vacancy. It is recorded as exactly that.

Every other institution that has published a recruitment has published it as a file
this system cannot read. The registry contains **52 distinct unread vacancy items
across 14 institutions** — 41 documents and 11 scanned images, deduplicated by URL
from 55 links observed (43 document + 12 image), because three URLs are linked from
two pages of the same institution each. They include advertisements dated July
2026, application syllabi for named posts, and a scanned JPG of a notice. The
system's job in that situation is to refuse to publish a job it cannot read, and to
distinguish that from an institution with no vacancies. It now does:

| Institution rollup (29 institutions) | Count |
| --- | --- |
| Vacancy notice read, fields not publishable | 1 |
| Vacancies this system can read and publish | **0** |
| Unread vacancy items — evidence exists, fields unknown | 13 |
| No vacancy evidence of any kind | 15 |

Those two numbers were wrong until this audit. The rollup counted **pages** rather
than documents, and only counted a page whose own status was already
`VACANCY_DOCUMENT_UNREAD` — so a page can carry six vacancy notices and, being
classified `CAREER_ROOT` or `RESULT_LIST` by its own text, report zero. It read as
14 documents across 10 institutions; the true figures are 52 across 14.

Four institutions moved out of "no vacancy evidence" as a result, and the reason is
worth naming because it is not the reason one would guess:

| Institution | Why the old rule saw nothing | Unread items now |
| --- | --- | --- |
| `mfi-005` | pages classified `CAREER_ROOT`, `RESULT_LIST`, `CAREER_PAGE_NO_CURRENT_VACANCY` | 6 |
| `mfi-013` | `CAREER_ROOT` + `RESULT_LIST` | 8, five of them scanned images |
| `mfi-016` | `CAREER_ROOT` + `RESULT_LIST` | 10 |
| `mfi-024` | a single page classified `DOCUMENT_SOURCE` | 1 |

Not one of them had a page whose status was `VACANCY_DOCUMENT_UNREAD`. The bug was
never that images were invisible — that part of the rule is also wrong, and it is
fixed, but it moved no institution in this artifact, because `mfi-001`, `mfi-045` and
`mfi-047` do have scanned notices and were already counted. The bug was keying the
count off a page's *classification* instead of off the *evidence it links*.
`mfi-024` is the clearest case: one page whose whole job is to be a document source
contributed zero, because nothing asked the page what it linked to.

The count is now taken from the evidence links themselves and deduplicated by URL,
in `scripts/run-career-pilot.ts` and, for the committed artifact, in
`scripts/recompute-career-registry-rollup.ts`.

`VACANCY_DOCUMENT_UNREAD` is the state that matters. Publishing "no current
vacancy" for an institution whose vacancies are in an unread PDF would be a false
statement about a real institution, and it is the specific failure this pilot was
built to prevent.

### A false positive this audit caught

The run initially scored `mfi-012` as a **verified** vacancy source on the strength of
two records. One was real. The other was a card headed with the institution's own
registered name — "Suryodaya Womi Laghubitta Bittiya Sanstha Ltd." — carrying a date
and a contact email, which satisfied every anchor the card parser had. No posting is
named after the legal entity that employs it, so `titleRejection` now refuses a title
that ends in a registration suffix (`Ltd`, `Sanstha`, `Co-operative`, and the
Nepali equivalents), and the card path inherits the rule that `parseVacancyDetail`
already had. Five permanent assertions cover it, including the case that matters
most: a genuine notice whose title also ends in the entity name is still kept, and so
is the real CAO posting from the same page. That fix is why the count above is 1 and
not 2.

## Primary pages

| Institution | URL | HTTP | Shape | Status | Note |
| --- | --- | --- | --- | --- | --- |
| `mfi-001` | [www.nirdhan.com.np](https://www.nirdhan.com.np) | 200 | `CAREER_VOCABULARY_ONLY` | `VACANCY_DOCUMENT_UNREAD` | — |
| `mfi-003` | [www.chhimekbank.org](https://www.chhimekbank.org) | 522 | `UNREADABLE_BODY` | `UNREADABLE` | host-side 522 origin timeout |
| `mfi-047` | [career.matribhumimf.com.np](https://career.matribhumimf.com.np) | 200 | `CAREER_VOCABULARY_ONLY` | `VACANCY_DOCUMENT_UNREAD` | — |
| `mfi-030` | [www.aarambhachautari.com](https://www.aarambhachautari.com) | 200 | `CAREER_VOCABULARY_ONLY` | `CAREER_ROOT` | — |
| `mfi-049` | [aatmanirbhar.com.np/career](https://aatmanirbhar.com.np/career) | 200 | `SINGLE_VACANCY_DETAIL` | `CAREER_PAGE_NO_CURRENT_VACANCY` | — |
| `mfi-031` | [ashamicrofinance.com.np/vacancy-2](https://ashamicrofinance.com.np/vacancy-2) | 200 | `SINGLE_VACANCY_DETAIL` | `CAREER_PAGE_NO_CURRENT_VACANCY` | career portal is HTTP-only on :70, refused |
| `mfi-002` | [www.deproscbank.com.np](https://www.deproscbank.com.np) | 200 | `CAREER_VOCABULARY_ONLY` | `CAREER_ROOT` | — |
| `mfi-004` | [www.swbbl.com.np](https://www.swbbl.com.np) | 200 | `CAREER_VOCABULARY_ONLY` | `CAREER_ROOT` | one career word in a menu; the `/career` detail page is read separately |
| `mfi-005` | [www.skbbl.com.np](https://www.skbbl.com.np) | 200 | `SINGLE_VACANCY_DETAIL` | `CAREER_ROOT` | — |
| `mfi-006` | [www.nerudemirmire.com.np/career](https://www.nerudemirmire.com.np/career) | 200 | `SINGLE_VACANCY_DETAIL` | `CAREER_PAGE_NO_CURRENT_VACANCY` | — |
| `mfi-010` | [www.kalikabank.com.np/career](https://www.kalikabank.com.np/career) | 200 | `CAREER_VOCABULARY_ONLY` | `CAREER_PAGE_NO_CURRENT_VACANCY` | — |
| `mfi-011` | [www.jucbank.com.np/categories/career](https://www.jucbank.com.np/categories/career) | 200 | `CAREER_VOCABULARY_ONLY` | `CAREER_PAGE_NO_CURRENT_VACANCY` | — |
| `mfi-012` | [swmfi.com.np](https://swmfi.com.np) | 200 | `SINGLE_VACANCY_DETAIL` | `VACANCY_SOURCE_VERIFIED` | **the one real vacancy**; 4 more unread items behind it |
| `mfi-013` | [laxmilaghu.com.np](https://laxmilaghu.com.np) | 200 | `SINGLE_VACANCY_DETAIL` | `CAREER_ROOT` | recovered from the 522 an earlier run saw; 422 KB, role nouns but no anchored record, 8 unread items |
| `mfi-014` | [himalayanlaghubitta.com/page/careers/7](https://himalayanlaghubitta.com/page/careers/7) | 200 | `CAREER_CONTENT_CLIENT_LOADED` | `UNSUPPORTED` | vacancy table is populated by script |
| `mfi-016` | [nmbmicrofinance.com](https://nmbmicrofinance.com) | 200 | `SINGLE_VACANCY_DETAIL` | `CAREER_ROOT` | — |
| `mfi-017` | [forwardmfbank.com.np/index.php/careers](https://forwardmfbank.com.np/index.php/careers) | 200 | `CAREER_VOCABULARY_ONLY` | `VACANCY_DOCUMENT_UNREAD` | 2 unread vacancy documents |
| `mfi-019` | [www.mslbsl.com.np/career/online-registration](https://www.mslbsl.com.np/career/online-registration) | 404 | `UNREADABLE_BODY` | `UNREADABLE` | path not found; the body is an error page, not a career page |
| `mfi-022` | [www.rsdcmf.com](https://www.rsdcmf.com) | 200 | `SINGLE_VACANCY_DETAIL` | `CAREER_ROOT` | — |
| `mfi-023` | [www.slbsl.com.np/uploads/career/slbs_finalresultlist.pdf](https://www.slbsl.com.np/uploads/career/slbs_finalresultlist.pdf) | 200 | `DOCUMENT_NOT_HTML` | `DOCUMENT_SOURCE` | a result list, correctly not a vacancy |
| `mfi-024` | [nationalmicrofinance.com.np/assets/uploads/files/career/Vacancy3.pdf](https://nationalmicrofinance.com.np/assets/uploads/files/career/Vacancy3.pdf) | 200 | `DOCUMENT_NOT_HTML` | `DOCUMENT_SOURCE` | 1 unread vacancy document |
| `mfi-029` | [www.supportmicrofinance.com.np/career](https://www.supportmicrofinance.com.np/career) | 200 | `CAREER_VOCABULARY_ONLY` | `VACANCY_DOCUMENT_UNREAD` | 10 unread vacancy documents |
| `mfi-035` | [swabhimaanlaghubitta.com.np/careers](https://swabhimaanlaghubitta.com.np/careers) | 200 | `SINGLE_VACANCY_DETAIL` | `CAREER_PAGE_NO_CURRENT_VACANCY` | — |
| `mfi-038` | [www.mlbsl.com.np](https://www.mlbsl.com.np) | 200 | `SINGLE_VACANCY_DETAIL` | `CAREER_ROOT` | — |
| `mfi-040` | [uniquenepalmicrofinance.com.np/career](https://uniquenepalmicrofinance.com.np/career) | 200 | `SINGLE_VACANCY_DETAIL` | `CAREER_PAGE_NO_CURRENT_VACANCY` | — |
| `mfi-041` | [www.ulbsl.com.np](https://www.ulbsl.com.np) | 200 | `CAREER_VOCABULARY_ONLY` | `CAREER_ROOT` | one career word in a menu; the `/career` detail page is read separately |
| `mfi-042` | [dhaulagiribank.com](https://dhaulagiribank.com) | 200 | `CAREER_VOCABULARY_ONLY` | `CAREER_ROOT` | — |
| `mfi-045` | [swastiklbs.com.np/vacancy](https://swastiklbs.com.np/vacancy) | 200 | `CAREER_VOCABULARY_ONLY` | `VACANCY_DOCUMENT_UNREAD` | notice is a scanned JPG |
| `mfi-048` | [jeevanbikasmf.com/career](https://jeevanbikasmf.com/career) | 200 | `CAREER_VOCABULARY_ONLY` | `CAREER_PAGE_NO_CURRENT_VACANCY` | — |

Detail pages (31 read): 16 `CAREER_PAGE_NO_CURRENT_VACANCY`, 9 `VACANCY_DOCUMENT_UNREAD`,
2 `UNSUPPORTED`, 3 `RESULT_LIST`, 1 `UNREADABLE`. Shapes: 14 `CAREER_VOCABULARY_ONLY`,
11 `SINGLE_VACANCY_DETAIL`, 2 `CAREER_CONTENT_CLIENT_LOADED`, 3
`RECRUITMENT_RESULT_PAGE`, 1 `UNREADABLE_BODY`. No detail page produced a vacancy
record, which is why the single real vacancy came from a career root.

## Evidence that exists but cannot be published

Files observed and retained as evidence, with no field extracted from any of them:

- `nmbmicrofinance.com/Careers/2026/7/NMB Laghubitta Vacancy ad 3x17-202607291059489205.pdf`
  — a vacancy advertisement dated 29 July 2026, plus a waiting list and an exam-centre notice for the same round
- `dhaulagiribank.com/wp-content/uploads/2026/07/Vacancy-2082-2083-internal-comp.pdf` — July 2026
- `jucbank.com.np/public/storage/careers/August2026/erlQ7KqXU9HhYc4jN9ug.pdf` — opaque filename, `careers` directory
- `swmfi.com.np/storage/website/career/.../application_syllabus-*.pdf` — three application syllabi for named assistant posts
- `nirdhan.com.np/wp-content/uploads/2016/08/Vacancy-Announcement-ME-Officer.pdf`
- `deproscbank.com.np/assets/uploads/files/media/...vacancy...2083...pdf` — two notices
- `skbbl.com.np/storage/career/2026/...` — six notices
- `swabhimaanlaghubitta.com.np/.../Recruitment-notice-2081-Jestha.pdf`
- `forwardmfbank.com.np/...` — two notices
- `swastiklbs.com.np/.../Vacancy-Notice-Bhadra-2083_page-0001-scaled.jpg` — an image, not text

Document roles are read from the URL and are distinguishable without opening a
single file: `VACANCY`, `RESULT`, `FORM`, `ROUTINE`. `slbsl_finalresultlist.pdf` and
`Short List of Internal Vacancy.pdf` are results, not openings; they are excluded
from vacancy evidence. `application_syllabus-*.pdf` and `Internal Vacancy Form.pdf`
are forms, not openings. That distinction is why the pilot reports no open vacancies
at all: the 52 unread items it found are counted as evidence, not as openings, and
none of them has been read well enough to say what it opens.

## Four findings that changed the system

**1. A link label is not a vacancy.** `deproscbank.com.np/en/main/pages/vacancy/`
has one visible item, "Notice Regarding Recruitment of Assistant Trainees", and it
is the label of a link to a PDF. It was read as a vacancy, which promoted a bank
with no readable vacancy to `VACANCY_SOURCE_VERIFIED` and hid the two real vacancy
documents underneath. A title that *opens* with a document word — `Notice`,
`Announcement`, `PDF`, `Download` — is now a document. Anchored to the start only,
so "Trainee Officer - Notice of Vacancy" is still a posting.

**2. An opaque filename can still be a vacancy notice.** `jucbank` publishes
`/public/storage/careers/August2026/erlQ7KqXU9HhYc4jN9ug.pdf`. The filename says
nothing; the directory says careers. Classification reads the whole path, with
`RESULT` and `FORM` still checked first so a shortlist under the same directory
stays a result.

**3. "No vacancies" and "we cannot see their vacancies" are different.**
`himalayanlaghubitta.com/page/careers/7/vacancy/17` returns a real page — navigation,
headings, a footer with an address and phone number — containing the single word
"Vacancy", and then populates its table from an inline `$(document).ready` request.
Before this run it would have been published as "no current vacancy", a claim about a
real institution that the response cannot support. Pages that fetch their own rows
are now `CAREER_CONTENT_CLIENT_LOADED`, an unknown state. Four homepages — nirdhan,
chhimekbank, swbbl, ulbsl — were nearly caught by this rule: each has one career
word in a menu and a jQuery `ready` for the menu itself, and each would have been
declared unreadable when the correct action is to follow its Career link. Navigation,
header, footer, aside, and menu-classed elements are therefore excluded from
career-section measurement. A strip that would remove more than 60% of the text is
discarded as an unbalanced-markup mis-parse.

**4. A refusal is a finding.** `vacancy.ashamicrofinance.com.np:70` is a career page
served over plain HTTP. The controlled fetcher refused it
(`[hop 0] non-HTTPS protocol http: is blocked`) and the page is recorded as
unreadable with the reason attached. It was not fetched anyway, and it was not
recorded as an institution without vacancies.

## Why "unreadable" is never "no vacancies"

Three of 29 primary pages could not be read, for three different reasons, and none
of them is reported as an empty career page:

- `chhimekbank.org`, `laxmilaghu.com.np` — HTTP 522, the origin timed out behind
  Cloudflare. Host-side and intermittent; both returned 200 on an earlier run of the
  same pilot. They will be re-read on a later run rather than remembered as empty.
- `mslbsl.com.np/career/online-registration` — 404. The career path in the registry
  no longer exists. Recorded, not corrected, because inventing a replacement path is
  not this system's business.

## The state of the product, stated plainly

With this pilot's evidence, the `/jobs` page would show an empty state for all 29
institutions. That is the honest rendering of what was found, and it is a real
finding: **a vacancy pipeline that reads HTML only will publish nothing for this
sector**, because this sector publishes vacancies as files. Shipping that empty
state while the rest of the site shows invented jobs would be worse than the status
quo, so the API/UI cutover is not the next step — the decision about documents is.

Three things can be done with the 52 retained unread items, and only the first is
mechanical:

1. **Retain and show the evidence.** A `DOCUMENT_EVIDENCE_ONLY` projection can link
   each institution to the exact vacancy document, dated, with its role. No field is
   extracted, so nothing can be wrong about a title or a deadline. This is
   achievable now and is the only option that is honest today.
2. **Reviewed extraction.** A person reads the document and a structured row is
   entered with the document as its source. Slower, but every field has a human
   behind it and a citable document behind them.
3. **Same-origin JSON.** Seven pages *appeared* to fetch their vacancies from an
   endpoint rather than a file. **This was tested and refuted** — see
   `PHASE-M3.5-DYNAMIC-SOURCES.md`. The seven were `$(document).ready` false
   positives. All 60 pages were scanned statically: one institution has a real
   same-origin JSON endpoint, it contains no vacancy, and it links to a third-party
   portal over plain HTTP. Zero machine-readable vacancies were found in any JSON
   response, so this option is closed for the dynamic sources. The one real vacancy
   notice found anywhere in the pilot was in HTML, and its fields are in a PDF.

Automated text extraction from the PDFs — including OCR for the scanned notice — is
out of scope for this phase, by the standing constraint that no vacancy field is
inferred from a document.

## Reproducing

```sh
node node_modules/typescript/bin/tsc --noEmit   # 0 errors
npm run smoke:careers                            # 324 passed, 0 failed
npm run prove:careers-json                       # 158/158, includes the real mfi-012 record
npm run check:discipline                         # no violations
npx tsx scripts/run-career-pilot.ts              # re-crawls; a new run is a new observation
npm run recompute:career-registry                # offline: reapplies the rollup rule to the committed artifact
M35_SCOPE=all npx tsx scripts/inspect-dynamic-career-sources.ts
```

`run-career-pilot.ts` fetches live pages, so re-running it produces a *different*
artifact — that is what makes the observation record worth keeping. The rollup
correction described above is applied to the committed registry by
`recompute:career-registry`, which reads the file, recomputes only the derived
per-institution totals, and copies every observation field through untouched.

Every failure above is a permanent regression case in `scripts/smoke-careers-m35.ts`,
recorded with the real URL that produced it.
