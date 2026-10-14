# CANONICAL-MODEL — Phase P0.2

**Status:** FROZEN (Phase P0.2). Logical model.
**Storage-independent.** No table, file, or adapter is treated as truth here.

> Two claims in the P0.1 documents were **contradicted by direct measurement**
> during P0.2 and have been corrected. See §12. This is why reconciliation
> exists.

---

## 1. Status vocabulary

| Mark | Meaning |
|---|---|
| **IMPLEMENTED** | Table exists, has rows, and something reads them |
| **EMPTY** | Table exists, schema is correct, **0 rows** |
| **ASSERTION-ONLY** | Real data exists as `data_assertions`, never promoted to the normalized table |
| **CONCEPTUAL** | Defined here; schema does not support it |
| **DEFERRED** | Defined here, deliberately not implemented |

---

## 2. Measured ground truth

From direct read-only inspection of the repository during P0.2.

### `lk.db` — 53 tables, 9 non-empty, 44 empty

| Non-empty | Rows |
|---|---|
| `institutions` | 51 |
| `institution_aliases` | 120 |
| `official_links` | 51 |
| `outbound_links` | 51 |
| `timeline_events` | 62 |
| `institution_coverage` | 51 |
| `sources` | 21 |
| `ingestion_sources` | 10 |
| `field_refresh_policies` | 8 |

Everything else is **0**: `branches`, `people`, `positions`, `committees`,
`financial_reports`, `financial_metrics`, `interest_rates`, `documents`, `jobs`,
`news`, `posts`, `products`, `services`, `social_accounts`, `digital_services`,
`nrb_*`, `regulatory_events`, `data_assertions`, `source_snapshots`,
`data_conflicts`, `ingestion_runs`, `validation_results`, `audit_logs`,
`users`, `roles`, `slug_aliases`, `institution_symbols`, `branch_history`,
`committee_members`, `dividends`, `book_closures`, `document_extractions`,
`post_sources`, `events`, `research`, `videos`, `metric_definitions`,
`validation_rules`, `document_categories`.

`lk.db` is therefore a **seed-backed operational store holding the institution
universe**, not a canonical store holding evidence. Calling it canonical is
specifically prohibited by directive §21.

### `data/pilot/evidence/*.db` — 13 files

| Measure | Value |
|---|---|
| Files | 13 |
| `data_assertions` | **5,083** |
| `source_snapshots` | **1,458** |
| `data_conflicts` | **229** |
| Total size | ~18 MB |

Assertions by entity:

| `entity_type` | Rows | Note |
|---|---|---|
| `institution` | 4,884 | **lowercase** |
| `FINANCIAL` | 153 | **UPPERCASE** |
| `VACANCY` | 38 | **UPPERCASE** |
| `BRANCH` | 8 | **UPPERCASE** |

Assertions by verification status: `UNVERIFIED` 5,071 · `STALE` 9 · `REJECTED` 3.

Hot fields: `branch_name` 2,932 · `website` 805 · `document_title` 443 ·
`people_director` 226 · `people_board` 295 · `vacancy_title` 75 ·
`SOURCE_DOCUMENT` 84 · `people_ceo` 74 · `DOCUMENT_TITLE` 57 ·
`DOCUMENT_TYPE` 40 · `RATE_KIND` 8.

**Two casing conventions coexist in one table.** See §11 MISMATCH-1.

### `data/master/master.json`

```json
"universeSnapshot": {
  "source_id": "nrb-bfi-mid-may-2026",
  "title": "NRB BFI list (English, mid-May 2026)",
  "observed_at": "2026-06-20",
  "counts": { "institutions": 51, "aliases": 120,
              "official_links": 51, "timeline": 62, "sources": 11 }
}
```

Top-level keys: `universeSnapshot`, `institutions`, `aliases`, `officialLinks`,
`timeline`, `sources`. Per-institution it carries `source_grade_identity`;
per-alias `normalized_alias` + `source_grade`; per-timeline-event `predecessor_id`
+ `predecessor_name`; per-official-link `verified`, `verified_at`, `status`.

**It is a seeded NRB-derived universe snapshot** (§19). It is not the permanent
canonical store and does not grow.

---

## 3. The five-layer relationship

```
SOURCE          what a publisher says        → sources, source_snapshots
   ↓
ASSERTION       a statement about a field    → data_assertions  (source-owned)
   ↓
CONFLICT        sources disagree             → data_conflicts
   ↓
ENTITY          our normalized reading       → institutions, people, branches, …
   ↓
PROJECTION      shaped for one consumer      → InstitutionSummary, PersonDto, …
```

Assertion → Entity promotion is a **decision**, not a side effect. The tables are
separate because a source's claim and our interpretation are different things
and must remain separately auditable.

---

## 4. Institution

**Purpose:** the anchor entity. Every other concept attaches to an institution.

**Canonical identity:** `institutions.id` (stable, internal, never changes) plus
`institutions.slug` (public URL key, mutable via `slug_aliases`).

Identity vs name — the distinction the model must hold:

| Layer | Field | Mutable? |
|---|---|---|
| Canonical identity | `id` | **Never** |
| Public URL key | `slug` | Yes, via `slug_aliases` |
| Legal name (EN) | `name_en` | Yes — a rename does not change identity |
| Legal name (NP) | `name_np` | Yes |
| Short name | `short_name` | Yes |
| Alternative spelling | `institution_aliases.alias` | Append-only |
| Historical name | `institution_aliases.alias_type='FORMER'` | Append-only |
| Current status | `institutions.status` | Point-in-time only |
| Corporate lineage | `timeline_events` | Append-only |
| Source-specific identity | `institution_aliases.alias_type='TICKER'` etc. | Append-only |

**`current name ≠ permanent identity` is a frozen rule.** A rename produces a
`RENAMED` timeline event and a `FORMER` alias; it does not mutate `id`.

**Lifecycle:** `LICENSED → ACTIVE → { MERGED | ACQUIRED | RENAMED | SUSPENDED →
INACTIVE | LIQUIDATED }`. Status is a point-in-time scalar in the schema
(**no status history** — FUTURE SCHEMA GAP 1). Lineage is carried by
`timeline_events`.

**Source/evidence:** `institutions.source_id` is a **single** source pointer, and
`last_verified_at` a single date. Real provenance is per-field and lives in
assertions plus the frontend `evidence` map (§ FIELD-PROVENANCE-MODEL).

**Status:** **IMPLEMENTED.** 51 rows. 6-status CHECK, 2-type CHECK.

---

## 5. Institution Alias

Append-only. `UNIQUE (institution_id, alias)` — an alias cannot be re-added.
Six types: `TICKER`, `TICKER_PROMOTER`, `NAME_ALT`, `NAME_NP`, `FORMER`, `SHORT`.
`is_active` allows soft retirement; it never deletes history.

**Status:** **IMPLEMENTED.** 120 rows in `lk.db`, 120 in `master.json`.
Note `master.json` additionally carries `normalized_alias` and `source_grade`
which the table has no column for (**MISMATCH-4**).

---

## 6. Institution Status — CONCEPTUAL vs IMPLEMENTED

Conceptually a first-class entity with history. In the schema it is a single
`status` column on `institutions`, with no transition log and no effective dates.

- **Concept:** status is an observation over time.
- **Current implementation:** status is a current value.
- **Gap:** you cannot ask "when did this institution become MERGED?" from the
  normalized layer. You can infer from `timeline_events`, which is not the same
  thing. **FUTURE SCHEMA GAP 1.**

---

## 7. Corporate Event

`timeline_events`: 8 typed events (`LICENSED`, `MERGED`, `ACQUIRED`, `RENAMED`,
`LISTED`, `DELISTED`, `SUSPENDED`, `HEAD_OFFICE_MOVED`) with `occurred_at`,
`summary`, `source_id`, `UNIQUE (institution_id, event_type, occurred_at)`.

**Status:** **IMPLEMENTED.** 62 rows.

**Critical gap:** the schema has **no predecessor or successor column**.
`master.json` carries `predecessor_id` + `predecessor_name`, and `src/data/nrb.ts`
carries 62 `NrbRegulatoryEvent` records with free-text titles — but neither can be
persisted relationally. Lineage is currently **unrepresentable as a graph**.
**FUTURE SCHEMA GAP 2.** See also `nrb_institution_links.link_type =
'MERGED_BY_NRB'` (24 rows in generated data) as the partial workaround.

`events` is a **separate, polymorphic** table (nullable FKs to institution, person,
branch, document; unconstrained `event_type`) and is **EMPTY**. It overlaps
`timeline_events` without a defined precedence. **MISMATCH-8.**

---

## 8. Person

`people`: `name_en`, `name_np`, `tier` (1/2/3), `photo_url`, `email`, `education`,
`bio`, `source_id` (NOT NULL), `last_verified_at`.

**Status:** **EMPTY (0 rows).** Real data exists as **ASSERTION-ONLY**:
629 assertions (`people_board` 295, `people_director` 226, `people_ceo` 74,
`people_chair` 34), of which `src/data/people.ts` exposes 108, all `UNVERIFIED`.

**M3.6B lifecycle semantics are preserved and must not be redesigned.** A person
is a name plus a source. All role history lives in `positions`. Leaving a role
closes a position; it never erases the person.

Privacy note: `people` describes **public-role individuals** — executives,
directors, committee members. This is distinct from member/borrower data, which
is prohibited outright.

---

## 9. Position

`positions`: `person_id`, `institution_id`, `role`, `committee`, `appointed_at`,
**`ended_at`**, `is_current`, `source_id`, `tier`,
`UNIQUE (person_id, institution_id, role, appointed_at)`.

**`ended_at` is the mechanism that preserves historical tenure.** A departing CEO
gets `ended_at` set and `is_current=0`. The row survives. This is the single most
important field in the people model and it is **frozen**.

**Status:** **EMPTY (0 rows).** ASSERTION-ONLY via the `people_*` fields.

Derived semantics already honoured: `PersonPositionDto.shared_by` (in
`lib/repository/types.ts`) reports how many people a source listed under one role
heading. A role slot is **not** single-occupancy by default — several directors
under one heading is normal and must be reported, not "fixed".

---

## 10. Committee / Committee Member

`committees`: `institution_id`, `name`, `committee_type` (`BOARD`/`AGM`/`SUB`/
`OTHER`), `formed_at`, `dissolved_at`.
`committee_members`: `committee_id`, `person_id`, `role_in_committee`,
`from_date`, `to_date`, `UNIQUE (committee_id, person_id, from_date)`.

