# M3.5 Final Audit — Live Vacancy Discovery

Artifacts this audit describes, all committed:

| Artifact | What it is |
| --- | --- |
| `data/pilot/career-source-registry.json` | 60 live pages read and classified, generated `2026-09-30T06:40:43.679Z` |
| `data/pilot/career-dynamic-sources.json` | the same 60 pages scanned for same-origin JSON endpoints, generated `2026-09-30T06:48:38.615Z` |
| `data/pilot/evidence/pilot-careers-2026-09-29.db` | the pilot's own SQLite database — 60 snapshots, zero assertions |
| `fixtures/careers/live-mfi-012-root.html` | byte-exact capture of the one real vacancy page, 70,755 bytes |
| `fixtures/careers/live-mfi-012-root.meta.json` | its hash, HTTP metadata, and the parser result it must keep producing |
| `scripts/prove-career-json-sqlite.ts` | 158 executable checks over the production path, including that record |

Every figure below is read out of those files, or out of a run of the script named
beside it. Where the artifact and the run output disagree — and one figure in here
does — the difference is stated rather than smoothed over. Where a number was wrong
when this audit started, the correction and its cause are given, not quietly applied.

## 1. Objective

Establish, from real public pages, whether this system can identify and represent
real Nepali microfinance vacancies well enough to publish — and if not, say exactly
where the evidence stops. No field is inferred from a document, no page outside the
pilot's host allowlist was fetched, and no browser rendered anything.

## 2. Scope and exclusions

Not done, by standing constraint and by decision:

- No OCR, and no text extracted from any PDF or image. A file is evidence, not a source of fields.
- No AI or LLM anywhere in the path.
- No browser automation, no JavaScript execution. Pages that populate themselves were classified `CAREER_CONTENT_CLIENT_LOADED` and left unresolved.
- No credentials, cookies, or session replay.
- Same-origin HTTPS only. One plain-HTTP career portal was refused, not fetched.
- No institution-specific parsing. No rule in the codebase names `mfi-012`, `swmfi.com.np`, or this notice.
- No production configuration, no D1, no deployment. `schema/`, `migrations/`, `data/pilot/pilot-budget.json`, M3.3 and M3.4 are untouched.
- No fabricated jobs, at any stage.

## 3. Architecture completed

| Stage | Where | State |
| --- | --- | --- |
| Discovery | `scripts/run-career-pilot.ts` | 29 primary + 31 detail pages, classified, budget-enforced |
| HTML grammar | `lib/ingestion/careers.ts` | anchored record extraction, document-role classification, identity rules |
| Evidence planning | `lib/ingestion/career-evidence.ts` | per-field confidence, evidence-only flags, refusal reasons |
| SQLite writer | `lib/ingestion/adapters/local.ts` | assertions, snapshots, conflicts, audit log |
| Read model | `lib/repository/projection.ts` | status lifecycle, suppression of omittable disputed fields, re-convergence |
| JSON mapper | `lib/ingestion/career-json.ts` | conservative envelope reading |
| Generator | `scripts/build-jobs-module.ts` | public Jobs list from current `VACANCY` assertions only |

## 4. Live career-source universe

29 institutions, 60 pages read, 119 fetch budget. One vacancy record exists in the entire population.

| Conclusion | Institutions | Meaning |
| --- | --- | --- |
| `VACANCY_FOUND` | 1 | a notice was read; the rest of its fields are in a file this system does not read |
| `VACANCY_EVIDENCE_UNREAD` | 13 | unread vacancy items exist; the fields are unknown |
| `NO_VACANCY_EVIDENCE` | 15 | no vacancy evidence of any kind was found |

**52 distinct unread vacancy items across 14 institutions.** The arithmetic behind that number, because "52" and "55" are both true and mean different things:

| | Count |
| --- | --- |
| Link occurrences across all pages | 55 (43 document links + 12 scanned-image links) |
| URLs that appear on more than one page of the same institution | 3 |
| **Unique unread items** | **52** (41 documents + 11 images) |

