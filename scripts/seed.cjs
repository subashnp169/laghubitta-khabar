/* eslint-disable @typescript-eslint/no-require-imports */
// =============================================================================
// scripts/seed.cjs — idempotent Phase A seed for the canonical universe.
// Usage: node scripts/seed.cjs [path-to-db-file]
//   (default: creates ./lk.db next to this file — D1-compatible portable SQLite)
// Pipeline: schema/schema.sql (migrations 0001..0007) → master rows from
// data/master/master.json. INSERT OR IGNORE everywhere; safe to re-run.
// Never fabricates data: anything not source-backed stays unset.
//
// SOURCE DEDUP RULE (sources.url UNIQUE — do NOT remove the constraint):
//   sources.url is UNIQUE in the canonical schema. One physical URL = one source
//   identity. The importer MUST deduplicate BEFORE insertion. Deterministic rule:
//     same URL  →  retain the semantically authoritative source (sector_analysis
//     > lowercase-id evidence duplicate)  →  discard the duplicate registry alias.
//   See build-master.cjs (URL_KEEP table) + docs/DATABASE-SPEC.md §9.
//
// DISCIPLINE (docs/OPERATIONS.md): this script writes a file and might delete
// (unlink) an existing local DB. It is LOCAL tooling ONLY — it must never run
// against a staging/production D1. Blocked whenever LK_ENV=staging|production.
// =============================================================================
const { guardOrExit } = require('./guard-env.cjs');
guardOrExit('scripts/seed.cjs');

const fs = require('fs');
const path = require('path');

let Database;
try { Database = require('better-sqlite3'); }
catch (e) {
  try { Database = require(path.join('D:/lk2/node_modules', 'better-sqlite3')); }
  catch (e2) { Database = null; }
}

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.argv[2] || path.join(ROOT, 'lk.db');
const schemaSql = fs.readFileSync(path.join(ROOT, 'schema', 'schema.sql'), 'utf8');
const master = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'master', 'master.json'), 'utf8'));
const pilot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'pilot', 'pilot-sources.json'), 'utf8'));

try { fs.unlinkSync(DB_PATH); } catch (e) {}
const db = Database ? new Database(DB_PATH) : null;
if (!db) { console.error('better-sqlite3 unavailable'); process.exit(1); }
db.pragma('foreign_keys = ON');
db.exec(schemaSql);

const txn = (...stmts) => {
  const run = db.transaction(() => stmts.forEach(s => db.exec(s)));
  run();
};

const now = '2026-09-24T12:00:00.000Z';
const ins = (table, obj) => {
  const keys = Object.keys(obj);
  const sql = `INSERT OR IGNORE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  db.prepare(sql).run(...keys.map(k => obj[k]));
};

const q = (sql) => db.prepare(sql).get();
const counts = {};

// --- SOURCES ---
for (const s of master.sources) ins('sources', {
  id: s.id, source_type: s.source_type, source_scope: s.source_scope,
  source_grade: s.source_grade, url: s.url, domain: s.domain,
  title: s.title, publisher: s.publisher, is_active: s.is_active, created_at: now,
});
counts.sources = q('SELECT COUNT(*) c FROM sources').c;

// --- INSTITUTIONS (canonical universe = 51 current licensed) ---
for (const i of master.institutions) ins('institutions', {
  id: i.id, slug: i.slug, name_en: i.name_en, name_np: i.name_np,
  short_name: i.short_name, institution_type: i.institution_type, status: i.status,
  registration_number: i.registration_number, nrb_license_number: i.nrb_license_number,
  nrb_class: i.nrb_class, operation_date: i.operation_date,
  head_office_district: i.head_office_district, head_office_municipality: i.head_office_municipality,
  head_office_address: i.head_office_address, working_area: i.working_area,
  official_website: i.official_website, official_email: i.official_email,
  official_phone: i.official_phone, logo_url: i.logo_url, established: i.established,
  listed: i.listed, source_id: i.source_id, last_verified_at: i.last_verified_at,
  next_review_at: i.next_review_at, created_at: now, updated_at: now,
});
counts.institutions = q('SELECT COUNT(*) c FROM institutions').c;

// --- ALIASES ---
for (const a of master.aliases) ins('institution_aliases', {
  id: `al-${a.institution_id}-${a.normalized_alias.replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
  institution_id: a.institution_id, alias: a.alias, alias_type: a.alias_type,
  is_active: 1, source_id: 'nrb-bfi-mid-may-2026', last_verified_at: now,
});
counts.institution_aliases = q('SELECT COUNT(*) c FROM institution_aliases').c;

// --- CANONICAL LINEAGE (P1-A slug redirects + P1-B FORMER aliases) ---
// master.json is fingerprinted and cannot carry slug redirects or absorbed
// predecessor names, so those live in data/master/canonical-*.json. Seed them
// into the canonical store here so lk.db resolves superseded slugs and FORMER
// aliases exactly as the published module and the verifier do.
const readJsonIfExists = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};
const slugAliasDoc = readJsonIfExists('data/master/canonical-slug-aliases.json');
const formerAliasDoc = readJsonIfExists('data/master/canonical-former-aliases.json');

let slugAliases = 0;
if (slugAliasDoc) for (const r of slugAliasDoc.rows) {
  ins('slug_aliases', {
    id: `sa-${r.old_slug}`, institution_id: r.institution_id,
    old_slug: r.old_slug, moved_to: r.moved_to, created_at: now,
  });
  slugAliases++;
}
counts.slug_aliases = q('SELECT COUNT(*) c FROM slug_aliases').c;

