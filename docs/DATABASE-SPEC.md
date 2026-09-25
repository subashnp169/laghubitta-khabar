# Laghubitta Khabar — Database Specification (canonical, v2)

Status: **FROZEN**  ·  Date: 2026-09-24  ·  Supersedes `schema/schema.sql` v1 and the
old `senna-mfi-db` / `mfi-nepal` SQLite designs.

This document is the single source of truth for the production database. DDL is generated
from this spec as numbered migrations under `/migrations` (applied in order by wrangler) and
concatenated into `/schema/schema.sql` as a portable baseline reference. **Do not edit
`schema.sql` directly** — change this spec + add a migration.

---

## 1. Non-negotiable rules (carried from FROZEN-SPEC)

1. New database is the **canonical source of truth**. Nothing from the old D1
   (`senna-mfi-db`) or old SQLite (`laghubitta.db`) is auto-imported. Selective imports only,
   through explicit migration scripts, with `source_id` pointing at a real `sources` row.
   Old databases are **read-only reference**, never a source of running truth.
2. Portable SQLite SQL only (works on D1 today, PostgreSQL later). No Postgres-only features.
3. Every schema change is a migration; production schema never edited by hand.
4. **Provenance is the product**: every fact has a source; conflicts are never silently resolved.
5. Never overwrite time-dependent history (people, branches, names, financials, documents).
6. Frontend never talks to D1 directly (Browser → Edge cache → Worker API → repository → D1).
7. Company-internal staff / employee pages are never collected (people tier 1/2 only).
8. IDs are immutable; slugs are URL-only (may change, always leave `slug_aliases`).
9. **AI is never the authority.** AI discovers, extracts, classifies, suggests, compares, flags —
   it never publishes a fact directly. A fact reaches D1 only through: source URL → source
   snapshot → document → extraction → validation → confidence → `AUTO_VERIFIED` / `HUMAN_REVIEW`.
   (`official_links.verified = 1`, `financial_metrics.verification_status = 'AUTO_VERIFIED'`
   or above, and every `data_assertion` require an evidence `source_id`.)
10. **Never store a financial number without its period.** `financial_metrics` is child of
    `financial_reports` (period) and always keeps `reported_value` (as-reported string) next to
    typed normalized values.
11. **Build in phases, not waves.** The schema is complete from day one, but the application
    never pretends every field has data. Population order: **(A)** identity+evidence →
    **(B)** people+branches → **(C)** financials → **(D)** content → **(E)** regulatory+ingestion.
    `institution_coverage` tracks how completely each institution has been researched.

---

## 2. Data types & conventions

| Type | Use | Notes |
|---|---|---|
| `TEXT` | primary keys, slugs, text, ISO-8601 dates (`YYYY-MM-DD`) / timestamps (`YYYY-MM-DDTHH:MM:SS.sssZ`) | PKs are explicit strings, not autoincrement |
| `INTEGER` | booleans (0/1), counts, paisa amounts, `file_size` | `value_npr` = paisa integers |
| `REAL` | percentages, crore amounts, boundaries | units carried separately, never in column names |
| `TEXT CHECK (...)` | closed vocabularies | see each table |
| No ENUM, no JSONB | — | JSON stored as `TEXT` (with `-json` in name) |

Booleans: `0`/`1` only. Dates compared lexically (ISO keeps ordering). All identifiers
snake_case; all FKs named `<singular>_id`.

### ID scheme
Every table: `id TEXT PRIMARY KEY`. Entities that are public/SEO expose a `slug TEXT UNIQUE`.
Examples:
- institutions: `inst-nirdhan-utthan-laghubitta-bittiya-sanstha-ltd`
- people: `person-ram-kumar-shrestha-03`
- documents: `doc-{institution-slug}-{doc-type}-{period}`
- sources: `src-{domain}-{n}-{sha1-8}`

Seed data uses readable ids; ingested rows generate them deterministically from
domain+url hash so re-runs are idempotent.

---

## 3. Entity relationship model (53 tables)

```
sources ◄───────────── everything references sources(source_id) for provenance
  │
  │ institutions ─ institution_coverage   ← per-MFB research completeness
  │ institutions ─┬─ institution_aliases ─── institution_symbols
  │               ├─ people ◄─ positions ── committees ◄─ committee_members
  │               ├─ branches ◄─ branch_history
  │               ├─ products / services / social_accounts / digital_services / official_links
  │               ├─ financial_reports ─ financial_metrics ── metric_definitions
  │               ├─ interest_rate_periods ─ interest_rates
  │               ├─ dividends / book_closures
  │               ├─ documents ─ document_categories ─ document_extractions
  │               ├─ outbound_links            ← /go/ routing layer
  │               ├─ posts ─ post_sources / news / events / timeline_events
  │               ├─ jobs / research / videos
  │               └─ nrb_institution_links ◄─ nrb_documents ─ nrb_directives ─ regulatory_events
  │
  ├─ source_snapshots ─ data_assertions ─ data_conflicts
  ├─ ingestion_sources ─ ingestion_runs ─ ingestion_items / ingestion_errors
  ├─ validation_rules ─ validation_results
  └─ users ─ roles ─ audit_logs

SEO entities (slugged): institutions, people, branches(district pages), documents,
  posts, news, events, jobs, research, videos, interest_rate_periods, timeline_events.
```

---

## 4. Table catalog

### 4.1 `sources` + `source_snapshots` — evidence backbone (everything FKs here)

