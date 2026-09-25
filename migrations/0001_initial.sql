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