The three repeats are one `swastiklbs.com.np` notice image and two `deproscbank.com.np` notices, each linked from two pages of its own institution. Counting occurrences would report the same unread file three times, which is how an institution can look busier than it is.

That figure was wrong when this audit began, in two separate ways:

- The rollup counted **pages**, not documents, and reported the page count in a field named `unread_vacancy_documents`.
- It counted a page only when that page's own status was already `VACANCY_DOCUMENT_UNREAD`. So it keyed the count off a page's *classification* rather than off the *evidence the page links to*.

Reconstructing the old rule against this artifact reproduces its old output exactly — 9 institutions unread, 19 with no evidence — which is what makes the difference attributable:

| Institution | Its pages' statuses | Unread items now |
| --- | --- | --- |
| `mfi-005` | `CAREER_ROOT`, `RESULT_LIST`, `CAREER_PAGE_NO_CURRENT_VACANCY` | 6 |
| `mfi-013` | `CAREER_ROOT`, `RESULT_LIST` | 8 (5 scanned images) |
| `mfi-016` | `CAREER_ROOT`, `RESULT_LIST` | 10 |
| `mfi-024` | `DOCUMENT_SOURCE` | 1 |

These four are the whole of the difference. Not one of them had a page whose status was `VACANCY_DOCUMENT_UNREAD`. `mfi-024` is the clearest instance: a single page whose entire role is to be a document source contributed zero, because nothing asked the page what it linked to.

Scanned notice images were also invisible to the old rule, since it read only a document list. That part is fixed too — the count now includes images — but it changed no conclusion in this artifact, and the audit does not claim it did: `mfi-001`, `mfi-045` and `mfi-047` do carry scanned notices and were already counted. Stating that honestly matters more than having a tidier story about why the count was low.

The count is now taken from the evidence links themselves, deduplicated by URL, in `scripts/run-career-pilot.ts`. For the committed artifact, `scripts/recompute-career-registry-rollup.ts` applies the same rule **offline**, rewriting only the derived rollup and the three summary counters that depend on it. Every observation field — URL, HTTP status, content hash, page shape, record count, timestamp — is copied through byte-identical, verified by diff. Re-crawling was rejected as the way to fix it: it would have replaced one observation record with a different one, and the audit refers to a specific crawl.

Note the field name says `documents` while the count includes images. The name predates the correction and was kept for compatibility; the field counts unread vacancy *items*, of which 11 are scanned images. Renaming it would be a breaking change to a committed artifact for no analytical gain, so the definition lives in the audit and in the script that computes it.

## 5. Dynamic endpoint investigation

Whether official same-origin endpoints behind these career pages expose deterministic machine-readable vacancy data.

- Population: **60 of 60 pages** — 29 primary, 31 detail — not only the pages a heuristic flagged. The artifact records this itself (`scope.mode: "all"`, `pages_scanned: 60`). A negative result therefore covers the whole population.
- Records found: **0**.

On cost, precisely, because the artifact and the run log do not say the same thing and conflating them would overstate the evidence:

| | Value | Where it is recorded |
| --- | --- | --- |
| Page bytes actually read and persisted | 6,030,709 | `page_bytes` on each of the 60 entries — the artifact |
| Probe bytes | 12,036 | `probes[].bytes` — the artifact |
| Byte ceiling | 16,777,216 | `constraints.max_bytes` — the artifact |
| Script-fetch ceiling | 45 | `MAX_SCRIPT_FETCHES` in `inspect-dynamic-career-sources.ts` — the code |
| Total bytes spent this run, including scripts | 12,950,506 (3,826,710 left) | the run's console output — **not persisted** |

So the committed artifact proves the population, the per-page hashes, and the ceiling; the 12,950,506 figure is a number from one run's stdout and cannot be re-derived from the file. The 45 script fetches are a ceiling the code enforces, not a count the artifact records. Both are stated here rather than presented as artifact facts.

