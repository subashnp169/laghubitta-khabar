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