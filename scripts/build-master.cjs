// Generates canonical master data TS files under data/master/ from the old
// senna-mfi-db exports (institutions_dump.json, aliases_dump.json,
// source_registry_dump.json). Selective import only — every row carries the
// source id it was verified against (nrb-bfi-mid-may-2026).
//
// DISCIPLINE (docs/OPERATIONS.md): one-time/ongoing migration tooling that
// reads an external dump dir and WRITES data/master/*. Local-only — blocked
// whenever LK_ENV=staging|production (no test rows in prod, no read of prod
// data into a dev snapshot).
const { guardOrExit } = require('./guard-env.cjs');
guardOrExit('scripts/build-master.cjs');

const fs = require('fs');
const path = require('path');
const os = require('os');
const stripBom = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const T = process.env.LK_DUMP_DIR || path.join(os.tmpdir(), 'opencode');
const inst = JSON.parse(stripBom(T + 'institutions_dump.json'))[0].results;
const aliases = JSON.parse(stripBom(T + 'aliases_dump.json'))[0].results;
const registry = JSON.parse(stripBom(T + 'source_registry_dump.json'))[0].results;

const NATIONS_SOURCE = 'nrb-bfi-mid-may-2026';
const parse = (r) => { try { return JSON.parse(r.payload_json); } catch (e) { return {}; } };

const current = inst.filter(r => r.kind === 'current').map(r => ({ ...r, payload: parse(r) }));
const historical = inst.filter(r => r.kind === 'historical').map(r => ({ ...r, payload: parse(r) }));

// ---------- SOURCES ----------
// The NRB BFI list (grade A, scope NRB) backs identity for all current MFBs.
// Registry sources carry through with scope inference. Description em-dashes
// were mojibake'd by PowerShell dumps; translate back before splitting.
const scopeOf = (s) => {
  if (s.id.startsWith('nrb-')) return 'NRB';
  if (s.source_type === 'evidence' && s.institution_id) return 'INSTITUTION';
  return 'GENERAL';
};
const publisherOf = (s) => {
  if (s.id.startsWith('nrb-')) return 'Nepal Rastra Bank';
  const parent = current.find(c => c.id === s.institution_id);
  return parent ? parent.name : 'MFB website';
};
const cleanNotes = (notes) => (notes || '').replace(/ΓÇö/g, '—').replace(/\s*—.*$/, '').trim();
// Legacy registry has a genuine duplicate: nrb-mfi-quarterly + nrb-quarterly-situation
// share the same URL, and sources.url is UNIQUE in the canonical DB. Neither is
// referenced by any institution/fieldEvidence, so keep the semantically correct
// sector-analysis id and drop the duplicate deterministically.
const URL_KEEP = { 'https://www.nrb.org.np/category/quarterly-situation-of-mfis/': 'nrb-quarterly-situation' };
const keepSource = (seen, s) => {
  const keepId = URL_KEEP[s.source_url];
  if (keepId === s.id) return true;
  if (keepId && seen.has(s.source_url)) return false;
  seen.add(s.source_url);
  return !keepId;
};
const seen = new Set();
const sources = registry.filter(s => keepSource(seen, s)).map(s => ({
  id: s.id,
  source_type: s.source_type === 'evidence' ? 'MFB_WEBSITE' : 'NRB',
  source_scope: scopeOf(s),
  source_grade: s.grade,
  url: s.source_url,
  domain: new URL(s.source_url).hostname,
  title: cleanNotes(s.notes) || s.id,
  publisher: publisherOf(s),
  is_active: s.active,
}));;

// ---------- INSTITUTIONS ----------
const typeOf = (wa) => (wa && wa.includes('National')) ? 'NATIONAL' : 'PROVINCIAL';
const statusOf = (kind, st) => {
  if (kind === 'historical') {
    if (st === 'merged') return 'MERGED';
    if (st === 'acquired') return 'ACQUIRED';
    if (st === 'renamed') return 'RENAMED';
    return 'INACTIVE';
  }
  return 'ACTIVE';
};
const ev = (c, f) => (c.payload.fieldEvidence && c.payload.fieldEvidence[f]) || null;

const establishedOf = (opDate) => {
  if (!opDate) return null;
  const y = parseInt(opDate.slice(0, 4), 10);
  return Number.isFinite(y) && y >= 1990 && y <= new Date().getFullYear() ? y : null;
};