Each entry records the byte count and SHA-256 of the page it was derived from (`page_bytes`, `page_content_hash`, `classification_scope`). That is not decoration: repeating the run served a *different variant* of one Himalayan page carrying no request call at all, and that run reported `NO_ENDPOINT_FOUND`. Two runs can only be compared when each says which bytes it looked at, so a negative is a negative for those bytes and not a claim about the institution.

Discovery covers `fetch`, `$.ajax`/`get`/`getJSON`/`post`, `axios`, `XHR.open`, `form.action`, and `data-*` attributes, and resolves a URL held in a variable — which is how the one real endpoint is written. A literal resolves only when it is the whole right-hand side of its assignment: `'/api/' + id` resolves to nothing, because fetching `/api/` would be a request the page never makes.

## 6. Endpoint classification

| Classification | Pages | What it means here |
| --- | --- | --- |
| `NO_ENDPOINT_FOUND` | 54 | read, and no same-origin content endpoint in this response or its scripts |
| `JSON_EMBEDDED` | 3 | Himalayan Laghubitta; all three endpoints real JSON, zero vacancies |
| `UNSUPPORTED` | 3 | two `data-url` candidates that 404, plus one page that could not be read |
| `MACHINE_READABLE` | 0 | — |
| `HTML_FRAGMENT` | 0 | — |
| `BROWSER_REQUIRED` | 0 | — |
| `SESSION_REQUIRED` | 0 | — |

