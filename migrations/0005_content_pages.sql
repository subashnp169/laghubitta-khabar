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