# DOMAIN-VOCABULARY — Phase P0.3

**Status:** FROZEN (Phase P0.3). One vocabulary, one owner, no exceptions.

The five requested outcomes are covered here and in `TYPE-LAYERS.md`,
`TEMPORAL-VOCABULARY.md`, `docs/architecture/REPOSITORY-CONTRACT.md`, and
`docs/data/CONFLICT-VISIBILITY-CHAIN.md`.

---

## 1. The problem

`data_assertions.entity_type` and `data_assertions.field_name` are free-text
columns with **no registry table** and **no CHECK constraint**. Measured content:

```text
entity_type:   institution (4,884)   FINANCIAL (153)   VACANCY (38)   BRANCH (8)

field_name:    branch_name (2,932)   website (805)      document_title (443)
               people_board (295)    people_director (226)
               SOURCE_DOCUMENT (84)  vacancy_title (75)  people_ceo (74)
               DOCUMENT_TITLE (57)   DOCUMENT_TYPE (40)  people_chair (34)
               RATE_KIND (8)         address (2)  district (2)  open_date (2)
               notice_title (2)      APPLICATION_URL (1)  JOB_TITLE (1)
```

Four cases, one column. Two `document` casings for one concept. `entity_type`
uses lowercase for the most common value and UPPERCASE for the rest.
**19 distinct `field_name` values, 4 distinct `entity_type` values, zero
validation.**

The cross-tab is worse than either column alone:

```text
institution | branch_name  2,930      <- a branch's name, asserted as an
BRANCH      | branch_name      2           institution attribute
institution | website         805
institution | document_title   443      <- lowercase, under institution
FINANCIAL   | DOCUMENT_TITLE    57      <- uppercase, under financial_report
institution | people_board     295      <- a person, asserted as an
institution | people_director  226          institution attribute
institution | people_ceo        74
institution | people_chair      34
institution | vacancy_title     75      <- a job, asserted as an institution attribute
BRANCH      | address            2
BRANCH      | district           2
BRANCH      | open_date          2
```

**`branch_name` is used under both entity types, and 2,930 of its 2,932 rows sit
under the wrong one.** Same for the four `people_*` fields — all 629 rows claim
`entity_type = 'institution'`, because `person` and `position` do not exist as
entity types yet. So the free-text column does not merely vary in case; it varies
in **meaning**, and the most common value is attached to the entity that does not
own it.

**Why this is more than cosmetic.** Two defects are already downstream of it:

1. A query filtering `entity_type = 'BRANCH'` silently misses nothing today only
   because there are 8 rows. Add 5,000 lowercase `branch` rows and it silently
   misses all of them. No error, no warning — just a short result set that looks
   like an absence of data.
2. `source_a_id <> source_b_id` style joins between `data_conflicts` and
   `data_assertions` are written by string equality against `field_name`. Two
   spellings of the same field means two sets of disputes that never meet.

A vocabulary that cannot be trusted to mean one thing cannot be used to decide
whether data is trustworthy.

---

## 2. Frozen canonical vocabulary

Lowercase. Snake case. Singular. Every value is a **stable identifier**, never a
label shown to a reader.

### Entity types

| Canonical | Replaces | Meaning |
|---|---|---|
| `institution` | `institution` ✅ | The anchor entity |
| `person` | — | Named individual in a public role |
| `position` | — | A person's tenure in a role |
| `committee` | — | A board/sub-committee/AGM body |
| `branch` | `BRANCH` | A branch or office |
| `center` | — | DEFERRED (P10) |
| `financial_report` | — | A reporting period |
| `financial_metric` | — | A number within a report |
| `interest_rate` | — | A rate for a period |
| `document` | — | A discoverable document |
| `job` | `VACANCY` | A vacancy record |
| `news` | — | An ingested update |
| `post` | — | Authored content |
| `activity` | — | DEFERRED (P10) |
| `media` | — | DEFERRED (P10) |

### Frozen rules

1. **Lowercase snake_case, always.** No value may contain an uppercase letter.
2. **Singular.** `entity_type = 'branch'`, never `branches`.
3. **New values require a registry row first.** No ad-hoc spelling.
4. **The vocabulary is storage-independent.** It is defined here, not in a schema.
5. **Renaming is additive, never destructive.** See §4.