Note the **third** temporal pair: `formed_at`/`dissolved_at` on the committee,
`from_date`/`to_date` on the membership, `appointed_at`/`ended_at` on a position.
Three different names for the same idea. **MISMATCH-9.**

**Status:** **EMPTY (0 rows).** Committee data currently rides inside the
`people_board` / `people_director` assertion fields with no committee structure.

---

## 11. Branch

`branches`: own identity (`id`, `UNIQUE (institution_id, branch_name)`),
`branch_type` (`HEAD_OFFICE`/`BRANCH`/`CONTACT_OFFICE`/`SERVICE_CENTER`),
`province` (NOT NULL), `district` (NOT NULL), `municipality`, `ward`, `address`,
`phone`, `email`, `manager_person_id` → `people`, `geo_lat`/`geo_lng`,
`opened_at`, `status` (`OPEN`/`CLOSED`), `source_id`, `last_verified_at`.

Hierarchy: **Institution → Branch → Geography**, with geography denormalized onto
the branch (`province`/`district`/`municipality`/`ward`) plus coordinates. There
is no separate geography table. **MISMATCH-6.**

`branch_history`: `OPENED`, `CLOSED`, `RELOCATED`, `RENAMED`, `TYPE_CHANGED` with
`occurred_at`, `from_value`, `to_value`, `note`. This is how branch history is
expressible.

**Status: ASSERTION-ONLY — P2-B CLOSED.** `branches` = 0 rows,
`branch_history` = 0 rows (deliberate: `province`/`district` are NOT NULL but
absent from evidence for every MFI branch; see
[docs/data/P2-B-BRANCHES-AUDIT.md](./P2-B-BRANCHES-AUDIT.md) §4).
Real data: **2,930 `branch%` assertions** for 19 MFI stub entities in the
durable store; `isAssertableBranchNameValue` rejects 97 headings/bare districts,
leaving **1,898 published branches across 19 institutions** in
`src/data/branches.ts`, all `UNVERIFIED`, re-keyed to
`branchIdentityKey(institutionId, name)`.

**Directive §8 warning honoured:** presence in `src/data` does **not** make a
branch canonical. An `UNVERIFIED` assertion is a lead for verification, not a
branch record.

---

## 12. Center — CONCEPTUAL / DEFERRED

```
Status: DEFERRED IMPLEMENTATION
```

A Center is a group-meeting unit below a Branch. **No table exists.**

Conceptual placement:

```
Institution
    ↓
Branch
    ↓
Center        ← conceptual, deferred
    ↓
Geography     (shared with Branch)
    ↓
Activity      (future; Centers are a likely Activity venue)
```

Attributes it will need: `institution_id`, `branch_id` (nullable — a Center may
outlive or precede its branch), name, meeting cadence, status, geography,
`opened_at`/`closed_at`, `source_id`.

**Explicitly not modeled, ever:** member/borrower records, attendance, group
composition, savings balances, loan ledgers. Centers are **venues**, not member
registries. Any design that needs a member table is out of bounds.

**Requires an approved migration (FUTURE SCHEMA GAP 3).** Not written in P0.2.

---

## 13. Geography

No table. Denormalized onto `branches` (`province`, `district`, `municipality`,
`ward`) and `institutions` (`head_office_district`, `head_office_municipality`).

`getProvinceFromHeadOffice()` in `src/data/institutions.ts` derives province from
a free-text head-office string — that is a **display convenience**, and it is
inferred, not sourced.

**Status:** **CONCEPTUAL** (as an entity). Village/municipality restructuring makes
a real geography entity valuable, but it is not required to publish. Deferred.

---

## 14. Financial Record / Financial Metric

Two distinct levels, and the naming matters:

| Concept | Table | Status |
|---|---|---|
| **Financial Report** (a document/period) | `financial_reports` | **EMPTY** |
| **Financial Metric** (a number) | `financial_metrics` | **EMPTY** |
| Financial *document* (a file we know exists) | — | **ASSERTION-ONLY** |

`financial_reports`: `report_type` (6 values), `period`, `period_end`,
`fy_label_np`, `status` (`DETECTED`→`EXTRACTED`→`VALIDATED`→`PUBLISHED`/`FAILED`),
`source_id`, `published_at`, `UNIQUE (institution_id, period, report_type)`.

`financial_metrics`: `metric_code` → `metric_definitions`, **four parallel value
columns** — `value_npr` / `value_pct` / `count_value` / `year_value` — plus
`reported_value` (NOT NULL, as-printed) and `normalized_value`. `CHECK` requires at
least one numeric column. `verification_status` + `last_verified_at`.

**`reported_value` + `normalized_value` is the correct pattern**: keep what the
source printed alongside what we computed. Frozen.

`metric_definitions` (EMPTY) is the dictionary: `name_en`, `name_np`, `category`
(`KEY`/`ASSET_QUALITY`/`CAPITAL`/`PROFITABILITY`/`EFFICIENCY`/`OTHER`), `value_type`
(`AMOUNT`/`RATIO`/`COUNT`/`YEAR`), `formula`, `lower_bound`, `upper_bound`.
The `formula` column is where derived values declare their dependency.

