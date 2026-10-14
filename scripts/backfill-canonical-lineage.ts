import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
const Database = require("better-sqlite3");

const ROOT = resolve(__dirname, "..");
const STORE = join(ROOT, "data/durable/store.db");
const MASTER = join(ROOT, "data/master/master.json");
const SLUG = join(ROOT, "data/master/canonical-slug-aliases.json");
const FORMER = join(ROOT, "data/master/canonical-former-aliases.json");

if (!existsSync(STORE) || !existsSync(SLUG) || !existsSync(FORMER) || !existsSync(MASTER)) process.exit(1);

type SlugRow = { old_slug: string; moved_to: string; institution_id: string };
type FormerRow = { institution_id: string; alias: string; alias_type?: string; source_id?: string };

const slug = JSON.parse(readFileSync(SLUG, "utf8")) as { rows: SlugRow[] };
const former = JSON.parse(readFileSync(FORMER, "utf8")) as { rows: FormerRow[] };
const master = JSON.parse(readFileSync(MASTER, "utf8")) as { sources: MasterSource[] };
const db = new Database(STORE);

const apply = process.argv.includes("--apply");
const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
// Fixed seed timestamp, not `now()`: the durable store must stay byte-identical
// across rebuilds (see docs/data/DURABLE-RUN-MODEL.md).
const SEEDED_AT = "2026-09-24T12:00:00.000Z";

/**
 * The canonical lineage JSON references the NRB master source (`source_id`), but
 * the durable store is built from the 13 evidence databases and does not register
 * the NRB BFI list as a source. Without it, `institution_aliases.source_id` fails
 * its FK to `sources(id)`. Register the referenced master sources first so the
 * backfill can run under `PRAGMA foreign_keys = ON` instead of disabling it.
 */
type MasterSource = {
  id: string; source_type: string; source_scope: string; source_grade: string;
  url: string; domain: string; title: string; publisher: string; is_active: number;
};
const neededSources = new Set(
  former.rows.map((r) => r.source_id).filter((id): id is string => Boolean(id)),
);
const masterSources = new Map<string, MasterSource>(master.sources.map((s) => [s.id, s]));
const missing = [...neededSources].filter((id) => !db.prepare("SELECT 1 FROM sources WHERE id=?").get(id));
let sourcesInserted = 0;
if (apply) {
  const st = db.prepare(
    "INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  for (const id of missing) {
    const s = masterSources.get(id);
    if (!s) continue;
    const info = st.run(id, s.source_type, s.source_scope, s.source_grade, s.url, s.domain, s.title, s.publisher, s.is_active, SEEDED_AT);
    if (info.changes === 1) sourcesInserted++;
  }
} else {
  sourcesInserted = missing.filter((id) => masterSources.has(id)).length;
}
console.log(apply ? "applied sources" : "dry sources", { insert: sourcesInserted, skip: neededSources.size - missing.length, missing: missing.length });

let insSlug = 0, skipSlug = 0;
if (apply) {
  const st = db.prepare("INSERT OR IGNORE INTO slug_aliases (id, institution_id, old_slug, moved_to, created_at) VALUES (?,?,?,?,?)");
  for (const r of slug.rows) {
    const info = st.run(`sa-${r.old_slug}`, r.institution_id, r.old_slug, r.moved_to, SEEDED_AT);
    if (info.changes === 1) insSlug++; else skipSlug++;
  }
} else {
  const q = db.prepare("SELECT 1 FROM slug_aliases WHERE old_slug=?");
  for (const r of slug.rows) {
    if (q.get(r.old_slug)) skipSlug++; else insSlug++;
  }
}
console.log(apply ? "applied slug" : "dry slug", { insert: insSlug, skip: skipSlug });

let insF = 0, skipF = 0;
if (apply) {
  const st = db.prepare("INSERT OR IGNORE INTO institution_aliases (id, institution_id, alias, alias_type, is_active, source_id, last_verified_at) VALUES (?,?,?,?,?,?,?)");
  for (const r of former.rows) {
    const info = st.run(`al-${r.institution_id}-former-${norm(r.alias)}`, r.institution_id, r.alias, r.alias_type || "FORMER", 1, r.source_id || "nrb-bfi-mid-may-2026", SEEDED_AT);
    if (info.changes === 1) insF++; else skipF++;
  }
} else {
  const q = db.prepare("SELECT 1 FROM institution_aliases WHERE institution_id=? AND lower(alias)=lower(?) AND alias_type='FORMER'");
  for (const r of former.rows) {
    if (q.get(r.institution_id, r.alias)) skipF++; else insF++;
  }
}
console.log(apply ? "applied former" : "dry former", { insert: insF, skip: skipF });

db.close();