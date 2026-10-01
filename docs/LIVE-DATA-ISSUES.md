# Live Data Issues — People + Branches coverage release

- **Release 1 commit:** `90e3a3e` (deployed, Pages build `success`); post-launch P1 cycle `aab0836`; person detail pages `1aeba04`
- **Release 2 commit:** `a3da05d` (deployed, Pages build `success`); people pipeline pass-2 export; see "Fixed in Release 2"
- **Release 3 commit:** `b21da3b` (branch release; Pages build `success`, live sweep OK); 1331 branch names across 13 institutions from 14 verified branch-directory sources; see "Fixed in Release 3"
- **Release 4 commit:** _pending_ (careers evidence application release): 37 vacancy records (1 parsed posting + 36 unread vacancy notices across 14 institutions) published from `data/pilot/evidence/pilot-careers-ext-2026-10-01.db`; see "Fixed in Release 4"
- **Live URL:** https://subashnp169.github.io/laghubitta-khabar
- **Release 3 live state (post-deploy sweep):** 13/13 branch-publishing institution pages render the Branch panel with count + names + source URL; institutions without verified branch pages show the honest `No branches have been extracted` state; deploy covers branch commits `b21da3b` + `73a2866`
- **Release 2 live state (post-deploy sweep):** 108 people / 13 institutions / 13 sources; all UNVERIFIED, all `sources.length === 1`, 0 CONFLICT; 51/51 institution pages HTTP 200; 13/13 person pages HTTP 200; all 108 names render on their institution pages
- **Sweep (Release 1):** 51/51 institution pages HTTP 200, 45 honest `None published`, 0 P0 leaks
- **Collected from:** live page fetch after deployment + deterministic export audit (`src/data/people.ts`, `src/data/branches.ts`)

Priority key: **P0** publicly false/dangerous · **P1** publicly misleading · **P2** coverage ·
**P3** UX · **P4** enhancement. Only P0/P1 interrupt normal roadmap work.

---

## Fixed in Release 4 (careers evidence application)

| Issue | Sev | Resolution |
|---|---|---|
| Careers dataset empty; institution pages showed stale `crawl.vacancyCount`/`crawl.vacancyTitles` from the legacy crawl summary | P2 | New `scripts/run-career-apply.ts` (re-fetches the 60 career registry targets, plans `VACANCY` assertions with `planVacancyEvidence` and unread-document evidence with `planVacancyDocumentEvidence`, writes to local SQLite, audits provenance) → `src/data/jobs.ts` (37 records: 1 parsed posting + 36 unread vacancy notices) via `build-jobs-module.ts`. Institution page reads the vacancy read model from evidence; the crawl widget now shows published vacancy records |
| A vacancy whose contents were never read could look like a fully parsed job | P0 | DOCUMENT records render as explicit `unread notice` badges with a hard link to the source document and "this system has not read the document" copy on `/jobs` and institution pages; only the swmfi `DCEO` posting renders deadline/location. No deadline/location is ever invented for a document record |
| Document-entity assertions for the same URL could collapse onto one entity id but differ per institution | P1 | Identity is `vacancyId(institutionId, title, location)` for postings and the document URL for documents, so a linked notice is one entity per URL and never merges across institutions |
| An institution name in a job row could be invented rather than observed | P0 | `smoke:api` now asserts every `institution:` value is either a name from the public registry or the explicit `(institution name not observed)` marker (`scripts/smoke-api.ts`) |
| First apply run crashed after all 60 fetches (report `values` SQL keyword) | P3 | Fixed and re-run; second run proved idempotency — every assertion UNCHANGED, no new snapshots, no report drift |
| Career registry rollup double-counted unread documents | P2 | `recompute-career-registry-rollup.ts` reports `unread_vacancy_documents_total`; the apply pass asserts one `SOURCE_DOCUMENT` assertion per distinct document URL observed (36 of 37 vacancy records) |
| Evidence DB and budget guards | P2 | Evidence DB stays gitignored; committed truth is the report JSON + generated module. Apply pass budget (career-pilot-budget.json) unchanged; asha's non-HTTPS career link was fetched per policy — recorded FETCH_FAILED, no vacancy invented |

Budget note: the apply pass fetches its targets once per run. It was deliberately run twice (run 1 crashed at audit after all fetches; run 2 re-ran idempotently) — each single run stayed within the frozen career budget; total dev-spend of ~120 apply fetches over the two runs is charged to development, not production, and no further apply runs are planned until evidence needs refreshing.