const institutions = current.map(c => ({
  id: c.id,
  slug: c.slug,
  name_en: c.name,
  name_np: null,
  short_name: (c.payload.aliases && c.payload.aliases[0]) || c.name,
  institution_type: typeOf(c.payload.workingArea),
  status: 'ACTIVE',
  registration_number: null,
  nrb_license_number: null,
  nrb_class: c.payload.licenseClass || 'D',
  operation_date: (c.payload.operationDate && establishedOf(c.payload.operationDate)) ? c.payload.operationDate : null,
  head_office_district: c.payload.headOffice ? c.payload.headOffice.split(',')[1]?.trim() : null,
  head_office_municipality: c.payload.headOffice ? c.payload.headOffice.split(',')[0]?.trim() : null,
  head_office_address: c.payload.headOffice || null,
  working_area: c.payload.workingArea || null,
  official_website: c.payload.officialWebsite || null,
  official_email: null,
  official_phone: null,
  logo_url: null,
  established: establishedOf(c.payload.operationDate),
  listed: 0,
  source_id: NATIONS_SOURCE,
  last_verified_at: ev(c, 'identity')?.verifiedOn || '2026-06-20',
  next_review_at: '2026-12-20',
  source_grade_identity: ev(c, 'identity')?.grade || 'C',
}));

// ---------- ALIASES ----------
// Canon: old aliases table is authoritative, BUT only for institutions we
// import (51 current). 72 aliases point at hist-* predecessors which are NOT
// institution rows (they live as timeline_events) — excluded, FK-safety.
// Legacy has case-variant duplicates (WEAN Nepal / Wean Nepal): prefer the
// variant with the MOST capital letters, drop the rest. All map to NAME_ALT
// for now; tickers land later via NEPSE (institution_symbols is separate).
const importedIds = new Set(current.map(c => c.id));
const scoreAlias = (a) => (a.match(/[A-Z]/g) || []).length;
const aliasesDedup = new Map(); // key: inst|lower
for (const a of aliases) {
  if (!importedIds.has(a.institution_id)) continue;
  const key = `${a.institution_id}|${a.alias.toLowerCase()}`;
  const prev = aliasesDedup.get(key);
  if (!prev || scoreAlias(a.alias) > scoreAlias(prev.alias)) aliasesDedup.set(key, a);
}
const aliasesOut = [...aliasesDedup.values()].map(a => ({
  institution_id: a.institution_id,
  alias: a.alias.trim(),
  normalized_alias: a.normalized_alias || a.alias.toLowerCase(),
  alias_type: 'NAME_ALT',
  source_grade: a.source_grade || 'C',
}));
aliasesOut.sort((x, y) => x.institution_id.localeCompare(y.institution_id));

// ---------- OFFICIAL LINKS (first-class; nothing trusted until verified=1) ----------
const officialLinks = current
  .filter(c => c.payload.officialWebsite)
  .map(c => ({
    institution_id: c.id,
    link_type: 'WEBSITE',
    label: `${c.name} — official website`,
    url: c.payload.officialWebsite,
    canonical_url: null,
    verified: c.payload.websiteStatus === 'verified' ? 1 : 0,
    verified_at: c.payload.websiteStatus === 'verified' ? '2026-06-20' : null,
    status: c.payload.websiteStatus === 'verified' ? 'VERIFIED' : 'CANDIDATE',
    source_id: NATIONS_SOURCE,
    last_checked_at: '2026-06-20',
  }));

// ---------- TIMELINE EVENTS (63 historical) ----------
// occurred_at: only fill when the old payload held a real date (it usually
// holds a verifiedThroughEvent id or a firstSeenSource URL instead — those
// are NOT dates, so occurred_at stays null; the URL goes in summary as evidence).
const asDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(v)) ? v : null;
const evidenceOf = (p) => {
  const ev = p.verifiedThroughEvent || p.firstSeenSource;
  return ev && !asDate(ev) ? ` Evidence: ${ev}` : '';
};
// FK-safety: resolve successor chains. The legacy DB sometimes points a
// predecessor's successor at another HISTORICAL row (Nepal Sewa → WEAN →
// mfi-026); walk forward until a CURRENT institution (importedId) is reached.
// Events with no resolvable current successor are dropped rather than guessed.
const byId = new Map(inst.map(i => [i.id, i]));
const resolveSuccessor = (h) => {
  let seen = new Set();
  let cur = h;
  while (cur.successor_id || (cur.payload && cur.payload.successorId)) {
    if (seen.has(cur.id)) return null; // cycle guard
    seen.add(cur.id);
    const next = cur.successor_id || cur.payload.successorId;
    const target = byId.get(next);
    if (!target) return null;
    if (importedIds.has(target.id)) return target.id; // current MFB
    cur = target; // historical intermediate → keep walking
  }
  return null;
};
const timeline = historical
  .map(h => ({ target: resolveSuccessor(h), h }))
  .filter(({ target }) => target)
  .map(({ target, h }) => ({
  institution_id: target,
  event_type: h.status === 'merged' ? 'MERGED' : h.status === 'acquired' ? 'ACQUIRED' : h.status === 'renamed' ? 'RENAMED' : 'LICENSED',
  title: h.name,
  occurred_at: asDate(h.payload.verifiedThroughEvent) || asDate(h.payload.firstSeenSource) || null,
  summary: ((h.payload.summary || `Predecessor merged/renamed into ${target}.`) + evidenceOf(h.payload)).trim(),
  source_id: NATIONS_SOURCE,
  predecessor_id: h.id,
  predecessor_name: h.name,
}));

