# Phase M3.4 — P5–P9 Shape Expansion Report

**Parser under audit:** `branch-html-v2`
**HEAD:** `0b680e41a13577f294039d42b87eb5452b2f0207` (uncommitted working tree; nothing committed, nothing pushed, no M3.5 work started)
**Measurement date:** 2026-09-27
**Machine-readable report:** `data/pilot/branch-shape-inventory.json`
**Evidence:** `data/pilot/evidence/pilot-branch-shapes-2026-09-27.db` (35 sources, 35 snapshots, **0 data_assertions**)

---

## A. Scope and what this phase is allowed to change

P4 established a parser-independent inventory of 35 known branch-directory URLs and
classified them with a pure function of structure and parser output. Twelve targets
were `BRANCH_STRUCTURE_UNREAD` or `PARTIAL_BRANCH_DIRECTORY`: the HTML visibly listed
branches and the pipeline read zero.

P5–P9 adds **shape grammars and attributes** so those pages are read by a reusable
rule, with no institution-specific selectors, classes, column indexes, or blacklists.

In scope: `lib/ingestion/structured.ts`, the new `lib/ingestion/branch-records.ts` and
`lib/ingestion/shape-signals.ts`, and the measurement scripts.

Explicitly out of scope and untouched: `schema/schema.sql`, `migrations/`,
`data/pilot/pilot-sources.json` capability definitions, the production budget
(`maxFetches: 18`), and the frozen M3.3 people design documents.

## B. Section A — structure (parser-independent)

`structuralEvidence()` in `lib/ingestion/shape-signals.ts` answers "what IS the
HTML?" with no parser output involved. The smallest applicable estimate is the record
count, because a page cannot list fewer branches than its own most compact
enumeration shows; the largest is carried alongside.

| structure kind | n |
| --- | -: |
| branch_headings | 15 |
| none | 8 |
| record_table | 7 |
| phone_cards | 3 |
| single_block | 2 |

## C. Section B — parser (`branch-html-v2`)

Path selection is ordered: table first, then the evidence-gated card grammar, then the
`<br>`-cell grammar. `analyzeBranchPage()` reports the path, the candidate/valid/refused
counts, the attribute tallies, name samples, and — new in this phase — the weak-card
counters, so a page that yields nothing can still say why.

The single most important structural change in this phase:

> **A bare place name is a branch name only when its column says so.**
> `selectBranchRows()` used to choose the table path with `isAssertableBranchName()`
> while the extractor asserted with a column-aware predicate. Any name that qualified
> *only* by its column was returned by the table and then dropped — the path and the
> assertion disagreed. Both now use `nameAllowedInColumn(name, fromDeclaredBranchColumn)`.

The grammar is a header-semantics rule, not a value rule: a cell in a column headed
`Branch Name` / `Branch` / `Office` (or a singular/plural variant) declares branch
semantics, and that declaration applies to the *column*, not to the value. A `Name`
column beside a `Branch` column is a people column. Nothing is keyed to a position.

## D. Section C — coverage (`classifyCoverage()`)

| coverage | n |
| --- | -: |
| VERIFIED_BRANCH_DIRECTORY | 18 |
| BRANCH_STRUCTURE_UNREAD | 6 |
| SINGLE_LOCATION_CONTACT | 6 |
| BRANCH_INTENT_NO_STRUCTURE | 2 |
| BRANCH_LOCATOR_UNRENDERED | 2 |
| PARTIAL_BRANCH_DIRECTORY | 1 |
| NOT_A_BRANCH_PAGE | 0 |

## E. Before / after: 35-target delta

| coverage | P4 | now | Δ |
| --- | -: | -: | -: |
| VERIFIED_BRANCH_DIRECTORY | 12 | **18** | +6 |
| PARTIAL_BRANCH_DIRECTORY | 1 | 1 | 0 |
| BRANCH_STRUCTURE_UNREAD | 11 | **6** | −5 |
| BRANCH_INTENT_NO_STRUCTURE | 7 | **2** | −5 |
| SINGLE_LOCATION_CONTACT | 2 | **6** | +4 |
| BRANCH_LOCATOR_UNRENDERED | 2 | 2 | 0 |
| NOT_A_BRANCH_PAGE | 0 | 0 | 0 |

`needs structural work: 12 → 7`.

The six newly verified: `swmfi`, `sampadalaghubitta`, `kalikabank`, `samata`
(heading grids with email but no phone/district), `forwardmfbank` (142 bare
local-body names under a `Branch Name` header), `aatmanirbhar` (a `Branch` column
beside a person `Name` column, after a prose preamble row).

The five reclassified out of `BRANCH_INTENT_NO_STRUCTURE` are
`laxmilaghu`, `nmbmicrofinance`, `uniquenepalmicrofinance`, `jeevanbikasmf`,
`swastiklbs` — all now `SINGLE_LOCATION_CONTACT`, with **zero** branch names.

## F. The four-target matrix

