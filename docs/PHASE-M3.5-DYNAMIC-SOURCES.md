# M3.5 — Same-origin dynamic sources: investigation and decision

**Date:** 2026-09-30
**Question:** the pilot's shape heuristic suggested several career pages fetch their
vacancies from a same-origin JSON or data endpoint instead of serving HTML. If any
of them do, the vacancy can be read deterministically without a browser.

**Answer:** no. Not one of the 60 pages the pilot read exposes a same-origin
endpoint that contains a vacancy. One institution has a real same-origin JSON
endpoint, and it contains no vacancy.

Nothing here required a browser, an OCR pass, an LLM, or a human reading a
screenshot. That is the finding, not a workaround: `BROWSER_REQUIRED` was the
hypothesis under test and **no source met it**.

## What was done

Every page the pilot had already read was re-fetched through the same
`ControlledFetcher`, and its HTML and first-party JavaScript were read as text. No
script was executed. Endpoints were extracted by pattern from the source, resolved
to absolute URLs, and filtered to same-origin HTTPS. Candidates were then fetched
and their responses classified.

- Population: **60 of 60 pages** — 29 primary, 31 detail — not only the pages a
  heuristic flagged. A negative result therefore covers the whole population.
- Artifact: `data/pilot/career-dynamic-sources.json`
- Cost: 60 page fetches, 45 first-party-script fetches, 5 endpoint probes, 13,380,635
  bytes, leaving 3,396,581 of the declared 16,777,216. The budget is enforced in code
  (`MAX_BYTES_TOTAL = 16_777_216`), so an artifact reporting a full scan has paid for
  one.
- Records found across the entire pilot: **0**.

Every classification is a claim about **one response**, and each entry records the
byte count and the SHA-256 of the page it was derived from
(`page_bytes`, `page_content_hash`, `classification_scope`). This is not decoration:
repeating the run served a *different variant* of one Himalayan page that carried no
request call at all, and that run reported `NO_ENDPOINT_FOUND` for it. Two runs
disagreeing is only diagnosable if each says which bytes it looked at, so a negative
is a negative for those bytes and not a claim about the institution.

Discovery covers `fetch`, `$.ajax`/`get`/`getJSON`/`post`, `axios`, `XHR.open`,
`form.action`, and `data-*` attributes, and resolves a URL held in a variable
(`var url = "/content/Careers/7"; fetch(url)`), which is how the one real endpoint
is written. A literal is only resolved when it is the whole right-hand side of its
assignment: `'/api/' + id` resolves to nothing, because fetching `/api/` would be a
different request than the page makes.

## Results by classification

| Classification | Sources | What it means here |
| --- | --- | --- |
| `NO_ENDPOINT_FOUND` | 54 | Read, and no same-origin content endpoint is present in this response or its scripts. |
| `JSON_EMBEDDED` | 3 | Himalayan Laghubitta, all three endpoints. Real JSON, zero vacancies. |
| `UNSUPPORTED` | 3 | Two non-vacancy plugin endpoints, plus one page that could not be read. |
| `MACHINE_READABLE` | 0 | — |
| `HTML_FRAGMENT` | 0 | — |
| `BROWSER_REQUIRED` | 0 | — |
| `SESSION_REQUIRED` | 0 | — |

### The one real endpoint: `mfi-014`, Himalayan Laghubitta

| Endpoint | Response | Vacancies |
| --- | --- | --- |
| `GET /content/Careers/7` | 200 JSON, 19 B, `{"pagecontent":[]}` | 0 |
| `GET /content/Careers/7/Vacancy/17` | 200 JSON, 234 B, 1 item | 0 |
| `GET /content/Careers/7/Application Form/25` | 200 JSON, 477 B, 2 items | 0 |

The envelope is an object holding exactly one array, `pagecontent`, whose items
carry their content as an HTML string in `description`. That is a real, reusable
contract, and it is handled by a generic mapper in `lib/ingestion/career-json.ts`
that names no institution, host, or field.