// ---------- PAGES ----------
const esc = (s) => JSON.stringify(s ?? null).replace(/</g, '\\u003c');
const rows = (arr, keys) => arr.map(o =>
  '  { ' + keys.map((k, i) => `${k}: ${esc(o[keys[i]])}`).join(', ') + ' }'
).join(',\n');

const header = `// =============================================================================
// data/master/*.ts — GENERATED canonical master data (do not edit by hand).
// Regenerate: node scripts/build-master.cjs  (transforms old senna-mfi-db export)
// Governance: selective import only; every row carries source_id the fact was
// verified against (identity = nrb-bfi-mid-may-2026, NRB BFI list, grade A).
// Master sources of truth: docs/DATABASE-SPEC.md + migrations/*.sql.
// =============================================================================\n`;

const IKEYS = ['id','slug','name_en','name_np','short_name','institution_type','status','registration_number','nrb_license_number','nrb_class','operation_date','head_office_district','head_office_municipality','head_office_address','working_area','official_website','official_email','official_phone','logo_url','established','listed','source_id','last_verified_at','next_review_at'];

let out = header;
out += `\nimport type { MasterInstitution, MasterAlias, MasterOfficialLink, MasterTimelineEvent, MasterSource, MasterUniverseSnapshot } from "./types";\n\n`;
out += `/**\n`;
out += ` * MASTER UNIVERSE SNAPSHOT — an observation of the Class-D MFB universe, not a\n`;
out += ` * permanent count. Refresh from NRB periodically; never delete merged/history rows.\n`;
out += ` */\n`;
out += `export const universeSnapshot: MasterUniverseSnapshot = {\n`;
out += `  source_id: "nrb-bfi-mid-may-2026",\n`;
out += `  title: "NRB BFI list (English, mid-May 2026)",\n`;
out += `  observed_at: "2026-06-20",\n`;
out += `  counts: { institutions: ${institutions.length}, aliases: ${aliasesOut.length}, official_links: ${officialLinks.length}, timeline: ${timeline.length}, sources: ${sources.length} },\n`;
out += `};\n\n`;
out += `/** 51 current licensed Class-D MFBs observed on the NRB BFI list (mid-May 2026). */\n`;
out += `export const institutions: MasterInstitution[] = [\n${rows(institutions, IKEYS)}\n];\n\n`;
out += `/** ${aliasesOut.length} aliases (name variants) for the 51 imported institutions, deduped + FK-safe. */\n`;
out += `export const aliases: MasterAlias[] = [\n${rows(aliasesOut, ['institution_id','alias','normalized_alias','alias_type','source_grade'])}\n];\n\n`;
out += `/** ${officialLinks.length} official-website links. Nothing trusted until verified=1. */\n`;
out += `export const officialLinks: MasterOfficialLink[] = [\n${rows(officialLinks, ['institution_id','link_type','label','url','canonical_url','verified','verified_at','status','source_id','last_checked_at'])}\n];\n\n`;
out += `/** ${timeline.length} historical predecessor events (MERGE/ACQUIRE/RENAME). */\n`;
out += `export const timelineEvents: MasterTimelineEvent[] = [\n${rows(timeline, ['institution_id','event_type','title','occurred_at','summary','source_id','predecessor_id','predecessor_name'])}\n];\n\n`;
out += `/** ${sources.length} evidence sources behind the master data (from old source_registry). */\n`;
out += `export const sources: MasterSource[] = [\n${rows(sources, ['id','source_type','source_scope','source_grade','url','domain','title','publisher','is_active'])}\n];\n`;

const dir = path.join(__dirname, '..', 'data', 'master');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(dir + '/index.generated.ts', out, 'utf8');
// also emit a JSON sidecar for Node-side seed (scripts/seed.cjs) to consume
fs.writeFileSync(dir + '/master.json', JSON.stringify({
  universeSnapshot: {
    source_id: 'nrb-bfi-mid-may-2026',
    title: 'NRB BFI list (English, mid-May 2026)',
    observed_at: '2026-06-20',
    counts: { institutions: institutions.length, aliases: aliasesOut.length, official_links: officialLinks.length, timeline: timeline.length, sources: sources.length },
  },
  institutions, aliases: aliasesOut, officialLinks, timeline, sources,
}, null, 2), 'utf8');
console.log('institutions:', institutions.length, '| aliases:', aliasesOut.length, '| officialLinks:', officialLinks.length, '| timeline:', timeline.length, '| sources:', sources.length);
console.log('written data/master/index.generated.ts + master.json');