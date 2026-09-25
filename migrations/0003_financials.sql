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