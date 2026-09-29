# M3.4 — Phase 4: Branch Coverage Inventory (35 live targets)

**Report:** `data/pilot/branch-shape-inventory.json` (`branch-coverage-inventory/v2`)
**Evidence DB:** `data/pilot/evidence/pilot-branch-shapes-2026-09-27.db` — 35 sources, 35 snapshots, **0 data_assertions, 0 validation_results, 0 branches**
**Reproduce:** `npx tsx scripts/inventory-branch-shapes.ts` (35 of 40 fetches used; all HTTP 200; deterministic, AI-free, no browser/JS)

---

## 1. Why this phase exists

The Phase 1 inventory reported a single `shape` per page that folded the
parser's name count into the classification. That is a category error: it let
"the parser read 212 names" be read back as "this page is a 212-row record
table". Phase 4 splits every target into three independent sections.

| Section | Question | Source of truth |
| ------- | -------- | --------------- |
| **A** `structure` / `structureKind` / `structuralRecords` | What IS the HTML? | `structuralEvidence()` in `lib/ingestion/shape-signals.ts` — no parser output involved |
| **B** `parser` | What did branch-html-v1 DO with it? | `analyzeBranchPage()` in `lib/ingestion/structured.ts`, in memory only |
| **C** `coverage` + `coverageReason` | What does that combination MEAN? | `classifyCoverage()`, a pure function of A and B |

Section C is a pure function of the A and B numbers, so the classification is
reproducible from the report alone. **Verified: recomputing all 35 classes from
the stored Section A + B inputs reproduced every field — 0 mismatches of 35**
(including `structureKind`, `structuralRecords`, `structuralRecordsMax`).

### Section A measures
`tableCount`, `recordTableCount`, `branchRowCount`, `headingCount`,
`branchHeadingCount`, `containerCount`, `phoneBlocks`, `brGroupCount`,
`mapLinkCount`, `emailCount`, `phoneCount`, `addressCount`,
`visibleTextLength`, `scriptCount`, `noscriptCount`, `jsRenderedIndicators`,
`title`, plus per-1k densities (`phonePer1k`, `emailPer1k`, `addressPer1k`,
`brGroupsPer1k`).

`phoneBlocks` counts leaf `div/li/article/section` blocks that each contain a
phone number — a class-agnostic signature of a repeated card grid, so no
per-site container class is encoded anywhere.

### Section B measures
winning grammar (`table` | `card` | `cell` | `none`), `candidateRecords`,
`validNames`, `rejectedNames`, `evidenceOnlyRows`, per-attribute
extracted/valid/refused tallies broken down by **reason code**, plus samples.

### Section C classes (ordered, deterministic)
`UNREADABLE_BODY` → client-rendered shell → `NOT_A_BRANCH_PAGE` →
`BRANCH_LOCATOR_UNRENDERED` → `SINGLE_LOCATION_CONTACT` →
`BRANCH_INTENT_NO_STRUCTURE` → then, for a real record structure:
`BRANCH_STRUCTURE_UNREAD` (0 read) / `PARTIAL_BRANCH_DIRECTORY` (<60% read) /
`VERIFIED_BRANCH_DIRECTORY`.

---

## 2. Result: 35 targets

| coverage class | n |
| -------------- | -: |
| VERIFIED_BRANCH_DIRECTORY | 12 |
| BRANCH_STRUCTURE_UNREAD | 11 |
| BRANCH_INTENT_NO_STRUCTURE | 7 |
| BRANCH_LOCATOR_UNRENDERED | 2 |
| SINGLE_LOCATION_CONTACT | 2 |
| PARTIAL_BRANCH_DIRECTORY | 1 |
| NOT_A_BRANCH_PAGE | 0 |

| structure kind (parser-independent) | n |
| ------------------------------------ | -: |
| branch_headings | 15 |
| none | 8 |
| record_table | 7 |
| phone_cards | 3 |
| single_block | 2 |

**12 of 35 verified. 12 of 35 (11 unread + 1 partial) carry structure the
parser demonstrably cannot read.** That is the honest headline; the old
conflated report could not express it.

---

## 3. Three measurement bugs this phase found and fixed

Each of these would have produced a *false negative* — a real coverage gap
recorded as "this page has nothing", which would have justified dropping a
target.

### 3.1 A client-rendered shell was classified `NOT_A_BRANCH_PAGE`

`vlbs-website` (`/branchesmap`) and `unnatislbs-website` (`/branches-map`) both
return HTTP 200 with 16.3 KB / 10.8 KB of HTML whose **entire visible text is
`"Update :"`** (the language switcher) and a date label. 32 and 10 `<script>`
tags, `<noscript>` present, Next.js `/_next/static/chunks/...` only. The branch
data is fetched client-side.

With no branch vocabulary in 8 and 23 visible characters, the classifier
returned `NOT_A_BRANCH_PAGE` — a claim that these institutions publish no
branches, on the strength of a page that contains no content at all. Fixed: a
tiny-text body with script markers is now `BRANCH_LOCATOR_UNRENDERED`, tested
**before** the vocabulary and roster tests. Both are now correctly held open as
"rows need script to exist" — which, given the no-browser constraint, is a
decision for the user rather than a finding.