**Reality:** 153 `FINANCIAL` assertions exist, but they are **document-level**
(`document_title`, `document_type`, `RATE_KIND`, `SOURCE_DOCUMENT`) — we know
48 financial documents exist. **`financial_metrics` is 0 rows. Not one number has
been extracted.** Since **P2-C**, `src/data/financials.ts` carries the raw
assertions (123 published after the plausibility/retirement gates) and the single
document view is projected from them in `lib/repository/projection.ts`
(`financialsFromAssertionRows` → `FinancialDocumentDto`) — identity re-keyed
through the source publisher, `CONFLICT` computed from open conflicts, 23
documents re-attributed to the correct institution. Still exactly what the
evidence states: 48 documents, contents never read. See
[P2-C-FINANCIAL-AUDIT.md](P2-C-FINANCIAL-AUDIT.md).

Paid-up capital is the exception: it lives as `paidUpCapitalCrore` on the
frontend `Institution` with grade-A provenance, sourced from the NRB BFI list —
a directory column, not an extracted financial metric.

---

## 15. Interest Rate

`interest_rate_periods` (period code, label, `fiscal_year`, `published_at`,
`source_id`, `url`) → `interest_rates` (`institution_id`, `period_id`,
`rate_type` 9 values, `product_name`, `rate_pct`, `min/max_amount_npr`, `tenure`,
`is_active`, `source_id`, `last_verified_at`).

Two-level split is correct: a rate is always **as of a period**. `rate_pct` NOT
NULL — a rate with no number is not a rate.

**Status: EMPTY (`interest_rates` 0 rows).** 8 rate notices exist as assertions
(`RATE_KIND` 8); since **P2-C** they are published by the canonical document layer
as `kind: "RATE"` with `rate_pct` left `null` — the notice body was never read.

---

## 16. Document

`documents`: rich. `category` → `document_categories` (self-referencing
`parent_code`, so a category tree is supported), `official_url` (NOT NULL),
`canonical_url`, `period`, `published_at` (NOT NULL), `discovered_at`,
`last_checked_at`, `content_hash`, `file_size`, `mime_type`, `language` (default
`'np'`), `archive_policy` (4 states: `LINK_ONLY`/`OPTIONAL`/`ARCHIVE`/
`REGULATORY_ARCHIVE`), `archived_locally`, `r2_key`, `availability_status`,
`extraction_status`, `outbound_link_id` → `outbound_links`.

`document_extractions`: per-document, per-field extraction with
`value_raw` / `value_npr` / `value_pct` / `value_count` / `unit` / `page_number` /
`table_index` / `parser_version` / `confidence`.

**`page_number` + `table_index` + `parser_version` is what makes an extraction
auditable.** A number without a page reference cannot be checked. Frozen
requirement.

**Status:** `documents` **EMPTY**; `document_extractions` **EMPTY**;
`document_categories` **EMPTY**. **ASSERTION-ONLY**: 443 `document_title`
assertions + 57 `DOCUMENT_TITLE` + 40 `DOCUMENT_TYPE` (note: two casings for the
same concept — MISMATCH-1). 96 documents counted by `crawlSummary`.