### Why the vocabulary is not a schema table *yet*

`schema/schema.sql` is frozen. Adding `entity_type_registry` requires a migration,
and directive §24 forbids schema changes in this phase.

**Therefore: the vocabulary is frozen as a document contract and enforced by a
script, not by the database.** P0.4 lands the enforcer; P0.5 may land the
registry table with approval. Same pattern as the temporal vocabulary
(`TEMPORAL-VOCABULARY.md`) and the type layers (`TYPE-LAYERS.md`) — freeze the
meaning now, persist it when a migration is justified.

### The scale of the enforcement that already exists

`schema/schema.sql` carries **65 `CHECK` constraints**. **Six of the ten**
vocabularies in §5 are enforced there; the four that are not — entity types, field
names, role names, temporal names — are the ones producing observed defects, and
two of them (`role`, coverage) are already wrong in the data. The gap is not
"enforcement is missing"; it is that enforcement stopped at the columns that were
easy to constrain while the free-text identifiers stayed open.

### The other unconstrained column: `confidence`

Same failure class, one column over. `data_assertions.confidence` is an
unconstrained `REAL`; measured across all 12 populated evidence DBs:

```text
0.6  3,467 (68.2%)   0.7    581   0.55   562   0.5    241   0.8    232
```

**Five distinct values across 5,083 rows, and four DBs write exactly one value
each** (`m34` 0.7, branches-ext 0.6, careers-ext two values, financials-ext 0.5).
So `confidence` is currently a per-crawl constant, not a per-assertion judgement.
A `REAL` with no CHECK and no rubric is a number nobody can defend. P0.4 owns the
rubric; this record is the baseline it has to beat or explain.

---

## 3. Field names

Canonical vocabulary, grouped by owning entity. Names are reused **only** where the
concept genuinely is the same; a branch's `address` and an institution's
`head_office_address` are distinct fields, not one field.

### Institution

```text
name_en             legal name, English
name_np             legal name, Nepali
short_name
institution_type    NATIONAL | PROVINCIAL
status              ACTIVE | MERGED | ACQUIRED | RENAMED | LIQUIDATED | INACTIVE
registration_number
license_number      maps to institutions.nrb_license_number
license_class       maps to institutions.nrb_class
operation_date
operation_date_status    source_published | source_anomaly
operation_date_note      free text explaining an anomaly
head_office_district
head_office_municipality
head_office_address
working_area
official_website
official_email
official_phone
logo_url
established
listed
```

`license_class` / `license_status` are the **frontend** names
(`src/types/index.ts`); `nrb_class` is the **persistence** name. This is the
documented P0.2 MISMATCH-3 divergence — see `TYPE-LAYERS.md` §5.

### Person

```text
name_en
name_np
person_ceo           role-specific assertion (legacy, promoted in P2)
person_chair
person_director
person_board
```

**These five are provisional.** They are the field names that produced all 229
conflicts. P2 should promote them to `position` rows with a `role` column rather
than mint five permanent field names per role — a role dictionary is the right
model, not a field per role.

**Frozen:** do not add a new `person_<role>` field for a new role. Add a `role`
value. `people_*` exists only as legacy assertion vocabulary.

### Branch

```text
branch_name
address
phone
email
district
municipality
ward
province
geo_lat
geo_lng
opened_at
branch_type         HEAD_OFFICE | BRANCH | CONTACT_OFFICE | SERVICE_CENTER
status              OPEN | CLOSED
```

**Measured coverage: 4 of 13 exist** — `branch_name` (2,932), `address` (2),
`district` (2), `open_date` (2). The other nine are vocabulary on paper only;
`branch_type`/`status` are constrained in `branches` but have never been asserted.
Note `open_date` is not `opened_at` — pick one in P0.4.

### Financial

```text
document_title      a financial document we know exists
document_type
rate_kind           interest_rate | loan | base_rate | rate_change
source_document
document_url
```

### Job

```text
job_title
notice_title
application_url
source_document
deadline
location
employment_type
```

### Frozen rules

1. Lowercase snake_case, always.
2. A field name is owned by **exactly one** entity type.
3. `document_title` is the canonical name. `DOCUMENT_TITLE` is the same field
   spelled wrong; `DocumentTitle` would be a third field.