| target | P4 | now | path | names | the shape that needed a new rule |
| --- | --- | --- | --- | --- | --- |
| `swmfi-website` | UNREAD, 340 headings, 0 assertable | VERIFIED | card | 336 ok / 366 refused | heading grid where each record carries an **email** but no phone and no district; the old card grammar demanded a place cell *and* a phone |
| `forwardmfbank-website` | PARTIAL, 2 of 48 | VERIFIED | table | **142 / 142** | one 143-row table headed `S.No. | Branch Name | Province | Province District | Local Bodies | Ward | Address`; the values are bare local-body names that read as directory *values*, not branch *labels* |
| `aatmanirbhar-website` | UNREAD, `record_table(24)`, 0 candidates | VERIFIED | table | **22 / 22** | a prose preamble row precedes the real header, and the header carries `S.N. | Name | Position | Branch | Branch Address | Ward No. | Email Address | Contact No.` — `Name` is a *person*, `Branch` is the office |
| `nationalmicrofinance-website` | UNREAD, false positive `Branch Offices` | **SINGLE_LOCATION_CONTACT** | none | 0 names | a static one-office contact page whose header/footer link to the branch page; the word "branch" appears from navigation only |

`swmfi`'s 366 refusals are correct, not loss. Sampled: `Branch Networks` (nav),
`Province 1 15` and `Province 2 38` (a footer statistics table), `DIL KUMAR B.K.` (a
person), `<i class="fa fa-envelope" (markup text). Against the real structure — 340
branch headings — the parser asserts 336, i.e. **98.8%**, and the 702 denominator is
inflated by the footer table.

## G. The four measurement bugs this phase found

1. **Path and assertion used different predicates** (Section C). A name admitted only
   by its column produced `path=none` with rows present. Symptom:
   `Ghorahi`/`Amardaha` printed as names with `path=none`; `forwardmfbank` at 3/142.
   Fix: one predicate, `nameAllowedInColumn()`.
2. **A declared-column table was counted, not asserted.** With the path fixed, the
   extractor's column context was still being lost, so `forwardmfbank` went from 1/142
   to 3/142 rather than 142/142. Fix: carry `nameFromDeclaredBranchColumn` on the row
   and use it in the extractor's per-cell context, not just in the value gate.
3. **A false positive named `Branch Offices`.** Plural organisation labels matched
   because the name gate only rejected a *singular* set of role labels. Fix: normalise
   the plural before the check. `uniquenepalmicrofinance` went 1 name → 0.
4. **A 142-row directory with 1 surviving name was called a single location.** The
   `records <= 2` single-location test was reading the *parser's* surviving count as
   though it were the structural count. Fix: more than two structural records with
   fewer than two assertable names is `PARTIAL_BRANCH_DIRECTORY`.

Plus one added rule: a page with no record structure, no assertable name, contact
details for one place, and navigation-scale branch talk is `SINGLE_LOCATION_CONTACT`
rather than `BRANCH_INTENT_NO_STRUCTURE` (threshold: at most 12 branch mentions;
measured single-location pages 1–5, the unread directory `slbsl` 99). It is reachable
only when nothing was parsed, so it can never soften a directory that was read.

## H. Card strength model

Cards are graded rather than binary-accepted:

- **strong** — a name plus independent location/contact evidence.
- **moderate** — a name plus exactly one of email / map URL.
- **weak** — a name alone.

Weak cards are never asserted, but they are **reported**
(`weakCardCandidates`, `refusedCardCandidates`) so a page that yields nothing can show
what it refused and why. `fmdb` now reads: 2 branch headings, 5 refused card
candidates, 0 asserted.

## I. Adjacent pairing and role grammar

A branch card's email paired with the neighbouring card's name is a **manager**
relationship, read in document order and held in memory only. Person headings
(`Chief Executive Officer`, `Manager`, all-caps role labels) are classified as people,
never as branches; a name read from a person card is counted in
`namesFromPersonCards` instead of being asserted. `Contact Us` and organisational
headings are excluded from the person grammar, and "Contact Us" no longer yields a
person. District text is no longer mined from mailbox names.

## J. Attribute grammar and quality matrix

Eight attributes are extracted, validated, and counted: `BRANCH_DISTRICT`,
`BRANCH_PLACE`, `BRANCH_ADDRESS`, `BRANCH_PHONE`, `BRANCH_MOBILE`, `BRANCH_EMAIL`,
`BRANCH_MANAGER`, `BRANCH_MAP_URL`. Names stay at confidence 0.6 and attributes at
0.45. Map URLs are stored, never fetched.

| attribute | extracted | valid | refused | refusal rate |
| --- | ---: | ---: | ---: | ---: |
| BRANCH_PLACE | 2442 | 2441 | 1 | 0.0% |
| BRANCH_ADDRESS | 1924 | 1915 | 9 | 0.5% |
| BRANCH_PHONE | 1912 | 1569 | 343 | 17.9% |
| BRANCH_EMAIL | 1238 | 1237 | 1 | 0.1% |
| BRANCH_MANAGER | 932 | 254 | 678 | 72.7% |
| BRANCH_DISTRICT | 702 | 559 | 143 | 20.4% |
| BRANCH_MOBILE | 273 | 273 | 0 | 0.0% |
| BRANCH_MAP_URL | 3 | 3 | 0 | 0.0% |

The `BRANCH_MANAGER` refusal rate is the **person/role gate working**, not loss: a
value that looks like a contact but is not a manager is refused. Feeds Phase 14/15.

## K. Identity and idempotency

Identity is **institution + normalized name + geographic discriminator**. Contact
details are never part of it.

- `branchNameKey()` — normalized name.
- `branchGeoKey()` — district and/or place.
- `branchIdentityKey()` — institution + name + geo; email, phone, map URL, document
  order, and array position are all excluded.
- `groupBranchIdentities()` — collapses peers, flags same-name-different-district rows
  as `ambiguous` rather than merging them, and never merges two institutions' "Main
  Branch".

Proven by fixture: a branch whose phone and email both change keeps one identity; the
key does not contain the email or phone; repeated calls agree; a full `analyzeBranchPage()`
is byte-identical across runs; a client-rendered shell must never produce a negative class
(a 200 response whose visible text is only a language switcher is recorded as
`BRANCH_LOCATOR_UNRENDERED`, not `NOT_A_BRANCH_PAGE`).

## L. False-positive audit

| check | result |
| --- | --- |
| `Branch Offices` heading asserted as a branch | 0 (was 1) |
| `uniquenepalmicrofinance-website` names | 0 (was 1) |
| generic contact / department / footer asserted | 0 |
| person heading asserted as a branch | 0 |
| manager `Name` column read as the branch | 0 |
| maps fetched | 0 (URLs stored only) |
| Nav/footer/table-of-contents names asserted | 0 in samples |

## M. Recall audit

Zero recall loss is a fixture, not an aspiration: the nine real names from P3 are
asserted in full, and `B7` fails if any is lost. Recall gained:

- `forwardmfbank` 2/48 → 142/142
- `aatmanirbhar` 0 → 22/22
- `swmfi` 0 → 336 (98.8% of 340 headings)
- `sampadalaghubitta` 0 → 154, `kalikabank` 0 → 108, `samata` 0 → 89
- `aarambha` 132 → 134, `gblbs` → 191, `chhimek` → 212, `nirdhan` → 158, `mero` → 149

## N. The 7 targets still needing structural work

| target | structure | why it is not done |
| --- | --- | --- |
| `mlbsl-website` | branch_headings(3–78) | largest unread page; 79 phones, 78 emails, 179 place markers |
| `ulbsl-website` | branch_headings(11) | 23 branch mentions, 15 phones, 12 emails, no readable record |
| `nerudemirmire-website` | branch_headings(5) | 164 branch mentions against 5 headings |
| `matribhumi-website` | phone_cards(2) | 34 phones, 68 place markers, 12 refused cards |
| `swbbl-website` | branch_headings(2) | 153 phones against 2 headings |
| `fmdb-website` | branch_headings(2) | 5 refused cards; small page, no accepted record |
| `rsdcmf-website` | branch_headings(4) | PARTIAL: 2 of 4 assertable |

These are measurement-only classes: they record that the page needs work and justify
keeping the target. None is a licence to assert.

### N.1 Classification of the 7, from evidence already held

Every one of these targets already has a stored snapshot, so this classification required
**no new fetch** and the budget is untouched. Each is placed in the taxonomy from the
section AD table, using the structural evidence already measured — not a guess about what
the site might contain.

The authoritative, generated version of this classification across all 35 targets is
`docs/PHASE-M3.4-FINAL-AUDIT.md` (rebuild with `npm run build:m34-audit`). It is
derived from `data/pilot/branch-shape-inventory.json` rather than typed by hand.

> **Correction (M3.4 final audit).** The table below originally hand-assigned
> `BRANCH_LOCATOR_UNRENDERED` to `swbbl-website` and `mlbsl-website`, and
> `BRANCH_INTENT_NO_STRUCTURE` to `matribhumi-website`. The committed classifier
> in `data/pilot/branch-shape-inventory.json` assigns **all three
> `BRANCH_STRUCTURE_UNREAD`**, and that is the label used in
> `docs/PHASE-M3.4-FINAL-AUDIT.md`. The `BRANCH_LOCATOR_UNRENDERED` test requires
> at least two client-render indicators; `swbbl` scores 1 and `mlbsl` scores 0.
> The map diagnosis below is well-evidenced and worth acting on, but it is an
> interpretation laid over the measurement, not a classification the pipeline
> produced. The labels here now match the evidence file.

| target | classification (as classified) | evidence already held | `branch_count` |
| --- | --- | --- | --- |
| `rsdcmf-website` | `PARTIAL_BRANCH_DIRECTORY` — data exists and is partly readable | 4 structural records, 2 assertable names, 3 map links, 0 JS indicators | 2 (partial, flagged partial) |
| `swbbl-website` | `BRANCH_STRUCTURE_UNREAD` — *suspected* map-published, see note | 153 branch mentions and 153 phones, but only 2 headings survived, and **145 map links** with 1 JS-rendered indicator | `null` |
| `mlbsl-website` | `BRANCH_STRUCTURE_UNREAD` — *suspected* map-published, see note | 179 place markers and **154 map links** against 3 accepted headings; the branch network looks like a locator map, not records in the served HTML | `null` |
| `matribhumi-website` | `BRANCH_STRUCTURE_UNREAD` | 34 phones and 68 place markers, 2 phone_cards records, but 0 assertable names — 12 refused card candidates (product names, not branches) | `null` |
| `nerudemirmire-website` | `BRANCH_STRUCTURE_UNREAD` | 164 branch mentions against 5 headings and 1 phone; heading extraction is not segmenting the record | `null` |
| `ulbsl-website` | `BRANCH_STRUCTURE_UNREAD` | 11 headings, 23 branch mentions, 15 phones, 0 locator and 0 map links — content is served, segmentation is not | `null` |
| `fmdb-website` | `BRANCH_STRUCTURE_UNREAD` | 2 headings, 4 branch mentions, 6 phones, 0 map links; small page, nothing accepted | `null` |

Two distinctions in that table are the substance of this subsection, and both are about
not over-reading a page:

- **`swbbl-website` and `mlbsl-website` are probably map-published, and that is a
  hypothesis, not a finding.** 145 and 154 map links against 2 and 3 accepted headings is
  strong evidence that the branch network is drawn on a map rather than listed as text.
  It remains a hypothesis because the classifier's own test did not fire: it wants two or
  more client-render indicators and these score 1 and 0. The operational consequence is
  unchanged either way — the deterministic fetcher cannot read these records, so no count
  is published today, and emphatically no zero. Settling it needs a decision about the
  threshold and a re-run, not a relabel.
- **The remaining five are structural.** Nothing is missing from the response — the
  content is served and the parser is not reading it. A reusable shape that generalises
  across institutions would be the right fix; a one-off selector written to make this
  table look complete would be the wrong one, and is not attempted here.

No target in this table is `NO BRANCHES`, and none may be reported as `0`. `fmdb-website`
is the case most at risk of being misread as zero: 6 phones and 4 branch mentions on a
small page is weak evidence, not evidence of absence, and its count is `null`.

## O. Evidence and provenance

| artefact | contents |
| --- | --- |
| `pilot-branch-shapes-2026-09-27.db` | 35 sources, 35 snapshots, **0 data_assertions** — measurement only |
| `pilot-branch-url-discovery-2026-09-27.db` | 35 sources, 30 snapshots, 0 assertions |
| `phase-o-2026-09-26-base-51-source.db` | **untouched** (last written 2026-09-26 22:22, before this phase): 51 sources, 688 snapshots, 2482 data_assertions, 1211 ingestion items, 3606 validation results, 4068 audit logs |

Nothing was asserted to production. No historical assertion was deleted or rewritten.

## P. Budget and network discipline

`data/pilot/pilot-budget.json` is unchanged: `maxFetches: 18` per run. The inventory
cap of 40 was a measurement setting only. No map URL was fetched. No AI, LLM, browser,
Playwright, JS rendering, or OCR was used — the entire measurement is a deterministic
`analyzeBranchPage()` over already-captured snapshots.

## Q. Invariants held

- No institution-specific selector, class, or blacklist was added; every rule is
  institution-agnostic.
- No fixed column index anywhere; column meaning is read from the header.
- `isAssertableBranchName()` was not weakened. It gained a column-context parameter and
  plural normalisation; it did not lose a rejection.
- A 200 response is never treated as proof a page has no branches.
- Document order and array position are never identity.
- Nothing committed, nothing pushed, no deploy, no M3.5.

## R. Regression matrix (all green at this HEAD)

| suite | result |
| --- | --- |
| `tsc --noEmit` | 0 errors |
| `build` (`next build`) | exit 0 |
| `smoke:structured` (B1–B18) | **209 ok / 0 fail** |
| `smoke:people-m33` | pass |
| `smoke:people-plausibility` | 30 / 0 |
| `smoke:people-generic-ext` | 48 / 0 |
| `smoke:people-discovery` | 45 / 0 |
| `smoke:people-idempotency` | 33 / 0 |
| `smoke:people` | pass |
| `smoke:api` | 36 / 0 |
| `smoke:dataapi` | 42 / 0 |
| `smoke:ingest` | pass |
| `smoke:ingest-security` | pass |
| `smoke:pdf-canonical` | pass |
| `smoke:schedule` | 40 / 0 |
| `smoke:compare` | 27 / 0 |
| `smoke:alerts` | 18 / 0 |
| `smoke:worker` | pass |

`lint` exits 1, and it also exits 1 at clean HEAD: all 14 errors are pre-existing
`no-require-imports` in `build-master.cjs`, `build-schema.cjs`, `check-discipline.cjs`,
`seed.cjs`, and `smoke-ingest-fixtures.ts`. **Zero lint errors in the files this phase
touched.**

## S. Decisions reversed, and honestly

Two diagnoses made earlier in this phase were wrong and are corrected here rather than
quietly dropped:

1. **ForwardMFBank** was described as having a "separate district summary table". It has
   one 143-row table with an explicit `Branch Name` header. The apparent district table
   was the province/district columns of that same table.
2. **Aatmanirbhar** was described as a 24-row table with 24 candidates. It has a prose
   preamble row before the real header; 22 are branch records.

The assertion count reported for the historical evidence database was also wrong
earlier in this phase: it holds **2482** `data_assertions`, not 1157.

## T. Status

`HOLD`.

What is done and verified: the two grammar defects that capped the six largest
unread targets, the single-location classification rule, the weak-card reporting path,
`branch-html-v2`, and 209/209 structured fixtures with the full regression matrix green.

What is not done, and is the honest reason for `HOLD`:

- 7 of 35 targets still need structural work (Section N). Three of them —
  `mlbsl`, `swbbl`, `matribhumi` — carry more contact density than any page this phase
  verified, so the card grammar is not yet general enough to call this shape complete.
- `swmfi` asserts 336 of 340 headings, not 340; `chhimek` 212 of 221; `kalikabank` 108
  of 118. The shortfall is documented in Section F, not closed.
- The identity helpers are proven as pure functions and fixtures, but are not yet
  wired into the persistence and re-ingestion path, so end-to-end idempotency across a
  re-run is unproven.
- `BRANCH_MANAGER` refuses 72.7% of candidates. That is the gate working, but Phase 14/15
  has not yet characterised the refusals.
- No section A–T result here justifies starting M3.5 or asserting to production.

---

# M3.4 Extension — External Branch Evidence Fallback

Added after sections A–T. **Sections A–T above are not rewritten**: they are the
official-parser record as it stood. This extension covers the external-source tier
and one item from section T that this work has now closed (end-to-end idempotency).

## U. The rule this extension exists to enforce

An MFB website that is JS-rendered, structurally unreadable, missing branch data,
broken, incomplete, or impractical to parse **must not become `branch_count = 0`**.

| Official source state | Result |
|---|---|
| Answers on its own terms (verified / partial / single-location) | `A_OFFICIAL_PARSED`, no fallback |
| `BRANCH_LOCATOR_UNRENDERED`, `BRANCH_STRUCTURE_UNREAD`, `BRANCH_INTENT_NO_STRUCTURE`, `UNREADABLE_BODY` | fallback eligible → `B`/`C`/`D` |
| Fallback eligible and nothing usable | `D_UNRESOLVED`, `branch_count = null` |

`branch_count = null` means *unknown*. It is never rendered as `0`. `0` asserts a
fact — that an institution has no branches — which no source here has established.

## V. Source hierarchy

Fixed order, applied by `BRANCH_SOURCE_PRIORITY`. **No scoring, and never "whichever
source has more rows."**

```
OFFICIAL_MFB (1) → NRB (2) → MEROLAGANI (3) → SHARESANSHAR (4) → OTHER_PUBLIC (5) → UNRESOLVED (6)
```

The decision engine walks this order and takes the **first usable** source. A tier is
skipped only when it yields no usable records for *that institution*. B21.10 asserts
that a lower tier with 900 rows never beats a higher tier with 3.

Sources are data, not code. `data/pilot/branch-source-registry.json` holds the URLs,
the discovery method, and the observed coverage; `buildBranchSourcePlan()` merges them
with the existing `BRANCH_DIRECTORY` capabilities in `pilot-sources.json`. Official
URLs are deliberately **not** duplicated into the registry, so re-pointing an official
page stays a one-file change.

## W. What the external sources actually contain (verified 2026-09-27)

| Source | Branch-level? | Population | Usable for the 51-MFI pilot |
|---|---|---|---|
| NRB `/bank-list/` | **Yes** — `S.N.｜Code｜Address｜District｜Branch Name｜Open Date` | 148 commercial **banks** | **No** — schema right, population wrong |
| Mero Lagani | No — 18 tables, 0 microfinance/branch/branch-institution sections | Listed NEPSE instruments only | No |
| ShareSansar | No — per-company pages carry one address/phone/email | 15 MFI instruments (correct population) | No — institution level only |

**This is the central finding of the extension.** The regulator has the right *shape*
of data and the wrong *population*; the secondary sources have the right population
and the wrong *granularity*. There is no public branch-level source for these MFIs, so
external fallback contributes **zero** additional MFI coverage today.

The generic adapter nevertheless reads the NRB table completely: **297/297 rows,
6/6 columns mapped, 0 refused**, 297 distinct 8-digit codes, 100% district/address/
open-date fill, 0 duplicate branch names. That is what makes the absence a *coverage*
finding rather than a *parser* finding.

The MFI-word regex over branch names is reported as a weak signal only, and it earns
that label: its single hit is `11001383 Extencion Counter, Rastriya Bima Sansthan`,
an insurer's counter. The population proof is the page's own institution selector —
148 banks, zero pilot MFIs.

## X. Identity, conflicts, corroboration

Identity is unchanged and is not re-invented per source:
`institution + normalized branch name + geographic discriminator`
(`branchIdentityKey`). Email, phone, map URL, row order and document order are never
part of it.

- Official + NRB agree on name and district → `CORROBORATED`, one identity, **two
  provenance rows** (B22.1–B22.7).
- Same name, different district → two identities **plus a geography conflict**;
  never silently normalised into agreement, never silently split (B22.8–B22.10).
- Three sources on one branch → one identity, three provenance rows (B22.11–B22.13).
- The same branch name in two MFIs → two branches; identity is institution-scoped
  (B22.22–B22.23).
- One source listing the same name in two districts → **two branches, not a
  cross-source conflict** (B22.20–B22.21). This was a real defect found while
  building the fixtures and fixed.

## Y. Repeat, idempotency, and supersession

`source_snapshots` and `data_assertions` have **no uniqueness constraint**. That is a
design constraint, not an obstacle: idempotency is achieved with a deterministic
identity plus an explicit read-then-write lookup, so no migration and no new column is
needed. Suppression still happens mostly *before* anything is written
(`planExternalRepeat`), because planning is where a no-op is cheapest — but the writer is
now safe on its own, and that is the part that matters when a plan is wrong or a second
process is mid-run.

| Observation | Snapshot | Assertions | Conflicts | Superseded |
|---|---|---|---|---|
| First ingest | 1 | all fields | 0 | 0 |
| Byte-identical re-run | 0 (reused) | 0 | 0 | 0 |
| **Formatting-only change** (canonical hash equal) | 0 | **0** | **0** | 0 |
| New record appears | 1 | only the new record | 0 | 0 |
| Branch **renamed** | 1 | new name asserted | old name → `NO_LONGER_LISTED` | old identity row |
| Non-identity field changed (address) | 1 | new value asserted | 1 field conflict | old address row |

A rename is recorded as *one identity stopped being listed and a new one appeared*,
not as a mutation — because the name is part of the identity, and asserting the old
name would assert a branch the source no longer lists. `NO_LONGER_LISTED` is explicitly
**not** evidence a branch closed.

### What the writer does now

Three operations were added to `EvidenceWriter`, all implemented in
`LocalSqliteEvidenceWriter` and all satisfied by the frozen schema:

- `findSnapshotByContentHash(sourceId, contentHash)` — reuse an existing snapshot for
  identical canonical content instead of appending a byte-identical row. Raw evidence
  is still preserved in full: a genuinely different body has a different canonical
  hash and is stored as its own snapshot.
- `findAssertions({entityType, entityId, fieldName, sourceId?})` — the deterministic
  lookup that makes "is this already asserted?" a read rather than a guess.
- `supersedeAssertion({id, validTo, status?, reason?})` — stamp `valid_to` and move the
  row to `STALE`, which the frozen `verification_status` CHECK already permits. Nothing
  is deleted: the earlier observation keeps its value, its source and its snapshot.

`semanticAssertionId` now includes `sourceId`. That is load-bearing. Without it, an
official page and a regulator both asserting `district = Dang` for one branch identity
hash to the *same* id, the second INSERT is ignored, and the second source's provenance
is lost permanently — one identity would carry one provenance row and "which sources saw
this branch?" becomes unanswerable. With `sourceId` in the key, a re-sighted claim from
the *same* source still collapses (idempotency), while two different sources each keep
their own row against the same entity (corroboration). B23 and P8 pin both halves.

### Superseded vs. superseded-pending

`applyExternalPlan` returns both, and the distinction is a real signal rather than
bookkeeping:

- `superseded` — the plan asked to close a value out and a current assertion was found
  and closed. `valid_to` set, status `STALE`.
- `superseded_pending` — the plan asked to close a value out and **no current assertion
  held it** (already superseded, or never asserted by this source). Re-applying the
  same plan lands here (B23.36–B23.37). This is an inconsistency worth investigating, so
  it is reported rather than swallowed; silently returning "done" would hide it.

`SUPERSEDED_PENDING` is an application-level reconciliation state. It is **not** a
database value: it is not a member of the frozen `verification_status` vocabulary, and
none was invented. P9.5 asserts that every status actually stored is one of
`UNVERIFIED`, `AUTO_VERIFIED`, `HUMAN_VERIFIED`, `CONFLICT`, `STALE`, `REJECTED`.

The earlier version of this section stated the opposite — that the writer could not
express supersession and that closing it was M3.5+ work. That was wrong about the
schema: `data_assertions.valid_to` and `STALE` were both already present. The gap was in
the contract, not the storage, and it is now closed.

This closes the idempotency item listed as open in section T, for the external path.

### Proof at the SQLite level

`scripts/smoke-branch-persistence.ts` (55 checks) runs against the real
`schema/schema.sql`, the real `LocalSqliteEvidenceWriter` and real SQL — no pure-helper
shortcuts, every expectation read back out of the database:

| Check | Scenario | Result |
|---|---|---|
| P1 | same source twice | 0 duplicate semantic assertions |
| P2 | same content, new snapshot id | 0 duplicate assertions from that source |
| P3 | formatting-only HTML change | canonical hash equal, no snapshot, no assertion |
| P4 | real attribute change | new + old retained, 1 current, old `STALE` |
| P5 | branch rename | old identity retained and superseded, new one created |
| P6 | same name, different districts | two identities, no false cross-source conflict |
| P7 | same branch name, two institutions | two identities |
| P8 | cross-source provenance | one identity, **two** rows, both sources present |
| P9 | supersession | old row `STALE` with `valid_to`, nothing deleted, vocabulary clean |
| P10 | zero-branch discipline | no `branch_count = 0` asserted anywhere |

P3 is worth stating precisely, because the two responsibilities are deliberately
separate. Tag case and whitespace are presentation: the canonicalizer collapses them, so
a re-laid-out page produces no new snapshot and no new assertion. **Column permutation
is not** — reordering a published table is a real change to the document, so the
canonicalizer is right to notice it; what survives is the extracted meaning, which is
the parser's job. P3.7 asserts a permuted page still yields identical semantic records
while P3.8 asserts its canonical hash genuinely differs. Neither layer is made to lie
for the other.

## Z. The controlled sample

`scripts/external-branch-sample.ts`, **3 controlled fetches**. `pilot-budget.json`
`maxFetches: 18` is **unchanged**.

| Role | Result |
|---|---|
| 2 official pages | `mfi-003` 212 records, `mfi-005` 9 records — both `VERIFIED_BRANCH_DIRECTORY` |
| 2 NRB records | `Head Office`, `Inaruwa`; 8 assertions written **through `EvidenceWriter`**; institution resolved `bank-nepal-bank` via `BFI_CODE` |
| 1 Mero Lagani | 0 branch rows |
| 1 ShareSansar | 0 branch rows |

Scratch DB: 5 sources, 4 snapshots, 8 assertions, 0 conflicts. The committed evidence
databases were not touched.

Registry tier order as actually resolved: `mfi-003 → OFFICIAL_MFB > NRB > MEROLAGANI >
SHARESANSHAR`; `mfi-002` (no official branch URL) → `NRB > MEROLAGANI > SHARESANSHAR`.

## AA. Coverage, reported separately

Never conflate these two numbers.

- **Official parser coverage** (sections A–T, unchanged): 18/35 verified, 6 unread,
  1 partial, 6 single-location, 2 intent-unstructured, 2 locator-unrendered; 7 need work.
- **Usable branch-evidence coverage** (this extension): all 35 targets are served by
  their own official site. External fallback adds **0** MFI branches, because no
  verified public source carries them.

These two numbers answer different questions and neither implies the other. Parser
coverage says whether a page's branch structure could be read. Evidence coverage says
whether a branch count could be stated at all. A target can be parser-resolved and still
have an unknown count — 6 targets are exactly that case (single-location: a location is
published, a count is not), which is why `SINGLE_LOCATION_CONTACT` reports
`branch_count: null` rather than `0` or `1`.

A target whose official page is unusable resolves to `D_UNRESOLVED` with
`branch_count = null`.

## AB. No bypass

External data has no path around the pipeline. It goes
fetch → canonical hash → semantic extract → validate → assert → provenance, and
reaches `data_assertions`/`data_conflicts` only via `EvidenceWriter`. Three guards
enforce it:

- `applyExternalPlan` **throws** rather than write an assertion with no snapshot — an
  unattributable fact is refused.
- Provenance is carried on the existing backbone, so an external record is
  indistinguishable in shape from an official one and permanently attributable:
  `sources` / `source_snapshots` / `data_assertions` / `data_conflicts`.
- `branch-external.ts` itself contains no SQL. The statements added in section Y live
  in `LocalSqliteEvidenceWriter`, which is the writer layer's own job; the module above
  it can only ask, and it reports honestly when the answer is that there is nothing
  current to close out.

## AC. Regressions

Re-run after the persistence work in section Y, at this HEAD:

- `smoke-branch-persistence.ts` — **55 ok / 0 fail** (new; real schema, real writer,
  real SQL, P1–P10).
- `smoke-branch-external.ts` — **169 ok / 0 fail** (B19 adapter, B20 matching ladder,
  B21 decision engine, B22 reconciliation, B23 repeat/idempotency/supersession, B24
  registry). Up from 153: the B21 zero-count corrections and the B23 supersession
  rewrite are net additions, not a reduction in coverage.
- `smoke-structured.ts` — 209/0, unchanged.
- `tsc --noEmit` clean.
- Full matrix green: structured 209/0, branch-external 169/0, branch-persistence 55/0,
  ingest 54/0, security 50/0, M3.3 95/0, api 36/0, dataapi 42/0, pdf+canonical 25/0,
  schedule 40/0, compare 27/0, alerts 18/0, worker pass, people 32/0,
  `check:discipline` clean, `build` clean.

Three test expectations were corrected during this work, and each correction is worth
recording because in all three cases the **code was right and the test was wrong**:

1. P3 expected a column-permuted page to be canonically stable. It is not, and should
   not be — reordering a published table is a real change. The canonicalizer collapses
   formatting; the parser absorbs structure. P3.7/P3.8 now pin both halves separately.
2. B23 expected `superseded_pending` to be non-zero and nothing to be `STALE`. The
   pending counter is now zero on a clean pass, and re-applying the same plan correctly
   reports 1 pending because the value is no longer current.
3. B21.17 expected a single-location contact page to assert `branch_count = 0`. That was
   the false zero this gate exists to eliminate.

## AD. Extension status

`HOLD` — unchanged from section T, and now for a sharper reason.

Closed by this extension: the external architecture exists, is registry-driven, is
generic, preserves provenance, resolves identity, handles conflicts and repeats, and
adds **zero** MFI branch coverage because no public source supplies it.

Still open:

- 7 of 35 official targets need structural work (section N). All 7 are now **classified**
  (N.1) from evidence already held, with no new fetch: 1 `PARTIAL_BRANCH_DIRECTORY` and
  6 `BRANCH_STRUCTURE_UNREAD`. What remains is the structural work itself, which needs
  reusable shapes rather than per-site selectors.
- The two suspected map-published branch networks (`swbbl-website`, `mlbsl-website`) are
  the highest-value remaining item: both are large and both clearly publish branch data
  that the current deterministic fetcher cannot read. They are *suspected* rather than
  classified that way, because the client-render indicator threshold did not fire.
- External fallback is proven on a **bank** table. It is not yet proven against a real
  MFI branch table, because none is publicly available. Any MFI-branch source that
  appears later must pass B19 against its real HTML before it is trusted.
- Nothing here justifies M3.5 or production assertion.

Closed since the previous revision of this document:

- The `superseded_pending` marking gap (section Y). The writer contract now expresses
  supersession, so it is applied rather than counted, using the frozen `valid_to` and
  `STALE` columns. Proven at the SQLite level by P4, P5 and P9.

### Three states that must never be conflated

A count of zero is a *finding*, and it is the easiest thing in this system to assert by
accident. The vocabulary is now explicit, and the code enforces it:

| State | Meaning | Where it comes from |
|---|---|---|
| **NO BRANCHES** | a reliable source explicitly proved zero | only a `VERIFIED_BRANCH_DIRECTORY` / `PARTIAL_BRANCH_DIRECTORY` that parsed and held no branches (B21.17g) |
| **BRANCH DATA NOT FOUND** | no branch evidence was found, and nothing is claimed | `NOT_A_BRANCH_PAGE` → `branch_count: null` (B21.17e) |
| **BRANCH DATA EXISTS BUT CURRENT FETCHER CANNOT ACCESS/RENDER IT** | the data is there, this path cannot read it | `UNREADABLE_BODY`, `BRANCH_STRUCTURE_UNREAD`, `BRANCH_LOCATOR_UNRENDERED`, `BRANCH_INTENT_NO_STRUCTURE` → `branch_count: null` |
| **location known, total unknown** | a branch demonstrably exists, the count does not follow | `SINGLE_LOCATION_CONTACT` → `branch_count: null` (B21.17, B21.17j) |

The correction worth recording: `SINGLE_LOCATION_CONTACT` and `NOT_A_BRANCH_PAGE`
previously returned `branch_count: 0` and were labelled official-resolved. Both were
wrong, in the same direction. A single contact block is not a statement that an
institution has no branches, and a page with no branch structure says nothing about
branches at all; either one asserted as `0` publishes an MFI as branch-less on the
strength of a page that never claimed it. They remain official-resolved and still block
external fallback, because the official source *did* answer — but they now report
`null`, and `branch_evidence_available` is separated from "count known" so that "we found
something" is never read as "we know the total". P10.1 asserts no `branch_count = 0`
exists anywhere in the persistence suite.

### Application vs. database status vocabulary

`REVIEW`, `VERIFIED` and `SUPERSEDED_PENDING` are **application-level** lifecycle states.
The database keeps its frozen `verification_status` vocabulary: `UNVERIFIED`,
`AUTO_VERIFIED`, `HUMAN_VERIFIED`, `CONFLICT`, `STALE`, `REJECTED`. No value was added to
that CHECK constraint, and P9.5 asserts every status actually stored is one of the six.