The `Vacancy/17` item is the informative one. Its `description` is a paragraph
whose only content is a link to `http://himalayanlaghubitta.rigojobs.com` —
"Go to Online Vacancy". So the site publishes a vacancy *pointer*, not a vacancy.
The mapper reports that honestly:

- zero records,
- the off-site destination, unfollowed, as evidence,
- a warning that the vacancy is published elsewhere.

The off-site portal is plain HTTP on a third-party host, so the approved
same-origin HTTPS policy refuses it, and aggregating another organisation's ATS is
outside this milestone. Following that link is a product decision, not a parsing
one.

### The two rejected candidates

Every candidate the scan emits carries its own verdict in the artifact
(`response_class`, `http_status`, `content_type`, `vacancy_records_found`, and
`not_probed_reason` when the probe budget did not reach it). A candidate with no
verdict is an unreviewable claim, so there are none:

| Institution | Candidate | Verdict |
| --- | --- | --- |
| `mfi-040` Unique Nepal | `/like` | `UNAVAILABLE`, HTTP 404. A Facebook like button. |
| `mfi-040` Unique Nepal | `/career/syllabus/like` | `UNAVAILABLE`, HTTP 404. A Facebook like button. |

A third candidate that earlier runs recorded — `mfi-013`'s
`.../download-manager/assets/modal/'+(btn.action||index)+'`, a WordPress
download-manager UI string — is no longer emitted at all. It is a concatenation, not a
URL, and the attribute scan now refuses a literal that is either operand of a `+`
expression (`V1E.45`–`V1E.47`). Before that fix it was probed as if it were an
endpoint, which would have put a URL in the artifact that the page never requests.

## The "seven dynamic pages" were a measurement error

The heuristic that started this (`CAREER_CONTENT_CLIENT_LOADED`) counted
`$(document).ready`, which appears on 11 pages across 7 institutions. It was
measuring jQuery, not content. Read individually, those pages are:

| Institution | What the requests actually are |
| --- | --- |
| `mfi-001` Nirdhan | hover menu, apply-form navigation |
| `mfi-004` Swabhavani Bittiya | captcha refresh, e-mail subscription |
| `mfi-012` Swargadarshan Mahila | carousel and modal |
| `mfi-029` Support Microfinance | hover menu, dropdown |
| `mfi-038` Mahila Laghubitta Bittiya | dropdown, tabs |
| `mfi-041` Ujjwala Laghubitta | dropdown, tabs |
| `mfi-014` Himalayan Laghubitta | **the one genuine endpoint** |

The detector now counts request calls only, and excludes captcha, subscription,
search, authentication, and form submissions.
`data/pilot/career-source-registry.json` **has been regenerated** with the corrected
classification: 3 entries now carry `CAREER_CONTENT_CLIENT_LOADED` (1 primary, 2
detail, all `mfi-014`) instead of the stale 5, and `rendering_required` is true on
exactly 1 primary entry and 0 detail entries. Every entry in the registry now has an
explicit `page_shape`; there are no blanks, and any entry whose status is
`UNREADABLE` also has `page_shape: UNREADABLE_BODY` with the reason attached, so a
failed request can never be read as "no careers page here".

## Hostile input was tested, not assumed

`fixtures/careers/json-v1-*.json` and `scripts/smoke-careers-m35.ts` cover empty,
malformed, scalar, bare-array, two-array-key, missing-title, missing-deadline,
duplicate, changed-deadline, multi-location, unexpected-field, prompt-injection, and
markup-bearing payloads: **317 assertions, all passing** (`npm run smoke:careers`).

Three findings came out of writing them:

1. `constantStringIn` resolved `'/api/'` out of `var a = '/api/' + x`, which would
   have probed a URL the page never requests. It now requires the literal to be the
   whole right-hand side, and rejects interpolated templates.
2. A title reading `&lt;img src=x onerror=alert(1)&gt;Trainee Assistant` contains no
   `<` and passes any check that looks only for one, yet decodes to an `<img>` the
   moment it reaches `innerHTML`. The mapper now decodes for the *test* only and
   drops the record; the stored value is never rewritten.