### 3.2 The record denominator was taken from the wrong structure

A page can enumerate the same records several ways at once. Two worked examples
from this run:

| target | table rows | branch headings | assertable names | truth |
| ------ | ---------: | --------------: | ---------------: | ----- |
| aarambha | 134 | 269 | 132 | one branch ≈ 1 row ≈ 2 headings |
| mslbsl | 115 | 65 | 63 | one branch ≈ 1.8 rows ≈ 1 heading |

Testing headings first made **mslbsl** look incomplete (63 of 115). Testing
table rows first made **aarambha** look incomplete (132 of 269). Neither is a
miss. The rule is now: **collect every applicable structural estimate, use the
smallest as the record count, and carry the largest alongside it.** A page
cannot list fewer branches than its own most compact enumeration shows. The
spread itself is reported, because a wide spread is evidence that the layout
interleaves fields across rows, not that records are missing. Both pages are
now `VERIFIED_BRANCH_DIRECTORY` (63/65 and 132/134).

### 3.3 A readable name with no repeated structure was called "no structure"

`nationalmicrofinance-website`: 1 assertable name, `structureKind=none`. It was
`BRANCH_INTENT_NO_STRUCTURE`, whose reason text claims "branch vocabulary
without location records" — untrue, a name was read. A page with a name and no
repetition is a single-location contact at most. Fixed; now
`SINGLE_LOCATION_CONTACT` alongside `rsdcmf-website`.

---

## 4. The 12 targets with unread structure (Phase 5/6/7 worklist)

The dominant pattern: **a heading grid where each record carries an email but no
phone and no district.** The card grammar in `parseBranchBlocks` requires a
place cell (or district) *and* a phone before it will emit a name, so these
pages yield nothing at all — `path=none`, `candidateRecords=0`.

| target | headings | emails | phone density | assertable |
| ------ | -------: | -----: | ------------: | ---------: |
| swmfi | 340 | 343 | 8.25 /1k | 0 |
| sampadalaghubitta | 156 | 155 | 6.62 /1k | 0 |
| kalikabank | 110 | 111 | 6.60 /1k | 0 |
| samata | 91 | — | — | 0 |

These four alone represent **697 branch names visible in the HTML that the
pipeline currently reads as zero.** They are the same shape, so this is one
reusable grammar, not four site fixes — but it must be built on a fixture and
proven against a false-positive count, and it must not weaken
`isAssertableBranchName`.

Also in this group: `aatmanirbhar` (`record_table(24)`, title
`Branch Contact Details`, 27 emails, 6.11 emails/1k, `path=none` → the table
grammar produced **0 candidates** for a 24-row table), `matribhumi`
(2 phone cards, 4 map links), `swbbl`, `fmdb`, `ulbsl`, `mlbsl`
(3–78 headings), `nerudemirmire`.

### `forwardmfbank-website` — the one PARTIAL

`record_table(86)`, 50 candidate records, **2 assertable, 48 refused.** Every
refused value is a district or zone name: `Morang`, `Jhapa`, `Sarlahi`, `Parsa`,
`Bhaktapur`, `Kathmandu`, `Rupandehi`, `Palpa`, `Surkhet`, `Kailali`. The two
accepted are `Siksha Office Road` and `Belatadi Branch`. This reads as a
**two-level (district → branch) directory** where the parser is taking the wrong
column as the name. The Phase 3 gate is behaving correctly here — a bare
district must not assert as a branch name — so this is a *column-selection*
question, not a plausibility bug.

---

## 5. Attribute measurement (feeds Phase 14/15)

| field | extracted | valid | refused |
| ----- | --------: | ----: | ------: |
| BRANCH_DISTRICT | 339 | 290 | 49 |
| BRANCH_PLACE | 852 | 852 | 0 |
| BRANCH_PHONE | 1188 | 1053 | 135 |
| **total** | **2379** | **2195** | **184** |

Refusal reason codes: `DIGIT_COUNT` 135 (phone), `NOT_A_DISTRICT` 49. Both are
the gate working, not a defect — and both are now attributable per source, which
the pre-Phase-3 single boolean could not do.

**Not extracted at all:** email, manager, mobile, map link. 155/343/111 emails
are sitting in the HTML for sampada/swmfi/kalikabank and this path ignores them.
That is a Phase 5 grammar gap, recorded here so Phase 14 measures it rather than
silently reporting "0%".

---

## 6. Invariants held

- 0 assertions written; snapshot evidence only.
- No schema, migration, budget, or M3.3 change.
- No institution-specific selectors, class names, or blacklists. `phoneBlocks`
  and the vocabulary sets are structural/lexical only.
- No AI, no OCR, no browser, no JS rendering — the two client-rendered shells are
  reported as unrendered rather than worked around.
- Full suite green after the classifier change: `smoke:structured` 129,
  people 32, m33 95, generic-ext 48, discovery 45, idempotency 33,
  plausibility 30, api 36, ingest 54, ingest-security 50, discipline, build,
  typecheck.
- Nothing committed.