---

## Open issues

### P1 — Publicly misleading

- `swabalamban-laghubitta-bittiya-sanstha-ltd` publishes 4 staff as leadership. The
  swbbl management-team page pairs each name with a designation, but the `ROLE_FAMILIES`
  vocabulary matches the substrings "general manager"→CEO and "management"→BOARD, so
  department phrases and deputy/assistant-GM titles read as officers:
  - `Mr. Chandra Mani Chaulagai` — "Acting Deputy General Manager(DGM) , Information Officer" → `people_ceo`
  - `Mr. Nil Kantha Poudel` — "Acting Assistant General Manager(AGM)" → `people_ceo`
  - `Mr. Rajendra Dhital` — department "Human Resource Management and Training Dept" → `people_board`
  - `Mr. Krishna Khanal` — department "Services and Asset Management Dept." → `people_board`
  These 4 rows existed in the deployed Release 1 data (pre-existing). The pass-2 export
  additionally removed 6 genuine staff from swbbl ("Senior Manager"/"Divisional Manager"
  titles that match no family), so the published set is strictly closer to the page than
  before. Fix = tighten `ROLE_FAMILIES` (deny deputy/assistant/acting-prefixed GM and
  department-phrase matches), add fixtures, re-run pipeline.

## P2 — Coverage

- `uniquenepalmicrofinance-website` (6 people) and `dhaulagiribank-website` (2 people)
  crawled and stored in evidence but excluded from public output: they have no identity in
  the public registry `src/data/institutions.ts`, so the exporter's publisher-name identity
  resolution cannot resolve them. Shipping them requires registry coverage (an NRB-ordered
  source), not extraction work. Sources remain evidence-only by design.
- 38/51 institutions still have no published people. Source URLs exist but were never crawled.
- 38/51 institutions still have no published branches (1331 names across the 13 institutions whose branch-directory pages are verified AND resolve to the public registry).
- 36/51 institutions still have no published vacancy records; the 14 institutions whose career pages or linked notices were observed are published (see "Fixed in Release 4"). Asha's career link is a non-HTTPS host (`:70`) the controlled fetcher refuses, so it records a fetch failure rather than any vacancy.
- `people_branches` never appears in extracted data despite being an expected field.
- Branch attributes (district/place/address/phone) are evidence-only at 0.45 (below the 0.5 assertion gate) and are never published; branch pages show names + count + source only. Confirmed districts will appear once attributes clear the gate with a human verification path.

## P3 — UX

- No person detail page. `/api/people/{slug}` works and every record is individually
  addressable, but the static site exposes no route for it, so people cannot be linked.
- Only the primary source URL is exposed. If a record ever becomes corroborated by a
  second source, the second source's URL will need a `source_urls` array to match
  `sources[]`.
- The leadership list shows the institution's first source URL only. With 6
  single-source institutions that is complete today, but a mixed-source institution
  would need per-row provenance.

## P4 — Enhancement

- Link people from search results once a person route exists.
- Show `since` per position once historical snapshots accumulate.

---

## Fixed in Release 3 (branch directory pipeline)

| Issue | Sev | Resolution |
|---|---|---|
| Branch datasets empty; institution pages showed stale `crawl.branchCount`/`branchNames` | P2 | New `scripts/run-pilot-branches.ts` (branch-scoped engine over the 18 structurally verified BRANCH_DIRECTORY targets) + `scripts/pilot-export-branches.ts` → `src/data/branches.ts` (1773 branch_name assertions, 0 orphans, 0 conflicts, all UNVERIFIED). Institution page reads `institutionBranches()` read model |
| Branch names only — attributes (district/place/address/phone) still not published | P2 | Deliberate: attributes are evidence-only (0.45 < 0.5 assertion gate). Release publishes names + count + source only; `district:""` / `address:null` wherever a location was never asserted |
| Branch assertions were institution-scoped (`entity_id = mfi-0NN`), which would collapse every branch of an institution onto one DTO | P0 | Exporter re-keys each row to `branchIdentityKey(institutionId, name)` (`<institution>|<normalized name>|-`); geo stays `-` because attributes are evidence-only. 0 duplicate slugs/ids in the projected set |
| 4 verified sources (sampada, matribhumi, dhaulagiribank, aatmanirbhar) have no identity in the public registry | P0 | Sources retained as evidence-only; dropped from public output (same rule as people export). 442 assertions kept in evidence, not published |
| nirdhan/asha/nadeplaghubitta/dhaulagiribank runs marked PARTIAL solely for `wp-json/oembed` link-walk failures | P3 | Only the discovered oembed feed targets failed (HTTP_ERROR); every verified BRANCH_DIRECTORY page itself fetched http 200 and extracted fully. Branches reported normally |

