# M3.4 — Phase 3: Generic Branch Value Plausibility

**Constraint honoured:** no institution-specific blacklists. Every rule is a
generic phrase class (office vocabulary, collection nouns, announcement nouns,
role nouns, org-unit nouns, province/district geography). No MFB name, city
beyond the existing generic `DISTRICT_WORDS` gazetteer, or URL pattern is used.

---

## 1. What was measured before changing anything

A 50-value battery of the Phase 3 rejection list was run against the
pre-Phase-3 `isAssertableBranchName`. **15 of 50 leaked** (i.e. would have
asserted):

| Leaked value | Why it passed |
| ------------ | ------------- |
| `Corporate Office` | `corporate` not in the bare-token set |
| `Office Hours` | `hours` not in the bare-token set |
| `Branch Network`, `Branch List` | collection nouns not excluded |
| `Bagmati Province`, `Koshi Province` | `province` is a branch marker, so place+province passed |
| `Branch Finance Department`, `Branch Training Department` | only the *unit* noun was generic; `finance`/`training` were not |
| `Branch Officer`, `Branch In Charge` | `officer`/`charge` not generic |
| `Branch Annual Meeting Notice` | announcement nouns unknown |
| `Branch Recruitment Notice` | announcement nouns unknown |
| `Branch Press Release` | announcement nouns unknown |
| `Branch Training Workshop` | announcement nouns unknown |
| `Branch Annual General Meeting` | announcement nouns unknown |

Root cause: the old rule was *"has a branch marker AND not every token is
bare"*, so **any single extra non-bare token made a value assertable**.

## 2. Rules added

Four generic word sets plus a tail check, all in
`lib/ingestion/structured.ts`:

| Set | Purpose | Examples |
| --- | ------- | -------- |
| `NON_PLACE_WORDS` | every word is office vocabulary ⇒ no place in the value | `corporate`, `hours`, `network`, `finance`, `monday` |
| `COLLECTION_TAIL_WORDS` | marker + collection tail ⇒ list heading | `Branch Network`, `Branch List`, `All Branches` (excludes `branch`/`office` so real names pass) |
| `NOTICE_WORDS` | announcement/event/document noun anywhere ⇒ reject | `notice`, `press`, `meeting`, `training`, `vacancy`, `tender` |
| `ROLE_WORDS` | job title anywhere ⇒ reject (a branch is a place) | `officer`, `charge`, `accountant`, `teller` |
| `UNIT_WORDS` | org-unit noun anywhere ⇒ reject | `department`, `committee`, `board`, `secretariat` |
| province rule | `province` present and no district word anywhere ⇒ reject | `Bagmati Province` |

Result: **0 leaks / 50**, with **0 recall loss** on 9 real names
(`Mahuli Branch`, `Branch Office Baniyani, Jhapa`, `Narayan Na.Pa. Branch, Dailekh`, …).

### Deliberate strictness

- `province` + no district word is rejected even in e.g. `Bagmati Province
  Branch`. Ambiguous with a section label; refusing to assert is the safe
  direction and the row's address evidence is still kept.
- A bare place with no branch marker (`Mahuli`) stays rejected. It is
  indistinguishable from a person name in a name column, so it remains
  evidence-only by design.

## 3. New `isAssertableBranchAttribute`

Attributes are already evidence-only by confidence (0.45 < the 0.5 assertion
gate), so this gate does not decide assertion. It decides whether a value is
usable evidence at all, and returns a **stable reason code** so Phase 14 can
group rejections instead of one opaque bucket.

```ts
isAssertableBranchAttribute(field: string, raw: string):
  | { ok: true; value: string }
  | { ok: false; reason: BranchAttributeRejection }
```

Reason codes: `EMPTY`, `TOO_LONG`, `CONTAINS_LETTERS`, `CONTAINS_URL`,
`DATE_LIKE`, `DIGIT_COUNT`, `REPEATED_DIGITS`, `NOT_A_DISTRICT`,
`GENERIC_LABEL`, `EMAIL_FORMAT`, `MAP_SCHEME`, `MAP_HOST`, `UNKNOWN_FIELD`.

| field | rule |
| ----- | ---- |
| `BRANCH_DISTRICT` | must be an exact `DISTRICT_WORDS` entry, else `NOT_A_DISTRICT` |
| `BRANCH_PLACE` | no URL, not digits, not a bare generic label |
| `BRANCH_PHONE` | digits + human separators only; not letter-bearing, not date-like, 7–15 digits, no 6+ repeated-digit run |
| `BRANCH_EMAIL` | `local@domain.tld` with an alphabetic TLD |
| `BRANCH_MAP_URL` | `https:` only, host must be a known mapping provider. **Never fetched.** |
| anything else | `UNKNOWN_FIELD` — a future caller cannot pass an unvalidated attribute through |

Wired into the emit loop (`structured.ts`), so a rejected attribute never
reaches `validation_results.evidence_json` at all.

## 4. False-positive measurement on all 35 live targets

Readability moved 16 → 13 pages. **Every page that crossed the ≥2-name
threshold did so because names were removed that should never have asserted.**
No legitimate name was lost.

| source | before | after | what was removed |
| ------ | -----: | ----: | ---------------- |
| sampadalaghubitta | 71 | 0 | 71 × `NAME (Branch manager)` person attributions, e.g. `SIRJANA ARYAL (Branch manager)` |
| mero | 155 | 148 | `Branches & Monitoring Stations`, `Contact Contact Us Find Us Branches`, `No branches match your filters.`, `Branches with GPS coordinates are shown on the map. Click any marker for details.`, +3 similar UI strings |
| supportmicrofinance | 14 | 12 | `Branch Network` (h1) and `Branch Network` (h3) |
| nerudemirmire | 3 | 0 | `List of Branch Managers`, `Branch Manager Details`, `Corporate Office` |
| rsdcmf / swmfi / slbsl / mlbsl | 2 / 1 / 1 / 1 | 1 / 0 / 0 / 0 | single junk values; none was directory evidence |

Unchanged: nirdhan 168, chhimek 212, gblbs 191, aarambha 132, asha 132,
nadeplaghubitta 89, mslbsl 63, dhaulagiribank 58, jucbank 39, skbbl 11,
forwardmfbank 2, nationalmicrofinance 1.

`sampadalaghubitta` deserves emphasis: the page **does** contain 155
gate-acceptable real names (`Haramtari Branch`, `Ghyampesal Branch`, …) but
they appear in body cells, not headings or a record table, so no current
extractor associates them. That is a genuine **coverage** gap for Phase 5, and
it must be closed structurally — never by loosening this gate.

## 5. Regression protection

New fixture block **B7** in `scripts/smoke-structured.ts`:

- 48 MUST_REJECT generic values → 0 leaks
- 9 MUST_ACCEPT real names → 0 lost
- 5 specific values that measured asserting on real targets
- 16 attribute-gate cases covering every field and reason code

`smoke:structured` 129 ok / 0 fail. Full suite green: people 32, m33 95,
generic-ext 48, discovery 45, idempotency 33, plausibility 30, api 36,
ingest 54, ingest-security 50, discipline, build, typecheck.

No schema change, no migration, no assertion written, nothing committed.