All 5 probes are accounted for: three on the Himalayan endpoints below, and two on `mfi-040` candidates `https://uniquenepalmicrofinance.com.np/like` and `…/career/syllabus/like`, both **404**. Those two are the clearest argument for the constant-resolution rule: their `source_literal` is the bare string `like` (a reaction widget's attribute value), `resolved_via_constant: false`, and treating `like` as a path would have produced a fetch the page never makes. Zero mapped vacancy records, from any page, in any response.

## 7. Himalayan JSON finding

`mfi-014` Himalayan Laghubitta Bittiya Sanstha publishes vacancies on `rigojobs.com`. Its own site is the only source in this pilot that carries real same-origin JSON content endpoints, and there are three. All three returned **200 `application/json`**, all three wrap their payload in a single `pagecontent` array, and **all three map to zero vacancies**:

| Endpoint | Bytes | Envelope | Items | Vacancies |
| --- | --- | --- | --- | --- |
| `/content/Careers/7` | 19 | `EMPTY` | 0 | 0 |
| `/content/Careers/7/Vacancy/17` | 234 | `SINGLE_ARRAY_KEY` | 1 | 0 |
| `/content/Careers/7/Application%20Form/25` | 477 | `SINGLE_ARRAY_KEY` | 2 | 0 |

The three cases are different failures and worth separating:

- **`/content/Careers/7`** is genuinely empty — `{"pagecontent": []}`. The mapper flags this rather than treating it as an answer, with the warning that *an empty envelope is not evidence that no vacancy exists*. That distinction is the whole point of `UNREADABLE`; a page that returned nothing must not be reported as a page with no vacancies.
- **`/content/Careers/7/Vacancy/17`** is the one that matters, and it is not empty. It carries one content row dated `2025-10-16` whose entire content is a link: `"Go to Online Vacancy"`, pointing off-site at `http://himalayanlaghubitta.rigojobs.com`. So the endpoint named for vacancy 17 is real, reachable, and empty of vacancy data *because the vacancy is published somewhere else* — the artifact's own warning says exactly that. This is the deferred ATS pointer, found as a fact rather than as an assumption.
- **`/content/Careers/7/Application%20Form/25`** carries two content rows pointing at a downloadable notice on the institution's own `/page/notices`. Documents, not vacancies.

The endpoint exists, responds, and is genuinely machine-readable. It carries no vacancy. The site links away to the portal instead of publishing its own rows.

Two corrections to earlier wording, because the difference is a factual claim:

- The artifact records the off-site target as a **prose warning plus the literal origin** `http://himalayanlaghubitta.rigojobs.com/` inside a response excerpt. There is no `OFF_SITE_HTTP_ATS_POINTER` token and no `/vacancy/detail/17` path anywhere in either artifact — verified by search. The mapper's deeper test path lives only in its own test fixture, which is where it belongs.
- A generic JSON adapter for these sites is **not** justified. It would import nothing today and would add a JSON path, a probe budget, and a second grammar to maintain.

## 8. Real `mfi-012` vacancy finding

One real vacancy was machine-readable across all 60 pages. It is a static HTML page, not a dynamic source, and it is real evidence of a real opening.

| | |
| --- | --- |
| Institution | `mfi-012` — Suryodaya Womi Laghubitta Bittiya Sanstha Ltd. (`suryodaya-womi-laghubitta-bittiya-sanstha-ltd`) |
| Source | `https://swmfi.com.np/` — `swmfi-website` |
| Observed | `2026-09-30T07:30:50.780Z` |
| HTTP / MIME | 200 `text/html; charset=UTF-8` |
| SHA-256 | `9c8a03b593a3204d33a0b5db0682eb575af3f1a3d9b61b2f327eaf68e4b59070` (70,755 bytes) |
| Page shape | `SINGLE_VACANCY_DETAIL` — one anchored record, no list structure |
| Parser | `careers-html-v1`, the shared grammar; no rule names this institution |
| Entity id | `vacancy-mfi-012\|नयव परमख करयकर अधकत पदपरत समबनध सचन\|` |

Exactly two fields are proven:

| Field | Value | Confidence |
| --- | --- | --- |
| `JOB_TITLE` | `नायव प्रमुख कार्यकारी अधिकृत पदपूर्ति सम्बन्धी सूचना !!!` | 0.6 |
| `APPLICATION_URL` | the same-origin HTTPS link to the notice PDF, filename `!!!-2026-09-30-147766.pdf` | 0.5 |

**Not proven, and not asserted:** deadline, location, employment type, salary, requirements, education, experience, contact email. Those live inside the PDF, which this system does not read. The planner emits two assertions and refuses to invent the rest, and checks L17–L19 assert that absence explicitly.

The same 70,755-byte response has been hashed three times and differs every time:

| Observation | Time | SHA-256 |
| --- | --- | --- |
| Registry | `06:39:54.949Z` | `2f754d6e491d8c78…` |
| Dynamic scan | `06:48:38.615Z` | `85316027b5fa0cda…` |
| Proof capture | `07:30:50.780Z` | `9c8a03b593a3204d…` |

Identical length, different bytes. The site varies its response between requests — rotating assets, not different vacancies. This is the reason every classification in this phase is scoped to one response, and the reason the proof is hash-pinned to a capture rather than to a URL.

## 9. False-positive correction

`swmfi.com.np/careers` produced a card headed with the institution's own registered name — "Suryodaya Womi Laghubitta Bittiya Sanstha Ltd." — carrying a date and a contact email, which satisfied every anchor the card parser had. It is not a vacancy. No posting is named after the legal entity that employs it.

`titleRejection` now refuses a title ending in a registration suffix (`Ltd`, `Sanstha`, `Co-operative`, and the Nepali equivalents), and the card path inherits the rule `parseVacancyDetail` already had. The real CAO notice from the same institution is kept. That is why the count is 1 and not 2.

Covered by `V1.33a`–`V1.33g`, including the case that matters most: a genuine notice whose title also ends in the entity name still survives.

## 10. JSON mapper

`shapeOf` and the envelope mapper are deliberately narrow.

| Situation | Reported as |
| --- | --- |
| non-2xx response | `UNREADABLE_BODY`, with the status in the reason |
| 0 bytes, or a 3xx body | `UNREADABLE_BODY` |
| 200 `application/pdf` | `DOCUMENT_NOT_HTML` — a real file, no fields |
| 200 HTML | classified by anchors and list structure |
| rows fetched by the page's own script | `CAREER_CONTENT_CLIENT_LOADED` — unknown, never empty |

`UNREADABLE` now always carries `page_shape: UNREADABLE_BODY`, so a failed request can never be read as "no careers page here". This corrected `mfi-003` (HTTP 522) and `mfi-019` (HTTP 404), which previously reported `NOT_A_CAREER_PAGE` beside `UNREADABLE` — a pairing that reads as a judgement about content when nothing was read.

Three findings came out of writing the hostile-input tests: `constantStringIn` resolved `'/api/'` out of `var a = '/api/' + x`, which would have probed a URL the page never requests; an entity-escaped title containing no `<` decoded to an `<img onerror>` the moment it reached `innerHTML`; and the concatenation rule was applied to call sites but not to HTML attributes, so `data-url="/api/jobs/"+id` still produced a probeable candidate. All three are fixed and permanently asserted.

## 11. SQLite evidence proof

`npm run prove:careers-json` — **158 checks, all passing**. Every variant record in section L is produced by re-running the real grammar over modified local bytes, not by hand-editing a parsed object, so the proof cannot assert something the parser would never emit. Two temporary databases are used; the real pilot database is opened read-only and never written.

The one real record, carried through the production path end to end:

- entity id `vacancy-mfi-012|नयव परमख करयकर अधकत पदपरत समबनध सचन|`, derived from institution + normalized title
- assertion id `as-a561997693ab71018b3085b4e5e6762e`
- `JOB_TITLE` at confidence 0.6, `APPLICATION_URL` at 0.5, both `UNVERIFIED`
- source snapshot `snap-munszkra-20`, pointing at the captured page's real hash
- projection: one row, `status: ACTIVE`, no deadline, no location, no conflict

Writing is not verifying: nothing was written as `HUMAN_VERIFIED` (L26), and no confidence was inflated past what earned it (B8, L22, L23).

The proof is only worth having if it runs everywhere, which took one non-obvious fix. The evidence capture is hash-pinned, and with `core.autocrlf=true` — the Windows default — an ordinary checkout rewrites LF as CRLF, changing the file from 70,755 bytes to 71,878 and breaking the pin on every machine except the one that captured it. `.gitattributes` now marks `fixtures/careers/*.html` as `-text`, so git stores and returns the bytes verbatim. Verified against the staged blob: 70,755 bytes, SHA-256 `9c8a03b5…`, zero CRLF sequences. A bug that only appears after a fresh clone is still a bug, and this one would have been invisible to every run on this machine.

**What the live pilot itself persisted: nothing.** Every table that holds a claim is empty — `data_assertions` (zero rows of any type), `data_conflicts`, `documents`, `document_extractions`, `outbound_links`, `ingestion_items`, `ingestion_runs`, `ingestion_errors`, `validation_results`, `audit_logs`, `jobs`, `institutions`, `official_links`, `institution_coverage`, `people`, and `posts`. The database contains exactly three non-empty tables: 29 `sources` rows, 60 `source_snapshots` rows, and 8 `field_refresh_policies` rows that predate this phase and are unrelated to careers.

What it did keep, and what it is worth being precise about:

- All 60 snapshots are `extraction_status = 'SKIPPED'` under parser `career-discovery-v1`. The pilot fetched pages and recorded that it had seen them; it did not extract from them.
- The source row is `swmfi-website` — `MFB_WEBSITE`, `INSTITUTION`, grade `A`, `https://swmfi.com.np`, `publisher` `mfi-012` — so the pilot does know which institution that host belongs to, and that it is the one that carries a vacancy.
- It holds four snapshots of that source: `snap-m35disc-c715bb3e04765b94` (`a349b7a3cfefa649…`, 2026-09-29T05:54:46Z) and the three detail pages `snap-m35det-8de8a7655c3afe2e` (`d3e95bd030ddbe87…`), `snap-m35det-fa26afd8b8cf809c` (`3c9c4529ef1d6263…`), `snap-m35det-07263f8a5af24c2b` (`71222d5dc2eafa01…`).

Those four hashes are **not** the captured fixture's `9c8a03b5…`, and they are not meant to be. They are earlier observations of the same host on a different day, and section 8 shows that this host serves different bytes to different requests. The proof's `snap-munszkra-20` is a fifth, separate snapshot that carries the hash of the bytes this audit actually parsed.

Found by the parser is not the same as persisted by the pilot, and the pilot is observation-only (L70–L74).

## 12. Assertion lifecycle

| Event | Behaviour | Check |
| --- | --- | --- |
| first observation | two new assertions, two new snapshots, nothing verified | L20–L26 |
| identical re-observation | no new assertion, nothing superseded, no conflict, projection byte-identical | L34–L40 |
| application link changes | one field superseded, old row retained, audit names field, retired value, reason and source | L41–L49 |
| title genuinely changes | **a new vacancy**, not a supersession | L50–L53 |

The last row is the one a reader is most likely to expect to go the other way. Identity is institution + normalized title + normalized location, so a different title is a different posting; merging on title alone is how two jobs become one, so the model forks and keeps both. Same-identity history is therefore demonstrated with the application link, which is a real supersession, rather than by overwriting a title.

A second observation still leaves its own snapshot (L39), because it genuinely was a second fetch.

## 13. Conflict lifecycle

A `JOB_TITLE` conflict is reachable only when two sources normalize to the same identity key but store different text. The live site renders this notice's title with and without trailing punctuation, which is exactly that case; two *genuinely* different titles would be two vacancies, as L50 proves.

- Two sources, one identity, different wording → **1** open conflict naming `JOB_TITLE` and both values (L56–L59)
- projection reports `status: CONFLICT` and names `title` in `conflicts`; both wordings stay current, neither is retired as wrong (L60–L63)
- second source catches up → **no** new conflict, still exactly **one** conflict row, still `OPEN` because nobody resolved it (L64–L66)
- projection returns to `ACTIVE`, title publishable again, and the unresolved conflict is **still shown on the record** (L67–L69)

The disputed title is displayed rather than omitted, because the read model cannot identify a vacancy without one. It is never presented as agreed: the field is named in `conflicts` and the status is `CONFLICT`, so a consumer may not quote the wording as fact. Fields that can be omitted — deadline, location, and the rest — are genuinely suppressed.

## 14. Provenance

Every assertion traces to a source, a snapshot, a moment, and a parser version.

- No assertion lacks a resolvable source and snapshot (P1, L48)
- Every fetch that produced an observation left a snapshot (P2, L39)
- Every run that asserted something is in the audit log (P3, P6, P6d)
- Snapshots record the parser version that read them (P4)
- No retirement is undocumented (P7)
- A superseded row keeps its provenance; a revived row carries the newer snapshot (P6c)

The proof's snapshots carry the captured page's real SHA-256, so the persisted provenance points at the exact bytes this section parsed rather than at a synthetic string.

## 15. Document/PDF evidence

The `mfi-012` notice PDF was **not** fetched or read. What is established:

| | |
| --- | --- |
| URL | same-origin, `https://swmfi.com.np/storage/website/notice/…-2026-09-30-147766.pdf` |
| Protocol | HTTPS, no downgrade (L14) |
| Exists | HTTP 200, `Content-Type: application/pdf`, `Content-Length: 147766` — established by a single `HEAD`, no body retrieved |
| Relationship | the byte count equals the `147766` in the notice's own filename |
| Represented as | the vacancy's `APPLICATION_URL` assertion |
| **Not** represented as | a `documents` row, an `outbound_links` row, or a `source_document` assertion |

That last row is a deliberate limit, and it is the one genuinely missing piece of interface. The PDF is a link the HTML proves exists; nothing in the system has read it, so no document row would be honest to create from a `HEAD`. The repository *can* represent this vacancy with its real data — title and application URL, which is what it does. What it cannot yet do is record a fetched document as first-class evidence with its own hash, MIME type, and outbound-link provenance, because the career path has no document-writing interface. That gap is stated rather than papered over, and no infrastructure was added to close it in this phase.

Eleven scanned images across the pilot are in the same position: real notices,
recorded as links, never opened. `VACANCY_DOCUMENT_UNREAD` is the state that matters. Publishing "no current vacancy" for an institution whose vacancies are in an unread file would be a false statement about a real institution, and it is the specific failure this pilot was built to prevent.

## 16. Jobs generator

`src/data/jobs.ts` is generated from current `VACANCY` assertions in the pilot database. That database holds none, so the file is empty **by construction rather than by comment**. Its provenance states that no vacancy has been published yet and why. The three fabricated rows that previously existed are gone; nothing replaced them.

## 17. `/jobs` public safety

No fabricated rows, no placeholder vacancy, no invented deadline. The public list is empty because the evidence is empty. Returning an empty truthful list is preferable to publishing rows that were never advertised, so `/jobs` stays behind its 404 until real vacancies exist.

## 18. API safety

`npm run smoke:api` — **45 passed, 0 failed**. The API cannot serve a vacancy that has no current assertion, cannot serve one whose fields are disputed without flagging the conflict, and cannot expose a retired value as current.

## 19. Security

- `npm run check:discipline` — **no violations in committed source**. The gate is unmodified; two of my own test fixtures tripped it (the word "truncate" in a test label, and a literal credential-shaped URL used to test credential refusal), and both were rewritten rather than the checker weakened.
- No AI, no OCR, no browser, no credentials, no session replay, anywhere in the path.
- Same-origin HTTPS only; redirects capped at 5; the one plain-HTTP career portal was refused by policy and not fetched.
- Hostile input is tested, not assumed: prompt-injection strings, entity-escaped markup, duplicate keys, two-array-key envelopes, malformed JSON, and non-string titles are all permanent regression cases.
- Every stored value is either what the source said or absent. Nothing is normalised into a claim.

## 20. Idempotency/history

- Re-observing the same page writes nothing new and supersedes nothing; the projection is byte-identical (L34–L40).
- An observation that sees no vacancy does not resurrect a retired assertion (A11–A14).
- Superseded values are retained, never deleted, and every retirement is audited with what, why, and by which source.
- Reviving a retired assertion is itself audited (P6b, P6d).
- Conflicts are not auto-resolved by convergence: the row stays `OPEN` and stays visible on the record (L64–L69).

## 21. Regression results

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | 0 errors |
| `npm run check:discipline` | no violations |
| `npm run smoke:careers` | 324 passed, 0 failed |
| `npm run prove:careers-json` | 158 / 158 |
| `npm run smoke` | 45 passed, 0 failed |
| `npm run smoke:api` | 45 passed, 0 failed |
| `npm run smoke:dataapi` | 42 passed, 0 failed |
| `npm run smoke:schedule` | 40 passed, 0 failed |
| `npm run smoke:compare` | 27 passed, 0 failed |
| `npm run smoke:alerts` | 18 passed, 0 failed |
| `npm run smoke:branch-external` | 169 passed, 0 failed |
| `npm run smoke:branch-persistence` | 55 passed, 0 failed |
| `npm run smoke:branch-lifecycle` | 69 passed, 0 failed |
| `npm run smoke:people-plausibility` | 30 passed, 0 failed |
| `npm run smoke:people-generic-ext` | 48 passed, 0 failed |
| `npm run smoke:people-discovery` | 45 passed, 0 failed |
| `npm run smoke:worker` | all checks passed |
| `npm run smoke:ingest` | all fixture tests passed |
| `npm run smoke:ingest-security` | all security tests passed |
| `npm run smoke:pdf-canonical` | all tests passed |
| `npm run smoke:people` | all fixture tests passed |
| `npm run smoke:people-m33` | all M3.3 fixture tests passed |
| `npm run smoke:structured` | all structured fixture tests passed |
| `npm run build` | compiled successfully |

`schema/`, `migrations/`, `data/pilot/pilot-budget.json` verified unmodified by `git diff` over those paths.

## 22. Known unrelated failures

Not caused by this phase, not fixed here:

- `npm run smoke:people-idempotency` — **30 passed, 3 failed**: F2 (one semantic assertion per person), F3 (no duplicate merely because the source differs), F4 (second source's provenance recorded). This is the pre-existing M3.3 people baseline and it is untouched by M3.5.
- `npm run lint` — **14 errors, 59 warnings**, all in files this phase did not touch: `scripts/build-master.cjs` (4), `scripts/seed.cjs` (5), `scripts/build-schema.cjs` (2), `scripts/check-discipline.cjs` (2), `scripts/smoke-ingest-fixtures.ts` (1). No error is in any file M3.5 changed.

## 23. What remains missing

1. **The 52 unread vacancy items are unexamined.** No text was extracted from any of them. They are counted as evidence and nothing more. This is the single largest gap between what exists publicly and what this system knows.
2. **No career path writes a document.** A fetched PDF or image has no first-class row with its own hash, MIME type, and outbound-link provenance. The one real vacancy is represented by a link, which is correct and incomplete.
3. **No publishing path is exercised in production.** The generator, the API, and the read model are all proven against temporary databases; the live pilot deliberately asserts nothing.
4. **Human review has not happened.** Every assertion is `UNVERIFIED`. The second option in section 24 of `PHASE-M3.5-LIVE-DISCOVERY.md` — a person reading each document — remains the only route to publishable fields today.
5. **One institution is unreadable** (`mfi-003`, HTTP 522) and one returned 404 (`mfi-019`). Neither is a claim about those institutions.
6. **`NO_ENDPOINT_FOUND` is a per-response verdict.** One Himalayan page served a variant with no request call in one run. A per-host aggregate over many runs would be a stronger claim than a single pass, and is a different investigation.

## 24. Himalayan HTTP ATS — explicitly deferred policy decision

`mfi-014` Himalayan Laghubitta publishes real vacancies, on `rigojobs.com`, over plain HTTP. This phase records the pointer and follows nothing. The decision belongs to the product, not to a parsing milestone, because two boundaries are crossed at once:

1. **Ownership.** Those pages belong to another organisation. Treating a named set of third-party ATS hosts as first-party sources makes this system's evidence chain a claim about someone else's content.
2. **Transport.** The destination is plain HTTP. Admitting it means either waiving the HTTPS requirement or building a guarded, explicitly-marked exception — and a downgrade that is "temporary" is the kind that becomes permanent silently.

Options, in the order they were considered:

1. **Cover the off-site portal** — the only option that produces a publishable vacancy from this source. Needs both decisions above, explicitly and on the record.
2. **Keep the pointer** — store the link as evidence with no parsed fields. Cheap, safe, available immediately.
3. **Leave it** — 15 of 29 institutions have no vacancy evidence at all, so one institution's external portal does not change the shape of the problem.

**DEFERRED.** No option is implemented. Nothing in this phase fetches, downgrades to, or parses that host, and no SSRF or transport policy was changed to accommodate it.

## 25. Final M3.5 state

**M3.5 is complete as an evidence and safety phase, and STATE B as a publication phase.**

What is established:

- 60 of 60 live pages read and classified, with the two unreadable responses labelled as unreadable rather than empty.
- One real vacancy found, from static HTML, carried through the production path by the shared generic grammar and proven end to end in 158 executable checks.
- A negative result on dynamic JSON across the entire population, backed by response-scoped hashes rather than a single unverifiable pass.
- A false positive caught and fixed, with the real notice preserved.
- 52 unread vacancy items honestly counted — after fixing a counting bug that had understated them as 14 — across 14 institutions, none of them opened.
- Nothing published, nothing fabricated, nothing verified by a human, and no file read that the audit cannot account for.

What is deliberately not done: publishing this vacancy, reading any document, and following the off-site ATS pointer.

**Himalayan ATS decision: DEFERRED.**

**M3.5 status: COMPLETE.**