```sql
CREATE TABLE sources (
  id              TEXT PRIMARY KEY,
  source_type     TEXT NOT NULL CHECK (source_type IN
    ('NRB','MFB_WEBSITE','MFB_DOCUMENT','NEPSE','DATA_PROVIDER','MEDIA','SOCIAL','KHABAR')),
  source_scope    TEXT NOT NULL DEFAULT 'GENERAL' CHECK (source_scope IN
    ('INSTITUTION','NRB','MARKET','MEDIA','GENERAL')),
  source_grade    TEXT NOT NULL CHECK (source_grade IN ('A','B','C','D')),
  url             TEXT NOT NULL UNIQUE,
  domain          TEXT,
  title           TEXT,
  publisher       TEXT,
  fetched_at      TEXT,
  http_status     INTEGER,
  content_hash    TEXT,
  mime_type       TEXT,
  language        TEXT,
  r2_key          TEXT,                 -- raw evidence: NULL allowed (link-first)
  first_seen_at   TEXT,
  last_seen_at    TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

**Source scope (frozen):** `INSTITUTION` (the MFB itself), `NRB` (regulator), `MARKET` (exchanges,
filings, data providers), `MEDIA` (journalism), `GENERAL` (everything else). Every `sources` row
carries both a `source_type` (mechanical) and a `source_scope` (governance). The crawler config
is kept clean by this pairing, e.g. `Infinity official website` → scope `INSTITUTION`, grade `A`;
`NRB` → scope `NRB`, grade `A`.

**Source hierarchy (frozen):** `A` = NRB/regulator, `A` = MFB official, `B` = NEPSE/official
market, `B` = official filing, `C` = established financial media, `D` = other public sources.
Lower grade never overrides higher grade in conflict resolution.

```sql
CREATE TABLE source_snapshots (
  id                TEXT PRIMARY KEY,
  source_id         TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  fetched_at        TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  http_status       INTEGER,
  mime_type         TEXT,
  r2_key            TEXT,               -- NULL unless we archive the byte itself
  parser_version    TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (extraction_status IN
    ('PENDING','EXTRACTED','FAILED','SKIPPED'))
);
CREATE INDEX idx_snapshots_source ON source_snapshots(source_id, fetched_at DESC);
```

### 4.2 Core entities

`institutions` (canonical per user spec — history lives in `timeline_events`, aliases/symbols
kept separate so `institutions` stays narrow):

```sql
CREATE TABLE institutions (
  id                    TEXT PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  name_en               TEXT NOT NULL,
  name_np               TEXT,
  short_name            TEXT,
  institution_type      TEXT NOT NULL CHECK (institution_type IN ('NATIONAL','PROVINCIAL')),
  status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN
    ('ACTIVE','MERGED','ACQUIRED','RENAMED','LIQUIDATED','INACTIVE')),
  registration_number   TEXT,
  nrb_license_number    TEXT,
  nrb_class             TEXT DEFAULT 'D',
  operation_date        TEXT,
  head_office_district  TEXT,
  head_office_municipality TEXT,
  head_office_address   TEXT,
  working_area          TEXT,
  official_website      TEXT,
  official_email        TEXT,
  official_phone        TEXT,
  logo_url              TEXT,
  established           INTEGER,
  listed                INTEGER NOT NULL DEFAULT 0,
  source_id             TEXT REFERENCES sources(id),
  last_verified_at      TEXT,
  next_review_at        TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_inst_status   ON institutions(status);
