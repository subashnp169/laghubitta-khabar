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