3. The concatenation rule from (1) was applied to call sites but not to HTML
   attributes, so `data-url="/api/jobs/"+id` still produced a probeable candidate, and
   a malformed value could match as an expression fragment
   (`data-url='obj.action||'/api/x''` → `obj.action||`) and resolve to a URL with
   JavaScript in it. Both are refused now, with a reason, on both sides of the literal
   (`V1E.45`–`V1E.50`).

## The evidence chain, proved end to end

`scripts/prove-career-json-sqlite.ts` (`npm run prove:careers-json`) runs the whole
path in one process against the real `schema/schema.sql` — payload → mapper →
validation → `LocalSqliteEvidenceWriter` → SQLite → projection — and asserts **79
out of 79** checks across eight observations:

- the real Himalaya payload maps to zero vacancies, and the zero survives into the
  database and back out through the projection;
- a synthetic posting publishes one vacancy with four assertions, and a replay writes
  nothing new;
- a changed deadline supersedes one field, keeps the rest, and leaves the old value in
  history with a recorded reason;
- an observation that sees nothing resurrects nothing and deletes nothing;
- a second source agreeing raises no conflict; a second source disagreeing records an
  open conflict, overwrites neither value, and the read model then publishes **no**
  deadline and reports `CONFLICT`;
- when the sources converge the value is publishable again while the unresolved
  conflict stays on the record;
- every assertion traces to a source, a snapshot and a parser version, and every
  retirement and revival is audited with what changed, whose claim it was, and what
  evidence moved it.

## Decision

**Stop here. Do not build a dynamic vacancy adapter, and do not cut over `/jobs`.**

The brief's condition for continuing was a machine-readable response shape that a
generic adapter could use. There is one, and it maps to zero vacancies because the
site links away instead of publishing. A generic adapter built on it would import
nothing today and would add a JSON path, a probe budget, and a second grammar to
maintain in exchange.

What this leaves, unchanged and still correct:

- the 13 unread vacancy documents stay `DOCUMENT_EVIDENCE_ONLY` — real files, read
  structurally, no fabricated fields;
- the HTML grammar stays the single path to a vacancy;
- the fabricated rows in `src/data/jobs.ts` stay blocked, because nothing found here
  replaces them. They are gone: `src/data/jobs.ts` is now generated from current
  `VACANCY` assertions in the pilot database, which is empty, so the public list is
  empty by construction rather than by comment.

`/jobs` stays behind a 404 until real vacancies exist. Returning an empty truthful
list is preferable to publishing rows that were never advertised.

### The decision that is still open

Himalayan publishes vacancies, but on `rigojobs.com` over plain HTTP. Making those
visible means one of:

1. **Cover the off-site portal** — treat a named set of third-party ATS hosts as
   first-party sources. A product and policy decision: those pages belong to
   another organisation, the evidence chain crosses an ownership boundary, and the
   plain-HTTP transport must be addressed rather than waived.
2. **Keep the pointer** — store the "Go to Online Vacancy" link as evidence with no
   parsed fields, so the site is visibly present and honestly incomplete.
3. **Leave it** — 19 of the 29 institutions read have no vacancy evidence at all, so
   one institution's external portal does not change the shape of the problem.

Option 2 is cheap and safe and is available immediately. Option 1 is the only one
that produces a publishable vacancy from this source, and it should be decided on
its own merits, not as a side effect of a parsing milestone.

### Follow-ups this investigation did not do

- The entity-escaped title check lives in the JSON mapper. An HTML page can produce
  the same title, so the shared grammar should eventually carry the check too.
- The `mfi-013` host was unreachable in the first run of this investigation, so its
  WordPress pages were read only from the pilot's snapshot, not re-verified live. The
  later pilot run reached it, which is why its download-manager string is now
  discussed as a rejected candidate rather than an unread page.
- `NO_ENDPOINT_FOUND` is a per-response verdict. One Himalayan page served a variant
  with no request call in one run, so a per-host aggregate over many runs would be a
  stronger claim than a single pass. That is a different investigation, not a gap in
  this one.