CREATE INDEX idx_inst_type     ON institutions(institution_type);
CREATE INDEX idx_inst_district ON institutions(head_office_district);
CREATE INDEX idx_inst_updated  ON institutions(updated_at);
```

```sql
CREATE TABLE institution_aliases (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  alias         TEXT NOT NULL UNIQUE,          -- ticker, promo, alt, NP, former name
  alias_type    TEXT NOT NULL CHECK (alias_type IN
    ('TICKER','TICKER_PROMOTER','NAME_ALT','NAME_NP','FORMER','SHORT')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT REFERENCES sources(id),
  last_verified_at TEXT
);
CREATE INDEX idx_alias_inst ON institution_aliases(institution_id);

CREATE TABLE institution_symbols (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  exchange      TEXT NOT NULL DEFAULT 'NEPSE',
  symbol        TEXT NOT NULL UNIQUE,
  listed_date   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT REFERENCES sources(id),
  UNIQUE (exchange, symbol)
);

CREATE TABLE slug_aliases (                  -- SEO death-link protection
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  old_slug      TEXT NOT NULL UNIQUE,
  moved_to      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### 4.3 People — historical by design

```sql
CREATE TABLE people (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name_en       TEXT NOT NULL,
  name_np       TEXT,
  tier          INTEGER NOT NULL DEFAULT 1 CHECK (tier IN (1,2,3)),  -- tier 3 never filled
  photo_url     TEXT,                     -- only from official source
  email         TEXT,                     -- only if officially published
  education     TEXT,
  bio           TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  last_verified_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_people_slug ON people(slug);

CREATE TABLE positions (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  role          TEXT NOT NULL,            -- CEO, CHAIR, DIRECTOR, INDEPENDENT_DIRECTOR, DGM, GM...
  tier          INTEGER NOT NULL DEFAULT 1 CHECK (tier IN (1,2,3)),
  committee     TEXT,                     -- board committee if disclosed
  appointed_at  TEXT,
  ended_at      TEXT,                     -- NULL = currently in role (history preserved)
  is_current    INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  last_verified_at TEXT,
  UNIQUE (person_id, institution_id, role, appointed_at)
);
CREATE INDEX idx_positions_person     ON positions(person_id);
CREATE INDEX idx_positions_institution ON positions(institution_id, role, ended_at);
CREATE INDEX idx_positions_current    ON positions(institution_id, is_current, ended_at);

CREATE TABLE committees (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  name          TEXT NOT NULL,           -- Board, AGM, Audit, Remuneration...
  committee_type TEXT NOT NULL CHECK (committee_type IN ('BOARD','AGM','SUB','OTHER')),
  formed_at     TEXT,
  dissolved_at  TEXT,
  source_id     TEXT REFERENCES sources(id)
);
CREATE INDEX idx_committees_inst ON committees(institution_id);

CREATE TABLE committee_members (
  id                TEXT PRIMARY KEY,
  committee_id      TEXT NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  person_id         TEXT NOT NULL REFERENCES people(id),
  role_in_committee TEXT,
  from_date         TEXT,
  to_date           TEXT,                -- NULL = current
  source_id         TEXT REFERENCES sources(id),
  UNIQUE (committee_id, person_id, from_date)
);
```

### 4.4 Branches — history, not a count

```sql
CREATE TABLE branches (
  id             TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  branch_name    TEXT NOT NULL,
  branch_type    TEXT NOT NULL DEFAULT 'BRANCH' CHECK (branch_type IN
    ('HEAD_OFFICE','BRANCH','CONTACT_OFFICE','SERVICE_CENTER')),
  province       TEXT NOT NULL,
  district       TEXT NOT NULL,
  municipality   TEXT,
  ward           TEXT,
  address        TEXT,
  phone          TEXT,
  email          TEXT,
  manager_person_id TEXT REFERENCES people(id),   -- only if institution publishes the manager
  geo_lat        REAL,
  geo_lng        REAL,
  opened_at      TEXT,
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  source_id      TEXT NOT NULL REFERENCES sources(id),
  last_verified_at TEXT,
  UNIQUE (institution_id, branch_name)
);
CREATE INDEX idx_branches_inst  ON branches(institution_id);
CREATE INDEX idx_branches_geo   ON branches(province, district);
CREATE INDEX idx_branches_dist  ON branches(district);
CREATE INDEX idx_branches_open  ON branches(institution_id, status);

CREATE TABLE branch_history (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN
    ('OPENED','CLOSED','RELOCATED','RENAMED','TYPE_CHANGED')),
  occurred_at   TEXT NOT NULL,
  from_value    TEXT,                    -- old name/address
  to_value      TEXT,                    -- new name/address
  source_id     TEXT REFERENCES sources(id),
  note          TEXT
);
CREATE INDEX idx_branch_hist ON branch_history(branch_id, occurred_at DESC);
```

### 4.5 Products / services / digital / social

```sql
CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  product_type  TEXT NOT NULL CHECK (product_type IN ('SAVINGS','LOAN','DIGITAL','CHANNEL')),
  name          TEXT NOT NULL,
  category      TEXT,                    -- micro/agri/livestock/edu/housing...
  rate          REAL,                    -- only if publicly published
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  last_verified_at TEXT
);
CREATE INDEX idx_products_inst ON products(institution_id);

CREATE TABLE services (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  service_type  TEXT NOT NULL,           -- remittance, insurance tie-up, transfer...
  name          TEXT NOT NULL,
  description   TEXT,
  url           TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT REFERENCES sources(id),
  last_verified_at TEXT
);
CREATE INDEX idx_services_inst ON services(institution_id);

CREATE TABLE social_accounts (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  platform      TEXT NOT NULL CHECK (platform IN
    ('WEBSITE','FACEBOOK','LINKEDIN','YOUTUBE','INSTAGRAM','X','MOBILE_APP')),
  url           TEXT NOT NULL,
  handle        TEXT,
  verified      INTEGER NOT NULL DEFAULT 0,   -- 0 = never trust as official
  last_checked  TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT REFERENCES sources(id),
  UNIQUE (institution_id, platform)
);
CREATE INDEX idx_social_inst ON social_accounts(institution_id);

CREATE TABLE digital_services (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  service_type  TEXT NOT NULL CHECK (service_type IN
    ('MOBILE_APP','SMS','REMITTANCE','CARD','INTERNET_BANKING','OTHER')),
  name          TEXT NOT NULL,
  url           TEXT,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN
    ('VERIFIED','CANDIDATE','STALE')),
  source_id     TEXT REFERENCES sources(id),
  last_verified_at TEXT,
  UNIQUE (institution_id, service_type, name)
);

CREATE TABLE official_links (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  link_type     TEXT NOT NULL CHECK (link_type IN
    ('WEBSITE','FACEBOOK','LINKEDIN','YOUTUBE','INSTAGRAM','X','MOBILE_APP',
     'CAREER_PAGE','REPORT_PAGE','CONTACT_PAGE','BRANCH_PAGE','NOTICE_BOARD','PORTAL','OTHER')),
  label         TEXT,
  url           TEXT NOT NULL,
  canonical_url TEXT,                     -- resolved after any 302 chain
  verified      INTEGER NOT NULL DEFAULT 0,   -- 0 = never trust as official
  verified_at   TEXT,
  status        TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN
    ('VERIFIED','CANDIDATE','STALE','FAILED')),
  source_id     TEXT REFERENCES sources(id),
  last_checked_at TEXT,
  UNIQUE (institution_id, link_type, url)
);
CREATE INDEX idx_official_links_inst ON official_links(institution_id);
```

> **`official_links` is the first-class "official source" structure.** The "official website" of an
> MFB is **not a string on `institutions`** — it is one or more rows here (`link_type='WEBSITE'`,
> `verified=1`, with a `source_id` proving how it was confirmed). Everything on this table is an
> *evidenced relationship*, and nothing on it is trusted until `verified=1`.

### 4.6 Financials — normalized, provenance-first

```sql
CREATE TABLE metric_definitions (
  metric_code   TEXT PRIMARY KEY,        -- PAID_UP_CAPITAL, TOTAL_ASSETS, DEPOSITS, LOANS,
                                          -- BORROWINGS, NET_PROFIT, EPS, ROE, ROA, NPL,
                                          -- CAR, BASE_RATE, INTEREST_SPREAD, COST_OF_FUNDS, BRANCHES
  name_en       TEXT NOT NULL,
  name_np       TEXT,
  category      TEXT NOT NULL CHECK (category IN
    ('KEY','ASSET_QUALITY','CAPITAL','PROFITABILITY','EFFICIENCY','OTHER')),
  value_type    TEXT NOT NULL CHECK (value_type IN ('AMOUNT','RATIO','COUNT','YEAR')),
  default_unit  TEXT NOT NULL DEFAULT 'NPR',     -- NPR / CRORE / PCT / COUNT
  formula       TEXT,
  lower_bound   REAL,
  upper_bound   REAL,
  is_ratio      INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE financial_reports (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  report_type   TEXT NOT NULL CHECK (report_type IN
    ('ANNUAL','QUARTERLY','HALF_YEARLY','NINE_MONTH','AUDITED','UNAUDITED')),
  period        TEXT NOT NULL,           -- '2082-Q3', '2082/83'
  period_end    TEXT NOT NULL,           -- ISO date
  fy_label_np   TEXT,
  status        TEXT NOT NULL DEFAULT 'DETECTED' CHECK (status IN
    ('DETECTED','EXTRACTED','VALIDATED','PUBLISHED','FAILED')),
  source_id     TEXT NOT NULL REFERENCES sources(id),
  published_at  TEXT,
  discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (institution_id, period, report_type)
);
CREATE INDEX idx_fin_rpt_inst ON financial_reports(institution_id, period_end DESC, report_type);
CREATE INDEX idx_fin_rpt_period ON financial_reports(period_end DESC);

CREATE TABLE financial_metrics (
  id            TEXT PRIMARY KEY,
  report_id     TEXT NOT NULL REFERENCES financial_reports(id) ON DELETE CASCADE,
  metric_code   TEXT NOT NULL REFERENCES metric_definitions(metric_code),
  value_npr     INTEGER,                 -- canonical paisa, when AMOUNT
  value_pct     REAL,                    -- 0-100 when RATIO
  count_value   INTEGER,                 -- when COUNT
  year_value    INTEGER,                 -- when YEAR
  unit          TEXT NOT NULL DEFAULT 'NPR',
  reported_value   TEXT NOT NULL,        -- as-reported representation, e.g. 'Rs. 1,234.56 million'
  normalized_value TEXT,                 -- canonical string after normalization
  source_id     TEXT NOT NULL REFERENCES sources(id),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN
    ('UNVERIFIED','AUTO_VERIFIED','HUMAN_VERIFIED','CONFLICT','STALE','REJECTED')),
  last_verified_at TEXT,
  UNIQUE (report_id, metric_code),
  CHECK (value_npr IS NOT NULL OR value_pct IS NOT NULL OR count_value IS NOT NULL OR year_value IS NOT NULL)
);
CREATE INDEX idx_fin_metrics_report ON financial_metrics(report_id);
CREATE INDEX idx_fin_metrics_code   ON financial_metrics(metric_code, verification_status);
```

**Provenance by construction:** every metric row carries `source_id`, `reported_value` (the
number exactly as the source wrote it — "Rs. 1,234.56 million"), `normalized_value` (canonical
form after normalization) and `verification_status`. When NRB says 5.24 and the PDF says 5.23,
we store both rows sourcing each, and `data_conflicts` records the disagreement — never overwrite.
A financial number is **never stored without its period**: the period lives on the parent
`financial_reports` row, and every metric hangs off exactly one report.

```sql
CREATE TABLE interest_rate_periods (
  id            TEXT PRIMARY KEY,
  period_code   TEXT NOT NULL UNIQUE,   -- '2083-asr', '2082-chaitra'
  period_label  TEXT NOT NULL,
  fiscal_year   TEXT,
  published_at  TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  url           TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_rate_periods ON interest_rate_periods(period_code);

CREATE TABLE interest_rates (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  period_id     TEXT NOT NULL REFERENCES interest_rate_periods(id) ON DELETE CASCADE,
  rate_type     TEXT NOT NULL CHECK (rate_type IN
    ('DEPOSIT','SAVINGS','FIXED','LOAN_DIRECT','LOAN_COOP','BASE_RATE','WOMEN','REMITTANCE','OTHER')),
  product_name  TEXT,
  rate_pct      REAL NOT NULL,
  min_amount_npr INTEGER,
  max_amount_npr INTEGER,
  tenure        TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  last_verified_at TEXT,
  UNIQUE (institution_id, period_id, rate_type, product_name)
);
CREATE INDEX idx_rates_inst_period ON interest_rates(institution_id, period_id);

CREATE TABLE dividends (
  id             TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  fiscal_year    TEXT NOT NULL,
  dividend_type  TEXT NOT NULL CHECK (dividend_type IN ('CASH','BONUS','STOCK','PROPERTY')),
  total_pct      REAL,
  cash_pct       REAL,
  bonus_pct      REAL,
  agm_date       TEXT,
  announcement_date TEXT,
  book_closure_start TEXT,
  book_closure_end   TEXT,
  status         TEXT NOT NULL DEFAULT 'ANNOUNCED' CHECK (status IN
    ('ANNOUNCED','APPROVED','PAID','CANCELLED')),
  source_id      TEXT NOT NULL REFERENCES sources(id),
  UNIQUE (institution_id, fiscal_year, dividend_type)
);
CREATE INDEX idx_dividends_inst ON dividends(institution_id, fiscal_year);

CREATE TABLE book_closures (
  id             TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  purpose        TEXT NOT NULL,
  start_date     TEXT NOT NULL,
  end_date       TEXT NOT NULL,
  announced_at   TEXT,
  source_id      TEXT NOT NULL REFERENCES sources(id),
  UNIQUE (institution_id, start_date)
);
CREATE INDEX idx_bookclosures_inst ON book_closures(institution_id, start_date);
```

### 4.7 Documents — link-first, `/go/` as first-class system

`document_categories` = taxonomy of `doc_type`; `documents` = catalog; `document_extractions`
= structured content pulled from the PDF; `outbound_links` = the `/go/` routing table.

```sql
CREATE TABLE document_categories (
  id            TEXT PRIMARY KEY,
  category_code TEXT NOT NULL UNIQUE,   -- ANNUAL_REPORT, QUARTERLY, AGM_NOTICE, AGM_MINUTES,
                                          -- FINANCIAL_STATEMENT, DIVIDEND, BOOK_CLOSURE, RIGHTS,
                                          -- VACANCY, TENDER, POLICY, PRESS_RELEASE, NOTICE, NRB, OTHER
  name_en       TEXT NOT NULL,
  parent_code   TEXT REFERENCES document_categories(category_code),
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  institution_id TEXT REFERENCES institutions(id),   -- NULL => regulator/NRB/general doc
  category      TEXT NOT NULL REFERENCES document_categories(category_code),
  title         TEXT NOT NULL,
  slug          TEXT UNIQUE,             -- SEO URL /reports/{slug} (NULL until classified)
  official_url  TEXT NOT NULL,           -- at publisher; may itself 302
  canonical_url TEXT,                    -- resolved final URL after redirects
  period        TEXT,                    -- '2081-82' for annual reports
  source_id     TEXT NOT NULL REFERENCES sources(id),
  published_at  TEXT NOT NULL,
  discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_checked_at TEXT,
  content_hash  TEXT,                    -- SHA-256 of the CURRENT official document
  file_size     INTEGER,
  mime_type     TEXT,
  language      TEXT DEFAULT 'np',
  archive_policy TEXT NOT NULL DEFAULT 'LINK_ONLY' CHECK (archive_policy IN
    ('LINK_ONLY','OPTIONAL','ARCHIVE','REGULATORY_ARCHIVE')),
  archived_locally INTEGER NOT NULL DEFAULT 0,   -- 0 = we do NOT hold bytes; 1 = R2 copy
  r2_key        TEXT,                    -- NULL unless archived (LINK_ONLY stores no copy)
  availability_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (availability_status IN
    ('AVAILABLE','MISSING','MOVED','UNKNOWN')),
  extraction_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (extraction_status IN
    ('PENDING','EXTRACTED','FAILED','SKIPPED')),
  outbound_link_id TEXT REFERENCES outbound_links(id)   -- /go/ route owner (see 4.8)
);
CREATE INDEX idx_docs_inst      ON documents(institution_id, category, published_at DESC);
CREATE INDEX idx_docs_category  ON documents(category);
CREATE INDEX idx_docs_slug      ON documents(slug);
CREATE INDEX idx_docs_hash      ON documents(content_hash);
CREATE INDEX idx_docs_avail     ON documents(availability_status);
CREATE INDEX idx_docs_archive   ON documents(archive_policy, archived_locally);

CREATE TABLE document_extractions (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field         TEXT NOT NULL,           -- metric name found inside
  value_raw     TEXT NOT NULL,
  value_npr     INTEGER,
  value_pct     REAL,
  value_count   INTEGER,
  unit          TEXT,
  page_number   INTEGER,
  table_index   INTEGER,
  parser_version TEXT NOT NULL,
  confidence    REAL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_doc_extraction ON document_extractions(document_id);
```

### 4.8 `/go/` — outbound link layer (first-class system)

`/go/{scope}/{slug}` is generated **from this table**, never from URLs in HTML. Destination can
change without breaking bookmarks/SEO pages. The SEO layer stays `/reports/{slug}`, `/institutions/...`;
`/go/` pages are `noindex` and excluded from sitemap.xml.

```sql
CREATE TABLE outbound_links (
  id            TEXT PRIMARY KEY,
  scope_key     TEXT NOT NULL,           -- institution slug, 'nrb', or 'general'
  institution_id TEXT REFERENCES institutions(id),   -- denormalized for joins/NULL-able
  slug          TEXT NOT NULL,           -- my-annual-report-2081-82
  target_type   TEXT NOT NULL CHECK (target_type IN
    ('WEBSITE','DOCUMENT','JOB','DIRECTIVE','NOTICE','SOCIAL','OTHER')),
  label         TEXT NOT NULL,
  description   TEXT,
  target_url    TEXT NOT NULL,           -- current destination (may be updated)
  canonical_url TEXT,                    -- resolved final destination
  content_hash  TEXT,
  availability_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (availability_status IN
    ('AVAILABLE','MISSING','MOVED','UNKNOWN')),
  source_id     TEXT NOT NULL REFERENCES sources(id),
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (scope_key, slug)
);
CREATE INDEX idx_outbound_scope ON outbound_links(scope_key, slug, is_active);
CREATE INDEX idx_outbound_inst  ON outbound_links(institution_id);
CREATE INDEX idx_outbound_status ON outbound_links(availability_status);
```

Routes that derive from it:
- `/go/{institution.slug}/{slug}` → `outbound_links.scope_key = institution.slug`
- `/go/nrb/{slug}` → `scope_key = 'nrb'`
- Functions worker resolves `outbound_links` (or a mega-redirect JSON) and issues **302**.
  The redirect map is also exported to **Cloudflare Bulk Redirects** if volume exceeds
  `_redirects` limits (2,100 rules, not applied to Pages Functions).

### 4.9 Content

```sql
CREATE TABLE posts (                  -- editorial: news/analysis/guides by LK desk
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  institution_id TEXT REFERENCES institutions(id),
  source_type   TEXT NOT NULL CHECK (source_type IN ('OFFICIAL','NRB','KHABAR','MEDIA')),
  post_kind     TEXT NOT NULL CHECK (post_kind IN
    ('NEWS','NOTICE','PRESS_RELEASE','ANALYSIS','GUIDE','BLOG')),
  category      TEXT,
  title         TEXT NOT NULL,
  excerpt       TEXT,
  body          TEXT,
  cover_image_url TEXT,
  seo_title     TEXT,
  seo_description TEXT,
  canonical_url TEXT,
  url           TEXT,
  published_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','SCHEDULED','PUBLISHED','ARCHIVED')),
  author_id     TEXT REFERENCES users(id),
  source_id     TEXT REFERENCES sources(id),
  last_verified_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_posts_slug    ON posts(slug);
CREATE INDEX idx_posts_pub     ON posts(published_at DESC);
CREATE INDEX idx_posts_inst    ON posts(institution_id, published_at DESC);
CREATE INDEX idx_posts_source  ON posts(source_type);

CREATE TABLE post_sources (       -- attribution of every post to underlying sources
  id            TEXT PRIMARY KEY,
  post_id       TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  relation      TEXT NOT NULL DEFAULT 'BASED_ON' CHECK (relation IN
    ('BASED_ON','QUOTED','ATTRIBUTION')),
  UNIQUE (post_id, source_id, relation)
);

CREATE TABLE news (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  institution_id TEXT REFERENCES institutions(id),
  source_type   TEXT NOT NULL CHECK (source_type IN ('OFFICIAL','NRB','KHABAR','MEDIA')),
  category      TEXT,
  title         TEXT NOT NULL,
  excerpt       TEXT,
  body          TEXT,
  image_url     TEXT,
  source_url    TEXT,
  published_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','AUTO_PUBLISHED','PUBLISHED','ARCHIVED','REJECTED')),
  source_id     TEXT REFERENCES sources(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_news_pub  ON news(published_at DESC);
CREATE INDEX idx_news_inst ON news(institution_id, published_at DESC);
CREATE INDEX idx_news_type ON news(source_type, status);

CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  institution_id TEXT REFERENCES institutions(id),
  person_id     TEXT REFERENCES people(id),
  branch_id     TEXT REFERENCES branches(id),
  document_id   TEXT REFERENCES documents(id),
  event_type    TEXT NOT NULL,          -- CEO_APPOINTED, AGM_NOTICE, DIVIDEND, BOOK_CLOSURE,
                                          -- FINANCIAL_RESULT, VACANCY, BRANCH_OPENED, NRB_NOTICE...
  title_np      TEXT,
  title_en      TEXT,
  occurred_at   TEXT NOT NULL,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_events_occ   ON events(occurred_at DESC);
CREATE INDEX idx_events_inst  ON events(institution_id, occurred_at DESC);
CREATE INDEX idx_events_person ON events(person_id);

CREATE TABLE timeline_events (        -- canonical MFB macro-history (no overwrite)
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  event_type    TEXT NOT NULL CHECK (event_type IN
    ('LICENSED','MERGED','ACQUIRED','RENAMED','LISTED','DELISTED','SUSPENDED','HEAD_OFFICE_MOVED')),
  title         TEXT NOT NULL,
  occurred_at   TEXT NOT NULL,          -- ISO; source-of-truth ordering
  summary       TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  UNIQUE (institution_id, event_type, occurred_at)
);
CREATE INDEX idx_timeline_inst ON timeline_events(institution_id, occurred_at DESC);

CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  slug          TEXT UNIQUE,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  title         TEXT NOT NULL,
  department    TEXT,
  location      TEXT NOT NULL,
  employment_type TEXT NOT NULL DEFAULT 'FULL_TIME' CHECK (employment_type IN
    ('FULL_TIME','PART_TIME','CONTRACT','INTERN')),
  experience    TEXT,
  education     TEXT,
  deadline      TEXT NOT NULL,
  description   TEXT,
  application_method TEXT,
  application_url TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  published_at  TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  last_verified_at TEXT
);
CREATE INDEX idx_jobs_inst_active ON jobs(institution_id, is_active, deadline);
CREATE INDEX idx_jobs_deadline    ON jobs(deadline);
CREATE INDEX idx_jobs_location    ON jobs(location);

CREATE TABLE research (             -- LK original research/analytics (SEO + premium)
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  category      TEXT,                -- MFB_SERIES, SECTOR, NPL, INTEREST_RATE, RANKING
  summary       TEXT,
  body          TEXT,
  author_id     TEXT REFERENCES users(id),
  published_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  seo_title     TEXT,
  seo_description TEXT,
  source_id     TEXT REFERENCES sources(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_research_slug ON research(slug);

CREATE TABLE videos (
  id            TEXT PRIMARY KEY,
  slug          TEXT UNIQUE,
  institution_id TEXT REFERENCES institutions(id),
  title         TEXT NOT NULL,
  video_type    TEXT NOT NULL CHECK (video_type IN ('YOUTUBE','LIVESTREAM','RECORDED','OTHER')),
  embed_url     TEXT,
  thumbnail_url TEXT,
  published_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  source_id     TEXT REFERENCES sources(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### 4.10 Regulatory — NRB layer (Phase 1.5+)

```sql
CREATE TABLE nrb_documents (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  doc_type      TEXT NOT NULL CHECK (doc_type IN
    ('DIRECTIVE','CIRCULAR','GUIDELINE','KFI','REPORT','ENFORCEMENT','INTEREST_RATE')),
  topic         TEXT,                  -- INTEREST_RATE, PROVISIONING, REPORTING, GOVERNANCE, IT, AML_CFT, CONSUMER
  official_url  TEXT,
  published_at  TEXT,
  effective_date TEXT,
  deadline      TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_nrb_docs_type ON nrb_documents(doc_type, published_at DESC);

CREATE TABLE nrb_directives (
  id            TEXT PRIMARY KEY,
  nrb_document_id TEXT REFERENCES nrb_documents(id),
  directive_no  TEXT,
  title         TEXT NOT NULL,
  effective_date TEXT,
  status        TEXT NOT NULL DEFAULT 'CURRENT' CHECK (status IN
    ('CURRENT','AMENDED','REVOKED')),
  summary       TEXT,
  source_id     TEXT REFERENCES sources(id)
);

CREATE TABLE nrb_institution_links (
  id               TEXT PRIMARY KEY,
  institution_id   TEXT NOT NULL REFERENCES institutions(id),
  nrb_document_id  TEXT REFERENCES nrb_documents(id),
  nrb_directive_id TEXT REFERENCES nrb_directives(id),
  link_type        TEXT NOT NULL CHECK (link_type IN
    ('CLASS','LICENSE','DIRECTIVE','ACTION','MERGED_BY_NRB','INTEREST_RATE')),
  link_date        TEXT,
  source_id        TEXT REFERENCES sources(id),
  UNIQUE (institution_id, nrb_document_id, link_type)
);
CREATE INDEX idx_nrb_links_inst ON nrb_institution_links(institution_id);

CREATE TABLE regulatory_events (
  id            TEXT PRIMARY KEY,
  institution_id TEXT REFERENCES institutions(id),
  event_type    TEXT NOT NULL,         -- LICENSE_SUSPENDED, MERGER_ORDER, DIRECTIVE, ENFORCEMENT
  title         TEXT NOT NULL,
  occurred_at   TEXT NOT NULL,
  description   TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id)
);
CREATE INDEX idx_reg_events ON regulatory_events(institution_id, occurred_at DESC);
```

### 4.11 System

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

CREATE TABLE roles (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,   -- admin, editor, researcher, reviewer
  name          TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE audit_logs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id),
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  before_json   TEXT,
  after_json    TEXT,
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_target ON audit_logs(target_type, target_id, created_at DESC);

CREATE TABLE ingestion_sources (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  domain        TEXT,
  source_type   TEXT NOT NULL CHECK (source_type IN
    ('NRB','MFB_WEBSITE','MFB_DOCUMENT','NEPSE','DATA_PROVIDER','MEDIA','SOCIAL','KHABAR')),
  institution_id TEXT REFERENCES institutions(id),
  config_json   TEXT NOT NULL DEFAULT '{}',   -- sections/rules (see FROZEN-SPEC §4)
  enabled       INTEGER NOT NULL DEFAULT 1,
  fetch_interval_minutes INTEGER NOT NULL DEFAULT 1440,
  last_run_at   TEXT,
  last_success_at TEXT,
  error_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE ingestion_runs (
  id            TEXT PRIMARY KEY,
  ingestion_source_id TEXT NOT NULL REFERENCES ingestion_sources(id),
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN
    ('RUNNING','SUCCESS','FAILED','PARTIAL')),
  items_found   INTEGER DEFAULT 0,
  items_changed INTEGER DEFAULT 0,
  items_new     INTEGER DEFAULT 0,
  items_failed  INTEGER DEFAULT 0,
  parser_version TEXT,
  error_count   INTEGER DEFAULT 0
);
CREATE INDEX idx_ing_runs_source ON ingestion_runs(ingestion_source_id, started_at DESC);

CREATE TABLE ingestion_items (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  item_type     TEXT,                   -- document/news/job/branch/position/x-document
  status        TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN
    ('NEW','CHANGED','UNCHANGED','FAILED')),
  content_hash  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (run_id, url)
);

CREATE TABLE ingestion_errors (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  ingestion_source_id TEXT REFERENCES ingestion_sources(id),
  url           TEXT,
  error_type    TEXT,
  error_message TEXT,
  retry_count   INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ing_errors_run ON ingestion_errors(run_id, created_at DESC);

CREATE TABLE validation_rules (
  id            TEXT PRIMARY KEY,
  rule_code     TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('SANITY','CROSS_SOURCE','TREND','BOUND')),
  severity      TEXT NOT NULL DEFAULT 'WARN' CHECK (severity IN ('ERROR','WARN','INFO')),
  active        INTEGER NOT NULL DEFAULT 1,
  params_json   TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE validation_results (
  id            TEXT PRIMARY KEY,
  target_type   TEXT NOT NULL,          -- financial_metrics, institutions, documents...
  target_id     TEXT NOT NULL,
  rule_id       TEXT NOT NULL REFERENCES validation_rules(id),
  severity      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'FAIL' CHECK (status IN ('PASS','FAIL','PENDING')),
  message       TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_validation_target ON validation_results(target_type, target_id, status);

CREATE TABLE institution_coverage (
  institution_id    TEXT PRIMARY KEY REFERENCES institutions(id),
  overall_status    TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (overall_status IN
    ('NOT_STARTED','DISCOVERED','PARTIAL','VERIFIED','STALE','CONFLICT')),
  identity_status   TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (identity_status IN
    ('NOT_STARTED','DISCOVERED','PARTIAL','VERIFIED','STALE','CONFLICT')),
  leadership_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (leadership_status IN
    ('NOT_STARTED','DISCOVERED','PARTIAL','VERIFIED','STALE','CONFLICT')),
  branch_status     TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (branch_status IN
    ('NOT_STARTED','DISCOVERED','PARTIAL','VERIFIED','STALE','CONFLICT')),
  financial_status  TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (financial_status IN
    ('NOT_STARTED','DISCOVERED','PARTIAL','VERIFIED','STALE','CONFLICT')),
  document_status   TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (document_status IN
    ('NOT_STARTED','DISCOVERED','PARTIAL','VERIFIED','STALE','CONFLICT')),
  news_status       TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (news_status IN
    ('NOT_STARTED','DISCOVERED','PARTIAL','VERIFIED','STALE','CONFLICT')),
  digital_status    TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (digital_status IN
    ('NOT_STARTED','DISCOVERED','PARTIAL','VERIFIED','STALE','CONFLICT')),
  product_status    TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (product_status IN
    ('NOT_STARTED','DISCOVERED','PARTIAL','VERIFIED','STALE','CONFLICT')),
  career_status     TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (career_status IN
    ('NOT_STARTED','DISCOVERED','PARTIAL','VERIFIED','STALE','CONFLICT')),
  last_full_reviewed_at TEXT,
  next_full_review_at   TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_coverage_overall ON institution_coverage(overall_status);
CREATE INDEX idx_coverage_review  ON institution_coverage(next_full_review_at);
```

> **`institution_coverage` is an internal data-quality labeller, not a public score.** It distils
> "MFB exists in our database" vs "MFB comprehensively researched and verified" into per-module
> statuses a reviewer can act on (`PARTIAL` → next steps → `VERIFIED` → quarterly `STALE` sweep).
>
> **Never store a computed percentage.** The `*_status` columns are the only stored source of
> truth. A derived completion fraction is computed at read-time ONLY:
>
> | status       | weight |
> |--------------|--------|
> | VERIFIED     | 1.0    |
> | PARTIAL      | 0.5    |
> | DISCOVERED   | 0.25   |
> | NOT_STARTED  | 0      |
> | STALE        | 0      |
> | CONFLICT     | 0      |
>
> `completion = Σ weights / applicable modules` — computed in the admin dashboard, never written,
> and **never exposed publicly**. The public site shows *facts*, not scores:
>
> - "Identity verified"
> - "Financial data through Q4 2082/83"
> - "Branch information last checked: 24 Sep 2026"
> - "43 reports indexed"
>
> **Populate in phases, not waves.** The schema is complete day one, but the application never
> pretends every field has data. Phase A identity+evidence → B people+branches → C financials →
> D content → E regulatory+ingestion. Each phase flips one `*_status` on the coverage row.

CREATE TABLE field_refresh_policies (
  field_group   TEXT PRIMARY KEY,      -- CEO, BRANCHES, SOCIAL, FINANCIALS, ANNUAL_REPORT, CONTACT, JOBS, NEWS
  refresh_days  INTEGER NOT NULL
);
INSERT INTO field_refresh_policies (field_group, refresh_days) VALUES
  ('CEO',90),('BRANCHES',30),('SOCIAL',30),('FINANCIALS',90),
  ('ANNUAL_REPORT',365),('CONTACT',90),('JOBS',1),('NEWS',1);
```

---

## 5. Provenance, verification & conflict model

- Every row that carries an outside fact has `source_id` (FK to `sources`) and
  `last_verified_at`. `sources.source_grade` encodes hierarchy (A>B>C>D).
- `data_assertions` is the generic evidence row for facts not in a dedicated column, and for
  **history**: `(entity_type, entity_id, field_name, value, source_id, source_snapshot_id,
  observed_at, valid_from, valid_to, confidence, verification_status)`. `valid_to IS NULL`
  means "currently true".
- `data_conflicts` records two disagreeing sources for the same `(entity_type, entity_id,
  field_name)`. Resolution is admin-visible; `data_conflicts.resolution_status` must be OPEN
  until an editor accepts one side. Never silently pick.
- Cross-source metrics: if NRB reports NPL 5.24 and the MFB PDF says 5.23, insert two
  `financial_metrics` rows (each with its own `source_id`) and flag a conflict.

```sql
CREATE TABLE data_assertions (
  id            TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,          -- INSTITUTION, PERSON, POSITION, BRANCH, DOCUMENT, SOCIAL
  entity_id     TEXT NOT NULL,
  field_name    TEXT NOT NULL,
  value         TEXT NOT NULL,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  source_snapshot_id TEXT REFERENCES source_snapshots(id),
  observed_at   TEXT NOT NULL,
  valid_from    TEXT,
  valid_to      TEXT,                   -- NULL = currently true
  confidence    REAL,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN
    ('UNVERIFIED','AUTO_VERIFIED','HUMAN_VERIFIED','CONFLICT','STALE','REJECTED'))
);
CREATE INDEX idx_assertions_entity ON data_assertions(entity_type, entity_id, field_name, valid_to);
CREATE INDEX idx_assertions_status ON data_assertions(verification_status);

CREATE TABLE data_conflicts (
  id            TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  field_name    TEXT NOT NULL,
  source_a_id   TEXT REFERENCES sources(id),
  value_a       TEXT,
  source_b_id   TEXT REFERENCES sources(id),
  value_b       TEXT,
  detected_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolution_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (resolution_status IN
    ('OPEN','RESOLVED','IGNORED')),
  resolved_by   TEXT,
  resolved_at   TEXT,
  resolution_note TEXT
);
CREATE INDEX idx_conflicts_open ON data_conflicts(resolution_status);
CREATE INDEX idx_conflicts_entity ON data_conflicts(entity_type, entity_id, field_name);
```

---

## 6. API boundaries (V1 contract — unchanged from FROZEN-SPEC)

```
GET /api/institutions/{slug}
GET /api/institutions/{slug}/leadership
GET /api/institutions/{slug}/branches
GET /api/institutions/{slug}/financials
GET /api/institutions/{slug}/documents
GET /api/institutions/{slug}/events
GET /api/institutions/{slug}/jobs
GET /api/people/{slug}
GET /api/interest-rates?period=2083-asr
GET /api/news?source_type=OFFICIAL|NRB|KHABAR
GET /api/search?q=...
```

Services/repositories sit between Next.js and D1 so a PostgreSQL migration is a config
change, not a rewrite. DTO field names NEVER mirror table columns 1:1.

---

## 7. SEO entities (auto-generated from the data model)

| Entity | URL | Generated from |
|---|---|---|
| Institution | `/institutions/{slug}` | `institutions.slug` |
| Financials | `/institutions/{slug}/financials` | `financial_reports/metrics` |
| Reports | `/institutions/{slug}/reports` & `/reports/{slug}` | `documents.slug` |
| Branches | `/branches/{district}` | `branches.district` |
| Jobs | `/jobs/{slug}` | `jobs.slug` |
| News | `/news/{slug}` | `news.slug` |
| People | `/people/{slug}` | `people.slug` |
| Interest rates | `/interest-rates/{period_code}` | `interest_rate_periods.period_code` |
| Events/calendar | `/calendar` | `events.occurred_at`, `book_closures`, `dividends` |
| Research | `/research/{slug}` | `research.slug` |
| Timeline | `/institutions/{slug}/timeline` | `timeline_events` + `events` |
| **Outbound** | `/go/{scope}/{slug}` (noindex) | `outbound_links` |

`sitemap.xml` is generated at build from these slugs. `/go/*` is excluded and carries
`X-Robots-Tag: noindex`.

---

## 8. Migration strategy

**Terminology (fixed):**
- **53 tables** = the canonical production schema (this document's ER model). They ARE the target.
- **`migrations/0001_initial.sql` … `0007_system.sql`** = migration *units*. 0001–0007 are the
  current full sequence; there is no "0001→0006" — **0007 ships with V1**.
- **`schema/schema.sql`** = generated from the migrations by `scripts/build-schema.cjs`
  (concatenation). **Never manually edited.** It mirrors migrations 1:1.

How migrations are applied:
- `wrangler d1 migrations apply` uses the numbered files in order; `d1 execute --file=` uses the
  concatenated baseline. Both must produce identical schemas.
- Never modify an applied migration. Add a new numbered file for every change.
- Portability guard: SQL is SQLite-compatible; CI runs each migration against a fresh local
  SQLite file before deploy.

---

## 9. Seed / master data

- `/data/master/institutions.ts` = **MASTER UNIVERSE SNAPSHOT**, NOT a claim that "there are
  permanently 51 MFBs". It is the set of all Class-D MFBs observed on the **NRB BFI list as of
  2026-06-20** (`source_id = "nrb-bfi-mid-may-2026"`). Institutions get licensed, merged,
  acquired, renamed, liquidated — so the universe **must be periodically refreshed from NRB**.
- **Refresh is additive and non-destructive.** Re-run the importer against a newer NRB list:
  new licenses → new `institutions` rows; mergers/renames → `timeline_events` + `institutions.status`
  change; nothing is deleted. `institution_aliases` + `timeline_events` already model the change
  over time (a merged MFB stays queryable as a historical predecessor).
- Selective import from the old `senna-mfi-db` export, with a real `sources` row per MFB.
- Not 5 hand-picked rows: the architecture supports all MFBs from day one; the **5-MFB pilot**
  (Infinity, Mero, Matribhumi, Chhimek, Nirdhan) is only the *crawler validation set*.
- A seed script (`scripts/seed.cjs`) inserts master data idempotently (INSERT OR IGNORE),
  creates `metric_definitions`, `document_categories`, `field_refresh_policies`,
  `validation_rules`, admin `users`/`roles`.
- Financial seed data is `UNVERIFIED` until a source snapshot confirms it — no fabricated
  numbers. Old-SQLite financials may be imported only with `source_id` = the original report,
  and marked `UNVERIFIED`.

---

## 10. 5-MFB pilot data set (crawler validation)

| MFB | Proves |
|---|---|
| Infinity (ILBS) | controlled/known data; we can verify every fact |
| Mero (MERO) | different website structure; 149-branch census; download catalogue |
| Matribhumi (MATRI) | large document archive; VAPT findings → same engine must index it |
| Chhimek (CBBL) | large/established MFB; NEPSE data available |
| Nirdhan (NUBL) | older institution; deep history (mergers since 1999) |

Each pilot gets `ingestion_sources` configs; success = the generic engine extracts, validates,
and renders correct pages WITHOUT any per-MFB code path.

---

## 11. Deliberately NOT in V1 DB

FTS5 search index (V2 — add at seed time, SQLite-native), TimescaleDB, vector embeddings,
Kafka, per-MFB message queues, document text storage in D1 (post-PG; R2 only), portfolio/
trading state, employee PII.