4. When a field is promoted from assertion vocabulary to a real entity attribute
   (`person_ceo` → `positions.role`), the old name is **kept as an alias**, never
   deleted. Historical assertions must remain interpretable.
5. Field names are plural-free and role-free.

---

## 4. Migration of existing values

**No existing row is rewritten.** 5,083 assertions keep their stored spelling
forever.

| Stored | Canonical | Action |
|---|---|---|
| `institution` | `institution` | already canonical |
| `BRANCH` | `branch` | alias map |
| `VACANCY` | `job` | alias map |
| `FINANCIAL` | `financial_report` | alias map |
| `document_title` | `document_title` | already canonical |
| `DOCUMENT_TITLE` | `document_title` | alias map |
| `DOCUMENT_TYPE` | `document_type` | alias map |
| `SOURCE_DOCUMENT` | `source_document` | alias map |
| `RATE_KIND` | `rate_kind` | alias map |
| `JOB_TITLE` | `job_title` | alias map |
| `APPLICATION_URL` | `application_url` | alias map |

Consumers resolve through the alias map. Writers emit canonical only. Readers
accept both until a future P0.5 migration normalizes storage — **and that
migration must be additive with the alias map retained**, because evidence is
never rewritten (`docs/architecture/DATA-FLOW.md`).

`open_date`, `district`, `address` (2 rows each in `m34-external-sample`) are
already lowercase and map cleanly. `notice_title` (2, `phase-o`) maps to the Job
section's `notice_title`; `JOB_TITLE` (1) and `APPLICATION_URL` (1) both live in
`pilot-careers-ext`.

**One evidence DB is not in this table.** `pilot-branch-url-discovery-2026-09-27.db`
has a **legacy 6-column** `data_assertions` (`id, source_snapshot_id,
assertion_type, field, value_text, created_at`) instead of the frozen 12-column
shape — `assertion_type`/`field`/`value_text` are the pre-freeze spellings of
`entity_type`/`field_name`/`value`. It holds **0 rows**, so it contributes nothing
to the 5,083 and needs no alias map. Recorded because a future reader will
otherwise treat "13 evidence DBs" as "13 stores of the same schema", and because
an empty legacy-shaped store is exactly what a reader mistakes for "no data".

**Storage drift, not vocabulary drift.** The 5,083 assertions across the other 12
DBs all use the frozen 12-column shape.

---

## 5. Ownership

| Vocabulary | Owner | Enforcement |
|---|---|---|
| Entity types | this document | script (P0.4) |
| Field names | this document | script (P0.4) |
| Role names | `positions.role` — no registry today | P2 |
| Temporal names | `TEMPORAL-VOCULARY.md` | script (P0.4) |
| Source grades | `sources.source_grade` — already schema-enforced ✅ | DB CHECK |
| Verification status | `verification_status` — already schema-enforced ✅ | DB CHECK |
| Conflict resolution | `resolution_status` — already schema-enforced ✅ | DB CHECK |
| Coverage status | `*_status` — already schema-enforced ✅ | DB CHECK |
| Alias type | `alias_type` — already schema-enforced ✅ | DB CHECK |
| Institution status/type | CHECK — already schema-enforced ✅ | DB CHECK |

**Six of these ten are DB-constrained; the four that are not are exactly the four
with observed defects** — unvalidated free-text (`entity_type`, `field_name`), a
role encoded in field names instead of a column (`positions.role`), and `*_status`
coverage columns whose *values* are constrained but whose *meaning* is not (all
51 institutions in `lk.db` are `NOT_STARTED` on all ten axes — a vocabulary that
can only ever say "not started" tells an operator nothing). The asymmetry is the
argument for closing it.

---

## 6. Frozen rules

1. Lowercase snake_case, singular, no role encoding.
2. One field name belongs to exactly one entity type.
3. Unknown values are rejected at the writer, not tolerated at the reader.
4. Renames are additive: alias map, never in-place rewrite.
5. A role is a **value** (`positions.role`), never a field name (`person_ceo`).
6. Vocabulary is storage-independent and owned by this document, not by a table.
7. A query that filters on an unvalidated free-text column must not be trusted to
   mean what it appears to mean.
8. Schema changes to enforce this require approval (P0.5).