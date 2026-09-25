-- =============================================================================
-- Laghubitta Khabar — schema.sql (GENERATED — do not edit)
-- Regenerate with: node scripts/build-schema.cjs
-- Canonical source: docs/DATABASE-SPEC.md + migrations/*.sql
-- Frozen 2026-09-24 · Portable SQLite / D1
-- =============================================================================

PRAGMA foreign_keys = ON;

-- >>> migration: 0001_initial.sql
-- =============================================================================
-- 0001_initial.sql — Laghubitta Khabar canonical DB (frozen 2026-09-24)
-- Core: evidence backbone, identity, vocabulary, /go/ routing.
-- Portable SQLite / D1. Source of truth: docs/DATABASE-SPEC.md.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- EVIDENCE BACKBONE (everything outside-fact FKs here)
-- ---------------------------------------------------------------------------

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
  r2_key          TEXT,
  first_seen_at   TEXT,
  last_seen_at    TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE source_snapshots (
  id                TEXT PRIMARY KEY,
  source_id         TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  fetched_at        TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  http_status       INTEGER,
  mime_type         TEXT,
  r2_key            TEXT,
  parser_version    TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (extraction_status IN
    ('PENDING','EXTRACTED','FAILED','SKIPPED'))
);

-- ---------------------------------------------------------------------------
-- SYSTEM VOCABULARY (foundation rows)
-- ---------------------------------------------------------------------------

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
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE metric_definitions (
  metric_code   TEXT PRIMARY KEY,
  name_en       TEXT NOT NULL,
  name_np       TEXT,
  category      TEXT NOT NULL CHECK (category IN
    ('KEY','ASSET_QUALITY','CAPITAL','PROFITABILITY','EFFICIENCY','OTHER')),
  value_type    TEXT NOT NULL CHECK (value_type IN ('AMOUNT','RATIO','COUNT','YEAR')),
  default_unit  TEXT NOT NULL DEFAULT 'NPR',
  formula       TEXT,
  lower_bound   REAL,
  upper_bound   REAL,
  is_ratio      INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE document_categories (
  id            TEXT PRIMARY KEY,
  category_code TEXT NOT NULL UNIQUE,
  name_en       TEXT NOT NULL,
  parent_code   TEXT REFERENCES document_categories(category_code),
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE field_refresh_policies (
  field_group   TEXT PRIMARY KEY,
  refresh_days  INTEGER NOT NULL
);

CREATE TABLE validation_rules (
  id            TEXT PRIMARY KEY,
  rule_code     TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('SANITY','CROSS_SOURCE','TREND','BOUND')),
  severity      TEXT NOT NULL DEFAULT 'WARN' CHECK (severity IN ('ERROR','WARN','INFO')),
  active        INTEGER NOT NULL DEFAULT 1,
  params_json   TEXT NOT NULL DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- INSTITUTIONS (canonical universe)
-- ---------------------------------------------------------------------------

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

CREATE TABLE institution_aliases (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  alias         TEXT NOT NULL,
  alias_type    TEXT NOT NULL DEFAULT 'NAME_ALT' CHECK (alias_type IN
    ('TICKER','TICKER_PROMOTER','NAME_ALT','NAME_NP','FORMER','SHORT')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT REFERENCES sources(id),
  last_verified_at TEXT,
  UNIQUE (institution_id, alias)
);

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

CREATE TABLE slug_aliases (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  old_slug      TEXT NOT NULL UNIQUE,
  moved_to      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- /GO/ OUTBOUND ROUTING LAYER (first-class; SEO pages are separate)
-- /go/{scope}/{slug} resolves here. Entities: documents, section 4.8.
-- ---------------------------------------------------------------------------

CREATE TABLE outbound_links (
  id            TEXT PRIMARY KEY,
  scope_key     TEXT NOT NULL,
  institution_id TEXT REFERENCES institutions(id),
  slug          TEXT NOT NULL,
  target_type   TEXT NOT NULL CHECK (target_type IN
    ('WEBSITE','DOCUMENT','JOB','DIRECTIVE','NOTICE','SOCIAL','OTHER')),
  label         TEXT NOT NULL,
  description   TEXT,
  target_url    TEXT NOT NULL,
  canonical_url TEXT,
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

-- ---------------------------------------------------------------------------
-- FOUNDATION SEEDS
-- ---------------------------------------------------------------------------

INSERT INTO field_refresh_policies (field_group, refresh_days) VALUES
  ('CEO',90),('BRANCHES',30),('SOCIAL',30),('FINANCIALS',90),
  ('ANNUAL_REPORT',365),('CONTACT',90),('JOBS',1),('NEWS',1);

-- >>> migration: 0002_people_history.sql
-- =============================================================================
-- 0002_people_history.sql — people, positions, committees, branches (tier 1/2)
-- =============================================================================

CREATE TABLE people (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name_en       TEXT NOT NULL,
  name_np       TEXT,
  tier          INTEGER NOT NULL DEFAULT 1 CHECK (tier IN (1,2,3)),
  photo_url     TEXT,
  email         TEXT,
  education     TEXT,
  bio           TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  last_verified_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE positions (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  role          TEXT NOT NULL,
  tier          INTEGER NOT NULL DEFAULT 1 CHECK (tier IN (1,2,3)),
  committee     TEXT,
  appointed_at  TEXT,
  ended_at      TEXT,
  is_current    INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  last_verified_at TEXT,
  UNIQUE (person_id, institution_id, role, appointed_at)
);

CREATE TABLE committees (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  name          TEXT NOT NULL,
  committee_type TEXT NOT NULL CHECK (committee_type IN ('BOARD','AGM','SUB','OTHER')),
  formed_at     TEXT,
  dissolved_at  TEXT,
  source_id     TEXT REFERENCES sources(id)
);

CREATE TABLE committee_members (
  id                TEXT PRIMARY KEY,
  committee_id      TEXT NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  person_id         TEXT NOT NULL REFERENCES people(id),
  role_in_committee TEXT,
  from_date         TEXT,
  to_date           TEXT,
  source_id         TEXT REFERENCES sources(id),
  UNIQUE (committee_id, person_id, from_date)
);

-- ---------------------------------------------------------------------------
-- BRANCHES (history, not a count) — manager_person_id refs people above
-- ---------------------------------------------------------------------------

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
  manager_person_id TEXT REFERENCES people(id),
  geo_lat        REAL,
  geo_lng        REAL,
  opened_at      TEXT,
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  source_id      TEXT NOT NULL REFERENCES sources(id),
  last_verified_at TEXT,
  UNIQUE (institution_id, branch_name)
);

CREATE TABLE branch_history (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN
    ('OPENED','CLOSED','RELOCATED','RENAMED','TYPE_CHANGED')),
  occurred_at   TEXT NOT NULL,
  from_value    TEXT,
  to_value      TEXT,
  source_id     TEXT REFERENCES sources(id),
  note          TEXT
);

-- >>> migration: 0003_financials.sql
-- =============================================================================
-- 0003_financials.sql — normalized financials + interest rates + corporates
-- =============================================================================

CREATE TABLE financial_reports (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  report_type   TEXT NOT NULL CHECK (report_type IN
    ('ANNUAL','QUARTERLY','HALF_YEARLY','NINE_MONTH','AUDITED','UNAUDITED')),
  period        TEXT NOT NULL,
  period_end    TEXT NOT NULL,
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

CREATE TABLE financial_metrics (
  id            TEXT PRIMARY KEY,
  report_id     TEXT NOT NULL REFERENCES financial_reports(id) ON DELETE CASCADE,
  metric_code   TEXT NOT NULL REFERENCES metric_definitions(metric_code),
  value_npr     INTEGER,
  value_pct     REAL,
  count_value   INTEGER,
  year_value    INTEGER,
  unit          TEXT NOT NULL DEFAULT 'NPR',
  reported_value     TEXT NOT NULL,          -- as-reported representation, e.g. 'Rs. 1,234.56 million'
  normalized_value   TEXT,                   -- canonical string form after normalization
  source_id     TEXT NOT NULL REFERENCES sources(id),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN
    ('UNVERIFIED','AUTO_VERIFIED','HUMAN_VERIFIED','CONFLICT','STALE','REJECTED')),
  last_verified_at TEXT,
  UNIQUE (report_id, metric_code),
  CHECK (value_npr IS NOT NULL OR value_pct IS NOT NULL OR count_value IS NOT NULL OR year_value IS NOT NULL)
);

CREATE TABLE interest_rate_periods (
  id            TEXT PRIMARY KEY,
  period_code   TEXT NOT NULL UNIQUE,
  period_label  TEXT NOT NULL,
  fiscal_year   TEXT,
  published_at  TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  url           TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

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

-- >>> migration: 0004_documents.sql
-- =============================================================================
-- 0004_documents.sql — link-first document catalog + extractions
-- =============================================================================

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  institution_id TEXT REFERENCES institutions(id),
  category      TEXT NOT NULL REFERENCES document_categories(category_code),
  title         TEXT NOT NULL,
  slug          TEXT UNIQUE,
  official_url  TEXT NOT NULL,
  canonical_url TEXT,
  period        TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  published_at  TEXT NOT NULL,
  discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_checked_at TEXT,
  content_hash  TEXT,
  file_size     INTEGER,
  mime_type     TEXT,
  language      TEXT DEFAULT 'np',
  archive_policy TEXT NOT NULL DEFAULT 'LINK_ONLY' CHECK (archive_policy IN
    ('LINK_ONLY','OPTIONAL','ARCHIVE','REGULATORY_ARCHIVE')),
  archived_locally INTEGER NOT NULL DEFAULT 0,
  r2_key        TEXT,
  availability_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (availability_status IN
    ('AVAILABLE','MISSING','MOVED','UNKNOWN')),
  extraction_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (extraction_status IN
    ('PENDING','EXTRACTED','FAILED','SKIPPED')),
  outbound_link_id TEXT REFERENCES outbound_links(id)
);

CREATE TABLE document_extractions (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field         TEXT NOT NULL,
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

-- >>> migration: 0005_content_pages.sql
-- =============================================================================
-- 0005_content_pages.sql — posts/news/events/jobs/research/videos/timeline
-- =============================================================================

CREATE TABLE posts (
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

CREATE TABLE post_sources (
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

CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  institution_id TEXT REFERENCES institutions(id),
  person_id     TEXT REFERENCES people(id),
  branch_id     TEXT REFERENCES branches(id),
  document_id   TEXT REFERENCES documents(id),
  event_type    TEXT NOT NULL,
  title_np      TEXT,
  title_en      TEXT,
  occurred_at   TEXT NOT NULL,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE timeline_events (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  event_type    TEXT NOT NULL CHECK (event_type IN
    ('LICENSED','MERGED','ACQUIRED','RENAMED','LISTED','DELISTED','SUSPENDED','HEAD_OFFICE_MOVED')),
  title         TEXT NOT NULL,
  occurred_at   TEXT,
  summary       TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  UNIQUE (institution_id, event_type, occurred_at)
);

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

CREATE TABLE research (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  category      TEXT,
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

-- >>> migration: 0006_regulatory.sql
-- =============================================================================
-- 0006_regulatory.sql — NRB layer (Phase 1.5+)
-- =============================================================================

CREATE TABLE nrb_documents (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  doc_type      TEXT NOT NULL CHECK (doc_type IN
    ('DIRECTIVE','CIRCULAR','GUIDELINE','KFI','REPORT','ENFORCEMENT','INTEREST_RATE')),
  topic         TEXT,
  official_url  TEXT,
  published_at  TEXT,
  effective_date TEXT,
  deadline      TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

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

CREATE TABLE regulatory_events (
  id            TEXT PRIMARY KEY,
  institution_id TEXT REFERENCES institutions(id),
  event_type    TEXT NOT NULL,
  title         TEXT NOT NULL,
  occurred_at   TEXT NOT NULL,
  description   TEXT,
  source_id     TEXT NOT NULL REFERENCES sources(id)
);

-- >>> migration: 0007_system.sql
-- =============================================================================
-- 0007_system.sql — products, social, provenance/conflicts, ingestion audit,
-- validation, audit logs, indexes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PRODUCTS / SERVICES / SOCIAL / DIGITAL
-- ---------------------------------------------------------------------------

CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  product_type  TEXT NOT NULL CHECK (product_type IN ('SAVINGS','LOAN','DIGITAL','CHANNEL')),
  name          TEXT NOT NULL,
  category      TEXT,
  rate          REAL,
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  last_verified_at TEXT
);

CREATE TABLE services (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  service_type  TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  url           TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT REFERENCES sources(id),
  last_verified_at TEXT
);

CREATE TABLE social_accounts (
  id            TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  platform      TEXT NOT NULL CHECK (platform IN
    ('WEBSITE','FACEBOOK','LINKEDIN','YOUTUBE','INSTAGRAM','X','MOBILE_APP')),
  url           TEXT NOT NULL,
  handle        TEXT,
  verified      INTEGER NOT NULL DEFAULT 0,
  last_checked  TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  source_id     TEXT REFERENCES sources(id),
  UNIQUE (institution_id, platform)
);

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
  canonical_url TEXT,
  verified      INTEGER NOT NULL DEFAULT 0,
  verified_at   TEXT,
  status        TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN ('VERIFIED','CANDIDATE','STALE','FAILED')),
  source_id     TEXT REFERENCES sources(id),
  last_checked_at TEXT,
  UNIQUE (institution_id, link_type, url)
);

-- ---------------------------------------------------------------------------
-- PROVENANCE: ASSERTIONS + CONFLICTS (the evidence engine)
-- ---------------------------------------------------------------------------

CREATE TABLE data_assertions (
  id            TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  field_name    TEXT NOT NULL,
  value         TEXT NOT NULL,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  source_snapshot_id TEXT REFERENCES source_snapshots(id),
  observed_at   TEXT NOT NULL,
  valid_from    TEXT,
  valid_to      TEXT,
  confidence    REAL,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN
    ('UNVERIFIED','AUTO_VERIFIED','HUMAN_VERIFIED','CONFLICT','STALE','REJECTED'))
);

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

-- ---------------------------------------------------------------------------
-- INGESTION AUDIT + VALIDATION + AUDIT LOGS
-- ---------------------------------------------------------------------------

CREATE TABLE ingestion_sources (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  domain        TEXT,
  source_type   TEXT NOT NULL CHECK (source_type IN
    ('NRB','MFB_WEBSITE','MFB_DOCUMENT','NEPSE','DATA_PROVIDER','MEDIA','SOCIAL','KHABAR')),
  institution_id TEXT REFERENCES institutions(id),
  config_json   TEXT NOT NULL DEFAULT '{}',
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

CREATE TABLE ingestion_items (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  item_type     TEXT,
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

CREATE TABLE validation_results (
  id            TEXT PRIMARY KEY,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  rule_id       TEXT NOT NULL REFERENCES validation_rules(id),
  severity      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'FAIL' CHECK (status IN ('PASS','FAIL','PENDING')),
  message       TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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

-- ---------------------------------------------------------------------------
-- INDEXES (D1 is row-billed: index every WHERE/JOIN/ORDER)
-- ---------------------------------------------------------------------------

CREATE INDEX idx_sources_url             ON sources(url);
CREATE INDEX idx_sources_grade           ON sources(source_grade);
CREATE INDEX idx_sources_domain          ON sources(domain);
CREATE INDEX idx_snapshots_source        ON source_snapshots(source_id, fetched_at DESC);

CREATE INDEX idx_inst_status             ON institutions(status);
CREATE INDEX idx_inst_type               ON institutions(institution_type);
CREATE INDEX idx_inst_district           ON institutions(head_office_district);
CREATE INDEX idx_inst_updated            ON institutions(updated_at);
CREATE INDEX idx_alias_inst              ON institution_aliases(institution_id);

CREATE INDEX idx_outbound_scope          ON outbound_links(scope_key, slug, is_active);
CREATE INDEX idx_outbound_inst           ON outbound_links(institution_id);
CREATE INDEX idx_outbound_status         ON outbound_links(availability_status);

CREATE INDEX idx_people_slug             ON people(slug);
CREATE INDEX idx_positions_person        ON positions(person_id);
CREATE INDEX idx_positions_institution   ON positions(institution_id, role, ended_at);
CREATE INDEX idx_positions_current       ON positions(institution_id, is_current, ended_at);
CREATE INDEX idx_committees_inst         ON committees(institution_id);

CREATE INDEX idx_branches_inst           ON branches(institution_id);
CREATE INDEX idx_branches_geo            ON branches(province, district);
CREATE INDEX idx_branches_dist           ON branches(district);
CREATE INDEX idx_branches_open           ON branches(institution_id, status);
CREATE INDEX idx_branch_hist             ON branch_history(branch_id, occurred_at DESC);

CREATE INDEX idx_products_inst           ON products(institution_id);
CREATE INDEX idx_services_inst           ON services(institution_id);
CREATE INDEX idx_social_inst             ON social_accounts(institution_id);
CREATE INDEX idx_official_links_inst     ON official_links(institution_id);

CREATE INDEX idx_fin_rpt_inst            ON financial_reports(institution_id, period_end DESC, report_type);
CREATE INDEX idx_fin_rpt_period          ON financial_reports(period_end DESC);
CREATE INDEX idx_fin_metrics_report      ON financial_metrics(report_id);
CREATE INDEX idx_fin_metrics_code        ON financial_metrics(metric_code, verification_status);
CREATE INDEX idx_rate_periods            ON interest_rate_periods(period_code);
CREATE INDEX idx_rates_inst_period       ON interest_rates(institution_id, period_id);
CREATE INDEX idx_dividends_inst          ON dividends(institution_id, fiscal_year);
CREATE INDEX idx_bookclosures_inst       ON book_closures(institution_id, start_date);

CREATE INDEX idx_docs_inst               ON documents(institution_id, category, published_at DESC);
CREATE INDEX idx_docs_category           ON documents(category);
CREATE INDEX idx_docs_slug               ON documents(slug);
CREATE INDEX idx_docs_hash               ON documents(content_hash);
CREATE INDEX idx_docs_avail              ON documents(availability_status);
CREATE INDEX idx_docs_archive            ON documents(archive_policy, archived_locally);
CREATE INDEX idx_doc_extraction          ON document_extractions(document_id);

CREATE INDEX idx_posts_slug              ON posts(slug);
CREATE INDEX idx_posts_pub               ON posts(published_at DESC);
CREATE INDEX idx_posts_inst              ON posts(institution_id, published_at DESC);
CREATE INDEX idx_posts_source            ON posts(source_type);
CREATE INDEX idx_news_pub                ON news(published_at DESC);
CREATE INDEX idx_news_inst               ON news(institution_id, published_at DESC);
CREATE INDEX idx_news_type               ON news(source_type, status);
CREATE INDEX idx_events_occ              ON events(occurred_at DESC);
CREATE INDEX idx_events_inst             ON events(institution_id, occurred_at DESC);
CREATE INDEX idx_events_person           ON events(person_id);
CREATE INDEX idx_timeline_inst           ON timeline_events(institution_id, occurred_at DESC);
CREATE INDEX idx_jobs_inst_active        ON jobs(institution_id, is_active, deadline);
CREATE INDEX idx_jobs_deadline           ON jobs(deadline);
CREATE INDEX idx_jobs_location           ON jobs(location);
CREATE INDEX idx_research_slug           ON research(slug);

CREATE INDEX idx_nrb_docs_type           ON nrb_documents(doc_type, published_at DESC);
CREATE INDEX idx_nrb_links_inst          ON nrb_institution_links(institution_id);
CREATE INDEX idx_reg_events              ON regulatory_events(institution_id, occurred_at DESC);

CREATE INDEX idx_assertions_entity       ON data_assertions(entity_type, entity_id, field_name, valid_to);
CREATE INDEX idx_assertions_status       ON data_assertions(verification_status);
CREATE INDEX idx_conflicts_open          ON data_conflicts(resolution_status);
CREATE INDEX idx_conflicts_entity        ON data_conflicts(entity_type, entity_id, field_name);

CREATE INDEX idx_ing_runs_source         ON ingestion_runs(ingestion_source_id, started_at DESC);
CREATE INDEX idx_ing_errors_run          ON ingestion_errors(run_id, created_at DESC);
CREATE INDEX idx_validation_target       ON validation_results(target_type, target_id, status);
CREATE INDEX idx_audit_target            ON audit_logs(target_type, target_id, created_at DESC);