**P2-D — the general document layer now projects.** `DocumentDto`
(`lib/repository/types.ts`) is the canonical general-document read model:
identity `document-<institution_id>|<observed title>` (trim + whitespace
collapse only), institution columns from the publisher→registry resolution,
`status` `ACTIVE`/`CONFLICT` computed from open conflicts, title plausibility
gate (call-to-action labels and the institution's own name are withheld).
`src/data/documents.ts` (generated: 331 assertions → **330 records**, 1
`NOTICE` + 329 links, 20 institutions) feeds `allPublishedDocuments()` and the
`/documents` page. **`official_url` / `go_slug` / `period` are `null` on every
record** — evidence carries no URL or date for these records, and the table
stays empty (assertion-only; `lk.db documents = 0`, smoke PD-10). Financial
documents remain their own P2-C view (`FinancialDocumentDto`) — three layers,
one concept, no representation pretending to be another (reconciliation row 13).

---

## 17. Job

`jobs`: `slug`, `institution_id`, `title`, `department`, `location` (NOT NULL),
`employment_type` (4 values), `experience`, `education`, `deadline` (NOT NULL),
`description`, `application_method`, `application_url`, `is_active`,
`published_at`, `source_id`, `last_verified_at`. Indexed on
`(institution_id, is_active, deadline)`.

**Status:** **EMPTY.** **ASSERTION-ONLY**: 38 `VACANCY` assertion rows (37
entities) + 75 `vacancy_title` title-only rows — **P2-D: both shapes now
project** into `src/data/jobs.ts`: 100 unique claims → **99 records** (63
`POSTING`, 36 `DOCUMENT`) across 19 institutions. Identity is canonical
`vacancy-<institution_id>|<tail>`: entity-keyed rows keep their tail
byte-for-byte and are re-keyed only on the institution segment (resolved
publisher → registry, never the store's pilot numbering); institution-keyed
`vacancy_title` rows synthesise `vacancy-<institution_id>|<title>`. The two
representations are disjoint and never merged on title similarity.
`deadline` stays `null`, `location`/`type` stay the literal
`"(location not observed)"` / `"(type not observed)"` placeholders — no
deadline/location/employment-type evidence exists. `lk.db jobs = 0`
(assertion-only; smoke PD-10).

**Honest self-description in the data:** `src/data/jobs.ts` declares
`kind: "POSTING" | "DOCUMENT"`. **36 rows are `"DOCUMENT"`** — a link to an
**unread** vacancy notice, with `location` and `type` set to the literal strings
`"(location not observed)"` / `"(type not observed)"`. We do not know where these
36 jobs are or what type they are. The data says so. **63 rows are `"POSTING"`**
— 62 with a title observed as link text on the institution's own careers page,
plus the one parsed `JOB_TITLE` (mfi-012) whose `APPLICATION_URL` assertion was
read (P2-D; before P2-D this population was 37 records — 36 + 1 — from the
`VACANCY` shape alone).

**P0.3 retraction — this was a false finding.** An earlier draft of this document
claimed `jobsProvenance` ("1 parsed posting") disagreed with the array (holding 2
`POSTING` rows). **That claim was wrong**, twice over:

- The count was produced by text-matching `kind: "POSTING"` across the file, which
  matched the real data row (`jobs.ts:562`) **and** the TypeScript type
  declaration inside `export interface Job` (`jobs.ts:31`). The tell was
  arithmetic: 36 + 2 = 38 ≠ 37 records.
- 36 DOCUMENT + 1 POSTING = **37 = array length = the provenance string's own
  headline count.** The string is arithmetically correct.

`scripts/build-jobs-module.ts:224-231` derives the array and all three counts from
the single `dtos` binding in the same statement block, so drift is structurally
impossible on this path. Independent DB confirmation: 38 `VACANCY` assertion rows
collapse to 37 distinct `entity_id`s; exactly one carries `JOB_TITLE`, 36 carry
only `SOURCE_DOCUMENT`.

**The real, smaller finding:** nothing tests provenance↔array consistency, so a
genuine future drift would be invisible to CI. See §30 MISMATCH-10 (corrected).

---

## 18. News / Update

Three overlapping tables, all **EMPTY**:

| Table | Purpose | Note |
|---|---|---|
| `news` | ingested news items | `source_type` OFFICIAL/NRB/KHABAR/MEDIA, `status` 5 states incl. DRAFT |
| `posts` | authored/editorial content | `post_kind` 6 values, SEO fields, `author_id` → `users` |
| `research` | long-form analysis | SEO fields, `author_id`, 3 states |

`post_sources` maps posts to their evidence with `relation`
(`BASED_ON`/`QUOTED`/`ATTRIBUTION`).

**Concept:** one canonical "update" concept with three provenance flavours —
ingested (`news`), authored (`posts`), analysis (`research`).

**Reality:** `src/data/nrb.ts` has 97 `nrbDocuments` + 62 `NrbRegulatoryEvent`.
These are **regulatory documents and events**, not news. No news entity has data
— the `news`/`posts`/`post_sources` tables stay at 0 rows everywhere (P2-E
smoke PE-10 asserts this). What exists instead is the **canonical content
projection** ([P2-E](P2-E-NEWS-CONTENT-AUDIT.md)) over that snapshot:
`src/util/activity.ts` `newsRecords()` derives 155 records (62 events + 93
distinct documents by URL) served identically to the `/news` pages and
`GET /api/news`. Its tier/scope vocabulary is derived from registered publisher
attribution, so `OFFICIAL`/`KHABAR`/`MEDIA` are served as honest zero counts,
not invented content. Activity-as-stored-entity remains deferred (§19).

**Language note:** `news`/`posts` have no `_np` columns but `sources.language` and
`documents.language` exist, and `metric_definitions`/`document_categories` both
carry `name_np`. Bilingual is **partially** supported at the field level and not
at the content level. Bilingual capability is required, infrastructure deferred
(directive §2.5).

---

## 19. Activity — CONCEPTUAL / DEFERRED

```
Status: DEFERRED IMPLEMENTATION
```

**Activity is the canonical future entity.** Gallery is a **projection of
Activity + Media**, never a stored entity. There is no `activities` table and no
`gallery` table.

Activity may attach to any of:

```
Institution | Branch | Center | Geography | Contributor | Media | Source | Consent | Moderation
```

Of these, only `Institution`, `Branch`, `Source`, `Geography` have any schema
today. **`Center`, `Contributor`, `Media`, `Consent`, `Moderation` have no
tables** (FUTURE SCHEMA GAP 4).

Conceptual attributes: `institution_id`, `branch_id?`, `center_id?`, `geo?`,
`activity_type`, `title_np`/`title_en`, `body_np`/`body_en`, `occurred_at`,
`discovered_at`, `published_at`, `moderation_status`, `consent_status`,
`contributor_id`, `source_id`, `media[]`.

**Moderation and consent are not optional fields — they are the reason Activity
exists.** Activity is institution-authorized first (directive §25). A submission
without a consent basis and a moderation state must not be publishable.

**Requires an approved migration.** Not written in P0.2.

---

## 20. Media — CONCEPTUAL / DEFERRED

Binary content. No table; `documents.r2_key`, `sources.r2_key` and `videos` hold
R2 keys. Media is distinct from Document: a photo is not a document, and a
document is not media.

Conceptual: `id`, `owner_type`/`owner_id`, `r2_key`, `mime_type`, `file_size`,
`content_hash`, `width`/`height`/`duration`, `captured_at`, `source_id`,
`alt_text_np`/`alt_text_en`, `consent_id`, `moderation_status`.

**Binary goes to R2. Metadata goes to the database.** Frozen. Never store blobs
relationally.

---

## 21. Digital Service

`digital_services`: `service_type` (6 values), `name`, `url`, `description`,
`status` (`VERIFIED`/`CANDIDATE`/`STALE`), `source_id`, `last_verified_at`,
`UNIQUE (institution_id, service_type, name)`.

**Status: EMPTY.** Blocked on the same thing as everything else: all 51
institutions have `official_website: null`, 49 `websiteStatus: "candidate"`,
2 `"verified"`.

---

## 22. Social Account

`social_accounts`: `platform` (7 values), `url` (NOT NULL), `handle`, `verified`,
`last_checked`, `is_active`, `source_id`, `UNIQUE (institution_id, platform)`.

**Status: EMPTY.** Same blocker: we cannot verify a social account for an
institution whose website we have not verified.

---

## 23. Outbound Link / Official Link

Two link tables with **different purposes** — worth being precise:

| Table | Purpose | CHECK |
|---|---|---|
| `official_links` | the institution's **own** channels | `link_type` 14 values; `status` VERIFIED/CANDIDATE/STALE/FAILED; `verified_at` |
| `outbound_links` | **our** redirect doors `/go/{scope}/{slug}` | `target_type` 7 values; `availability_status` AVAILABLE/MISSING/MOVED/UNKNOWN |

`outbound_links` also carries `content_hash`, `first_seen_at`, `last_checked_at`
— it is the **availability monitor** for every external URL the site points at.
`target_url` is publisher-supplied, which is why `safeRedirectTarget()` validates
it at redirect time (security posture §4).

**Status:** `official_links` **IMPLEMENTED** (51: 2 VERIFIED, 49 CANDIDATE);
`outbound_links` **IMPLEMENTED** (51). `slug_aliases` **EMPTY**.

---

## 24. Source

`sources`: `source_type` (NRB/MFB_WEBSITE/MFB_DOCUMENT/NEPSE/DATA_PROVIDER/MEDIA/
SOCIAL/KHABAR), `source_scope` (INSTITUTION/NRB/MARKET/MEDIA/GENERAL),
**`source_grade` (A/B/C/D)**, `url` UNIQUE, `domain`, `title`, `publisher`,
`fetched_at`, `http_status`, `content_hash`, `mime_type`, `language`, `r2_key`,
`first_seen_at`, `last_seen_at`, `is_active`.

**A source is a registered publisher location, not a document.** Grade lives on
the source, so every observation from it inherits the grade — which is why grade
alone must never be mistaken for verification.

**Status:** **IMPLEMENTED.** 21 rows in `lk.db` (11 from `master.json` +
10 from `data/pilot/pilot-sources.json`). `pilotSummary` counts 51 crawled sources.

---

## 25. Source Snapshot

`source_snapshots`: `source_id`, `fetched_at` (NOT NULL), `content_hash` (NOT NULL),
`http_status`, `mime_type`, `r2_key`, **`parser_version`**, `extraction_status`
(PENDING/EXTRACTED/FAILED/SKIPPED). Indexed `(source_id, fetched_at DESC)`.

A snapshot is **immutable evidence that a page said something at a moment in
time.** `content_hash` gives idempotency; `parser_version` gives
reproducibility.

**Status:** **EMPTY in `lk.db`.** **1,458 across the 13 evidence DBs.**

---

## 26. Evidence Assertion

`data_assertions`: `entity_type`, `entity_id`, `field_name`, `value`,
`source_id` (NOT NULL), `source_snapshot_id` (nullable), **`observed_at`** (NOT
NULL), **`valid_from`**, **`valid_to`**, `confidence` (REAL), `verification_status`
(6 states). Indexed `(entity_type, entity_id, field_name, valid_to)`.

This is the most important table in the system and it is **empty in `lk.db`**.

`verification_status`: `UNVERIFIED`, `AUTO_VERIFIED`, `HUMAN_VERIFIED`, `CONFLICT`,
`STALE`, `REJECTED`. Measured distribution: 5,071 / 0 / 0 / 0 / 9 / 3.

**`confidence` is REAL with no CHECK and no seeded scale.** It is stored but its
meaning is undefined. **MISMATCH-7.**

**`valid_from`/`valid_to` are the only bitemporal pair in the schema.** See
HISTORY-MODEL.

---

## 27. Ingestion Run

`ingestion_runs`: `ingestion_source_id`, `started_at`, `completed_at`, `status`
(RUNNING/SUCCESS/FAILED/PARTIAL), `items_found`, `items_changed`, `items_new`,
`items_failed`, `parser_version`, `error_count`.

`ingestion_items`: per-item `url`, `item_type`, `status`
(NEW/CHANGED/UNCHANGED/FAILED), `content_hash`, `UNIQUE (run_id, url)`.
`ingestion_sources`: the crawl registry with `config_json`,
`fetch_interval_minutes` (default 1440), `last_run_at`, `last_success_at`,
`error_count`.
`ingestion_errors` exists as a table.

**A run is the unit of idempotency and the unit of provenance.** This is the
missing spine of the system.

**Status:** `ingestion_runs` **EMPTY in `lk.db`**; runs exist in evidence DBs
(106 in the base DB, 18 in the branches DB). `ingestion_items` **EMPTY**;
`ingestion_errors` **EMPTY**. `ingestion_sources` **IMPLEMENTED** (10).

**`ingestion_errors` is EMPTY and nothing writes to it** — errors are counted in
`ingestion_runs.error_count` but not itemized. **MISMATCH-11.**

---

## 28. Review Item

No `review_items` table. Two partial mechanisms exist:

1. `data_conflicts` — pairwise source disagreement with `OPEN`/`RESOLVED`/
   `IGNORED`, `resolved_by`, `resolved_at`, `resolution_note`. **229 rows, all
   `OPEN`.**
2. `lib/ingestion/review.ts` — a code module with no operator UI.

**Status:** **PARTIAL.** Conflicts are recorded but never reviewed;
`resolved_by`/`resolved_at`/`resolution_note` are **NULL on all 229 rows**.

---

## 29. Coverage

`institution_coverage`: `institution_id` PK, `overall_status` + **9 dimensions**
(`identity`, `leadership`, `branch`, `financial`, `document`, `news`, `digital`,
`product`, `career`), each with the 6-state CHECK
(`NOT_STARTED`/`DISCOVERED`/`PARTIAL`/`VERIFIED`/`STALE`/`CONFLICT`), plus
`last_full_reviewed_at`, `next_full_review_at`, `updated_at`.

**Status: IMPLEMENTED** — 51 rows, one per institution. But **all 51 are seeded
`NOT_STARTED`** while the assertion layer holds 5,083 observations. Coverage does
not reflect reality.

`field_refresh_policies` (8 rows) encodes cadence per field group:
CEO 90d · BRANCHES 30d · SOCIAL 30d · FINANCIALS 90d · ANNUAL_REPORT 365d ·
CONTACT 90d · JOBS 1d · NEWS 1d.

Coverage is **internal quality state**. It is never shown publicly and never
affects factual ranking (frozen).

---

## 30. Reconciliation: current representations → canonical concept

| # | CURRENT REPRESENTATIONS | CANONICAL CONCEPT | MISMATCH | RECOMMENDED | PHASE |
|---|---|---|---|---|---|
| 1 | `data_assertions.entity_type`: `institution`, `BRANCH`, `VACANCY`, `FINANCIAL` | one entity-type registry | Mixed case in one column; no registry table | Normalize to one case; add an entity-type registry | P0.4 |
| 2 | `field_name`: `branch_name`/`document_title`/`vacancy_title`/`people_ceo` vs `SOURCE_DOCUMENT`/`DOCUMENT_TITLE`/`JOB_TITLE`/`RATE_KIND` | one field-name registry | Two casings, two registries-in-waiting | Single lowercase registry; map existing values, never rewrite history | P0.4 |
| 3 | `Institution` (camelCase `src/types`) vs `InstitutionSummary`/`InstitutionDetail` (snake_case DTO) | one domain concept, three layers | **Two disjoint type worlds.** Frontend has no `status`, no `meta`, no `aliases` typing; DTO has no `evidence` map | Layer discipline: domain type → persistence DTO → projection → display. Derive, don't duplicate | P0.3 |
| 4 | `aliases: string[]` (frontend) vs `AliasDto` (typed, sourced) vs `institution_aliases` (table) vs `master.json` (`normalized_alias`, `source_grade`) | Institution Alias | Frontend flattens to untyped strings, losing type + source + verification | Project `AliasDto[]` to the frontend; drop the string array | P1 |
| 5 | `Institution.paidUpCapitalCrore` | Financial Metric | A sourced directory column living on the entity, not as a metric. No `metric_code`, no period | Keep as an identity fact with provenance, and record that it is **not** an extracted `financial_metric` | P4 |
| 6 | `branches.province/district/...` denormalized; `getProvinceFromHeadOffice()` derives province from free text | Geography entity | Province sometimes sourced, sometimes inferred from a string | Keep denormalized for now; mark inferred values as inferred | P3 |
| 7 | `confidence` REAL, no scale, no CHECK | confidence scale | Meaning undefined | Define 0.0–1.0 with a documented rubric; leave existing NULLs NULL | P0.4 |
| 8 | `timeline_events` vs `events` vs `regulatory_events` vs `nrb_*` | Corporate Event | Four tables, overlapping meaning, `events` EMPTY and unconstrained | Define precedence; `events` is the polymorphic superset, `timeline_events` the institution-scoped view | P0.3 |
| 9 | `positions.appointed_at/ended_at` vs `committee_members.from_date/to_date` vs `committees.formed_at/dissolved_at` | one temporal convention | Three names for one idea | Standardize on `valid_from`/`valid_to` at the assertion layer; keep domain-specific names, document the mapping | P0.3 |
| 10 | `jobsProvenance` says 1 posting; array appears to hold 2 | provenance ↔ array integrity | **RETRACTED in P0.3.** False finding: the "2nd posting" was the `export interface Job` type declaration at `jobs.ts:31`, not a record. 36 DOCUMENT + 1 POSTING = 37 = array length = the string's own count. `build-jobs-module.ts:224-231` derives both from one binding. **No defect.** The residual gap is the absence of a CI guard | P0.4 (add guard) |
| 11 | `ingestion_errors` table EMPTY; `ingestion_runs.error_count` carries the only count | error itemization | Failures are counted, never explained | Write per-item errors | P0.5 |
| 12 | `institution_coverage` all `NOT_STARTED` vs 5,083 assertions | coverage reflects reality | Quality signal is disconnected from evidence | Derive coverage from assertion counts, keep human override | P0.5 |
| 13 | `Document` (types) / `FinancialRecord` (`src/data`) / `DocumentDto` / `documents` / `document_title` vs `DOCUMENT_TITLE` | Document | Up to five representations of one concept | Three layers: document record, financial document view, projection. **P2-C removed `FinancialRecord`**; one view type (`FinancialDocumentDto`) over raw assertions; **P2-D added `DocumentDto`** for the general (non-financial) document layer over `document_title`/`notice_title` assertions (title-gated; `official_url`/`period` null) | P0.3 → **P2-C, P2-D done** |
| 14 | `Job` in `src/types` vs `Job` in `src/data/jobs.ts` | Job | Duplicate interface, different fields | `src/data` shape wins (it is live); delete the dead one. **P2-D** re-pointed the live shape (added `institutionId`/`institutionSlug`); the dead duplicate remains | P0.3 |
| 15 | `Person` type does not exist; `PersonDto` + `PersonAssertionRecord` only | Person | Frontend has no person domain type | Introduce a display projection, do not reuse the DTO | P2 |
| 16 | `VACANCY` entities vs `vacancy_title` institution rows (both → `src/data/jobs.ts`) | Job | Two evidence shapes, one display layer | **P2-D done:** canonical `vacancy-<institution_id>\|…` identity for both shapes (entity tails preserved byte-for-byte; title-only rows synthesised), publisher→registry attribution, title gate, `deadline` null / `location`/`type` placeholders, no title-similarity merging | **P2-D done** |

Dead type surface confirmed by grep — declared in `src/types/index.ts`, **zero
consumers**: `Post`, `Job`, `Video`, `Document`, `ResearchItem`, `ReportMetric`,
`IndustryReport`. They are also unreachable from `site-data.ts`, which does not
re-export them.

---

## 31. FUTURE SCHEMA GAPS

Documented, **not fixed**. Each needs approval and a migration.

| # | Gap | Impact | Phase |
|---|---|---|---|
| 1 | No status history for `institutions.status` | Cannot answer "when did this become MERGED?" | P0.5 |
| 2 | No predecessor/successor on `timeline_events` | Corporate lineage is unrepresentable as a graph; `master.json` already carries `predecessor_id` with nowhere to go | P0.5 |
| 3 | No `centers` table | Center model unimplementable | P10 |
| 4 | No `activities`, `media`, `consents`, `moderation` tables | Activity model unimplementable; consent/moderation are the safety prerequisite | P10/P11 |
| 5 | No entity-type / field-name registry | Two casing conventions coexist; cross-source comparison is unreliable | P0.4 |
| 6 | No `metric_definitions` rows | `financial_metrics.metric_code` FK cannot be satisfied | P4 |
| 7 | `people.source_id` and `positions.source_id` are NOT NULL | A person known only from a merged assertion cannot be created without a source row | P2 |
| 8 | `confidence` has no scale constraint | Values are uninterpretable | P0.4 |
| 9 | `documents.language` defaults `'np'` but `news`/`posts` have no language columns | Bilingual content cannot be modelled | P0.4 |
| 10 | No `derived_values` table or derivation record | Computed values have no first-class link to their inputs | P4 |

---

## 32. Storage independence

The model above states no storage assumption. The chain is:

```
Canonical logical model (this document)
        ↓
Repository contract            lib/repository/contract.ts
        ↓
Storage adapter                lib/repository/{mock,d1,local}.ts
        ↓
Canonical store                decided after P0.3 reconciliation
```

`InstitutionSummary` is the proof: it is returned identically by the mock
(`master.json`), local SQLite, and D1. Nothing in this document says which one
answered.

---

## 33. Corrections to P0.1

P0.2 measurement contradicted two P0.1 statements. Both were wrong; both are
corrected here and in the P0.1 documents.

| P0.1 claim | Measured reality | Correction |
|---|---|---|
| `data_conflicts` is "**never written**"; conflict persistence "does not exist" | **229 conflict rows** exist in 3 evidence DBs (155 + 64 + 10), all `people_ceo`, all `OPEN` | Conflict **detection and persistence work**. What is missing is *review and resolution* — `resolved_by`/`resolved_at`/`resolution_note` are NULL on all 229, and `crawlSummary.conflictsOpen` reports 0 because the generated export drops them |
| Evidence totals "~5,076 assertions, ~1,391 snapshots" | **5,083 assertions, 1,458 snapshots** | Updated. Previous figures were approximate estimates from an earlier run, not measurements |

Neither correction weakens the P0.1 conclusion. The durable-ingestion-memory gap
(P0.5) is unchanged and arguably larger: `ingestion_runs`, `ingestion_items`,
`ingestion_errors`, `data_assertions`, `source_snapshots`, and `data_conflicts`
are **all zero in `lk.db`** — every one of them lives only in the 13 dated pilot
databases.