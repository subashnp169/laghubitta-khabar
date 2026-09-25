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