---

## Fixed in this release

| Issue | Sev | Resolution |
|---|---|---|
| Site rendered a false `Leadership (0 extracted) / None extracted` for all 51 institutions while the MVP was invisible | P0 | Institution pages now read `institutionLeadership()`; live totals match the audit exactly |
| 11 supportmicrofinance names in mathematical-bold Unicode collapsed onto one identical id/slug (10 unreachable) | P0 | Excluded from published output as not individually addressable; retained in evidence |
| 5 navigation/feature labels published as `Director` (`Currency Conversion`, `Local Bodies Outreach`, `Working Districts`, `Internal Web` x2) | P0 | Fail-closed denylist in the exporter; retained in evidence |
| `swastiklbs-website` had no canonical identity (pilot `mfi-045` = Swastik, public `mfi-045` = Nyadi) | P0 | Source excluded from public output; 16 assertions retained in evidence |
| `smoke:api` person-detail assertions were data-driven and silently skipped when `institutions[0]` had no people | P1 | Now selects an institution that actually has leadership |

---

## Fixed in Release 2 (pass-2 people pipeline)

| Issue | Sev | Resolution |
|---|---|---|
| 45/51 institutions had zero published people | P2 | Pass-2 crawl (`pilot-people-ext-c-pass2.db`, 25 in-scope sources) → 108 people across 13 institutions; exporter identity-resolves publisher name against the public registry (`identityKey`) |
| swbbl published 6 staff as `people_board`/`people_ceo` (Senior Manager, Divisional Manager titles) | P1 | New extractor container rule + `classifyPeoplePage()` dropped them; only genuine leadership pages survive |
| Extractors over-fired on multi-person grids (one "Chief Executive Officer" span labeling 9 department heads) | P0 | `pickContainerRoster()` one-distinct-name rule; `ROLE_TEXT_MAX` 40→100; names stay on strict heading scan |
| 10 same-source pseudo-conflicts created by the pass-2 run | P0 | Exporter keeps only cross-source conflicts (`source_a_id <> source_b_id`); 0 published CONFLICT rows |
| `uniquenepalmicrofinance`/`dhaulagiribank`/`cyc`/`swastiklbs` crawled but unresolvable to public registry identities | P0 | Sources retained as evidence-only; dropped from public output (see Open issues) |
| Mathematical-bold Unicode supportmicrofinance names collided onto one id/slug | P0 | Excluded as not individually addressable; retained in evidence |
| 5 navigation/feature labels read as people (`Internal Web`, `Currency Conversion`, etc.) | P0 | Fail-closed denylist in the exporter; retained in evidence |

## Fixed in post-launch P1 cycle

| Issue | Sev | Resolution |
|---|---|---|
| Source URL not exposed; readers could not follow a person back to its evidence | P1 | `SourceMeta.source_url` / `ApiMeta.source_url` added and populated from `pilot-sources.json`. Nullable by design — never a synthesised link. 8 new `smoke:api` assertions cover shape and envelope parity |
| `people_ceo` treated as a single slot, so 4 names at one institution each read as an exclusive office | P1 | `positions[].shared_by` reports how many people share a role; the UI pluralises multi-holder officer titles and shows a `N listed` note. All names still published, none dropped |
| 8 people marked `CONFLICT` when no contradiction existed | P1 | Root cause: all 64 conflict rows had `source_a_id = source_b_id` — one source disagreeing with itself. `CONFLICT` is now reserved for cross-source disagreement. 58 people, all `UNVERIFIED`, `sources.length === 1` throughout |

**Evidence behind the conflict reclassification:** 64/64 conflict rows in
`pilot-people-2026-09-27-ext-c-pass1.db` are same-source. 0 are cross-source. Each
institution's people come from exactly one source, so cross-source conflict is not
merely absent here — it is impossible with this evidence. The `CONFLICT` path itself
remains live and is exercised by forcing a key in verification.

## Still open from the original P1 list

- ~~8 promoted institutions have `officialWebsite: null`~~ — unchanged, still P2 work;
  it was mis-filed as P1 and is coverage/verification, not a live-data defect.

