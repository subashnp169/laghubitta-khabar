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