let formerAliases = 0;
if (formerAliasDoc) for (const r of formerAliasDoc.rows) {
  ins('institution_aliases', {
    id: `al-${r.institution_id}-former-${String(r.alias).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
    institution_id: r.institution_id, alias: r.alias, alias_type: r.alias_type || 'FORMER',
    is_active: 1, source_id: r.source_id || 'nrb-bfi-mid-may-2026', last_verified_at: now,
  });
  formerAliases++;
}
counts.institution_aliases = q('SELECT COUNT(*) c FROM institution_aliases').c;

// --- OFFICIAL LINKS (first-class evidence; none trusted until verified=1) ---
for (const l of master.officialLinks) ins('official_links', {
  id: `ol-${l.institution_id}-${l.link_type.toLowerCase()}-${l.url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').slice(-40)}`,
  institution_id: l.institution_id, link_type: l.link_type, label: l.label,
  url: l.url, canonical_url: l.canonical_url, verified: l.verified,
  verified_at: l.verified_at, status: l.status, source_id: l.source_id,
  last_checked_at: l.last_checked_at,
});
counts.official_links = q('SELECT COUNT(*) c FROM official_links').c;

// --- TIMELINE EVENTS (63 historical predecessors; occurred_at null is honest) ---
let t = 0;
for (const e of master.timeline) {
  if (!e.institution_id) continue;
  ins('timeline_events', {
    id: `te-${e.predecessor_id}`,
    institution_id: e.institution_id, event_type: e.event_type, title: e.title,
    occurred_at: e.occurred_at, summary: e.summary, source_id: e.source_id,
  });
  t++;
}
counts.timeline_events = t;

// --- PILOT SOURCES (Phase B evidence records, data/pilot/pilot-sources.json) ---
// Canonical source identity for the official websites of the pilot MFBs. Only the
// NRB-proven website URL is a real url; every other capability is a discovery intent
// (known_url=null) stored as config, never fabricated. Status stays CANDIDATE.
for (const s of pilot.sources) {
  ins('sources', {
    id: s.id, source_type: s.source_type, source_scope: s.source_scope,
    source_grade: s.source_grade, url: s.url, domain: s.domain,
    title: s.title, publisher: s.publisher, is_active: s.is_active, created_at: now,
  });
  ins('ingestion_sources', {
    id: s.id, url: s.url, domain: s.domain, source_type: s.source_type,
    institution_id: s.institution_id,
    config_json: JSON.stringify({ capabilities: s.capabilities }),
    enabled: s.is_active, fetch_interval_minutes: 1440,
    created_at: now,
  });
}
counts.sources = q('SELECT COUNT(*) c FROM sources').c;
counts.ingestion_sources = q('SELECT COUNT(*) c FROM ingestion_sources').c;

// --- COVERAGE (51 rows; NOT_STARTED until a phase flips a status) ---
for (const i of master.institutions) ins('institution_coverage', {
  institution_id: i.id, overall_status: 'NOT_STARTED',
  identity_status: 'DISCOVERED', // canonical identity present, needs verification completeness
  leadership_status: 'NOT_STARTED', branch_status: 'NOT_STARTED',
  financial_status: 'NOT_STARTED', document_status: 'NOT_STARTED',
  news_status: 'NOT_STARTED', digital_status: 'DISCOVERED',
  product_status: 'NOT_STARTED', career_status: 'NOT_STARTED',
  last_full_reviewed_at: null, next_full_review_at: '2026-12-24', updated_at: now,
});
counts.institution_coverage = q('SELECT COUNT(*) c FROM institution_coverage').c;

// --- /go/ outbound layer from official links (redirect doors, noindex) ---
for (const l of master.officialLinks) ins('outbound_links', {
  id: `go-ws-${l.institution_id}`,
  scope_key: l.institution_id, institution_id: l.institution_id,
  slug: 'website', target_type: 'WEBSITE', label: l.label,
  target_url: l.url, canonical_url: l.canonical_url,
  availability_status: 'UNKNOWN', source_id: l.source_id,
  first_seen_at: now, last_checked_at: null, is_active: 1, created_at: now, updated_at: now,
});
counts.outbound_links = q('SELECT COUNT(*) c FROM outbound_links').c;

console.log('Seeded (idempotent, INSERT OR IGNORE) into', DB_PATH);
console.log(JSON.stringify(counts, null, 2));

// --- integrity checks (evidence backbone: nothing orphaned) ---
const orphan = q(`SELECT COUNT(*) c FROM institution_aliases a LEFT JOIN institutions i ON i.id=a.institution_id WHERE i.id IS NULL`).c;
const orphanOl = q(`SELECT COUNT(*) c FROM official_links l LEFT JOIN institutions i ON i.id=l.institution_id WHERE i.id IS NULL`).c;
const orphanTe = q(`SELECT COUNT(*) c FROM timeline_events e LEFT JOIN institutions i ON i.id=e.institution_id WHERE i.id IS NULL`).c;
const orphanSlug = q(`SELECT COUNT(*) c FROM slug_aliases s LEFT JOIN institutions i ON i.id=s.institution_id WHERE i.id IS NULL`).c;
const badMoved = q(`SELECT COUNT(*) c FROM slug_aliases WHERE moved_to NOT IN (SELECT slug FROM institutions)`).c;
console.log('integrity: orphaned aliases', orphan, '| official_links', orphanOl, '| timeline_events', orphanTe, '| slug_aliases', orphanSlug, '| slug moves w/o live target', badMoved);
if (orphan + orphanOl + orphanTe + orphanSlug + badMoved > 0) { console.error('FAIL: orphaned rows'); process.exit(1); }
const missingSources = q(`SELECT COUNT(*) c FROM institutions WHERE source_id NOT IN (SELECT id FROM sources)`).c;
console.log('integrity: institutions w/o real source', missingSources);
console.log('OK — canonical universe seeded; nothing fabricated.');