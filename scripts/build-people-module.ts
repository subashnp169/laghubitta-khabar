// ============================================================================
// P2-A — canonical People + Positions builder.
//
// Reads the merged durable evidence store (data/durable/store.db by default)
// and generates the deterministic `src/data/people.ts` evidence snapshot that the
// public /people pages and `GET /api/people/*` read through
// lib/repository/projection.ts. It then materialises the same projection as the
// canonical `people` + `positions` tables in lk.db (P1 pattern: lk.db is derived,
// never authoritative).
//
// Why this replaces the pilot-DB export as the canonical build
//
//   The old `scripts/pilot-export-people.ts` reads one pilot run database. No
//   build script ever regenerated the committed module, so it drifted from the
//   evidence. Worse, the durable store carries RAW people assertions written by
//   older parser passes (people-html-v1 and the external table path) that the v2
//   extractor's plausibility gate never saw: values such as "Divisional Manager",
//   "Head Of Finance Department", "Microfinance Department" and "Nepal Rastra
//   Bank" sit in `data_assertions` as if they were people. This builder applies
//   the committed nameLike() plausibility gate at BUILD time, so no navigation
//   label, job title or organisation name can ever reach a published person,
//   while the value stays untouched in the evidence layer.
//
// It is NOT a second people model: it produces exactly the two artefacts the
// project already had — the generated evidence module and the canonical store
// rows — under the SAME projection (lib/repository/projection.ts) every adapter
// already means.
//
// Run: npm run build:people
// ============================================================================

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { institutions } from "../src/data/institutions";
import {
  nameLike,
  STAFF_DIRECTORY_MIN_ENTRIES,
  STAFF_DIRECTORY_MAX_LEADERSHIP_RATIO,
} from "../lib/ingestion/people";
import {
  peopleFromAssertionRows,
  type PersonAssertionRecord,
} from "../lib/repository/projection";
import type { PersonDto } from "../lib/repository/types";
import { guardOrExit } from "./guard-env.cjs";

const require = createRequire(import.meta.url);

type Row = Record<string, unknown>;
interface Db {
  prepare(sql: string): { all(...args: unknown[]): Row[]; run(...args: unknown[]): unknown };
  exec(sql: string): unknown;
  transaction<T>(fn: () => T): () => T;
  pragma(sql: string): unknown;
  close(): void;
}
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => Db;

/**
 * The merged durable store is the default evidence source. Set `M35_PEOPLE_DB`
 * to pin a single evidence database for a reproducible rebuild.
 */
const DB_OVERRIDE = process.env.M35_PEOPLE_DB;
const DB_PATH = DB_OVERRIDE ?? join(__dirname, "..", "data", "durable", "store.db");
const OUT_PATH = join(__dirname, "..", "src", "data", "people.ts");
const LK_DB_PATH = join(__dirname, "..", "lk.db");

/**
 * Refuse to publish rows older than the evidence they came from: if any
 * evidence database is newer than the store, name the fix instead.
 */
function assertStoreFresh(dbPath: string): void {
  const dir = join(__dirname, "..", "data", "pilot", "evidence");
  if (!existsSync(dir)) return;
  let newest = 0;
  let newestFile = "";
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".db")) continue;
    const m = statSync(join(dir, f)).mtimeMs;
    if (m > newest) {
      newest = m;
      newestFile = f;
    }
  }
  if (newest > statSync(dbPath).mtimeMs) {
    console.error(
      `build:people — durable store is stale: ${newestFile} is newer than ${dbPath}.\n` +
        `Run \`npm run durable:build\` first, or set M35_PEOPLE_DB to a pinned evidence database.`,
    );
    process.exit(1);
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The name half of a person slug — byte-identical to personSlug()'s segment. */
function nameSlugSegment(name: string): string {
  return name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Institution-only identity key for publisher/alias matching. */
function identityKey(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\blimited\b/g, "ltd")
    .replace(/\b(ltd|co|company|pvt|private)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface PilotSource {
  id: string;
  institution_id: string;
  url?: string | null;
  publisher?: string;
  domain?: string;
}

// ---------------------------------------------------------------------------
// Canonical institution identity is resolved from the SOURCE, never from the
// pilot `mfi-0NN` entity_id: the pilot and the public registry both number from
// 1 but disagree on rows (pilot mfi-045 = Swastik; public mfi-045 = Nyadi), so
// entity_id is not a safe join key. Every pilot source is an official MFB
// website carrying the institution's real publisher name, so the join is made on
// that source identity against the public registry. An unresolvable source is
// dropped from the public layer and kept in evidence — nothing is invented.
// ---------------------------------------------------------------------------
const pilotSourcesPath = join(__dirname, "..", "data", "pilot", "pilot-sources.json");
const pilotSources: PilotSource[] = existsSync(pilotSourcesPath)
  ? ((JSON.parse(readFileSync(pilotSourcesPath, "utf8")) as { sources?: PilotSource[] }).sources ?? [])
  : [];

function resolveInstitution(sourceId: string): (typeof institutions)[number] | undefined {
  const src = pilotSources.find((s) => s.id === sourceId);
  if (!src?.publisher) return undefined;
  const key = identityKey(src.publisher);
  const exact = institutions.filter((i) => identityKey(i.name) === key);
  const viaAlias = institutions.filter((i) => (i.aliases ?? []).some((a) => identityKey(a) === key));
  const cands = exact.length ? exact : viaAlias;
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    const host = String(src.domain ?? "").replace(/^www\./, "").toLowerCase();
    const byHost = cands.filter((i) => {
      if (!i.officialWebsite) return false;
      try {
        return new URL(i.officialWebsite).hostname.replace(/^www\./, "").toLowerCase() === host;
      } catch {
        return false;
      }
    });
    if (byHost.length === 1) return byHost[0];
  }
  return undefined;
}

function sourceUrlById(sourceId: string): string | null {
  const src = pilotSources.find((s) => s.id === sourceId);
  if (!src?.url) return null;
  const url = String(src.url);
  return /^https?:\/\//.test(url) ? url : null;
}

interface OpenConflictLiteral {
  institution_id: string;
  field_name: string;
}

function buildModuleBody(people: (PersonAssertionRecord & { confidence: number | null })[], open: OpenConflictLiteral[]): string {
  return `// Deterministic snapshot generated by scripts/build-people-module.ts (read-only)
// from the merged durable evidence store (data_assertions + data_conflicts).
// Raw people evidence rows only — the PersonDto projection lives in
// lib/repository/projection.ts so every adapter means the same thing.
//
// Values that are not plausibly a person (nameLike gate) and assertions whose
// source identity cannot be resolved against the public registry are held in the
// evidence layer and are NOT published here.
import type { PersonAssertionRecord } from "../../lib/repository/projection";

export const peopleAssertions: (PersonAssertionRecord & { confidence: number | null })[] = ${JSON.stringify(people, null, 2)};

export const openPeopleConflicts: { institution_id: string; field_name: string }[] = ${JSON.stringify(open, null, 2)};
`;
}

/** Tier by most-senior position held (1 chair/ceo, 2 director, 3 board). */
function tierForPositions(positions: PersonDto["positions"]): number {
  const tiers = positions.map((p) => {
    const t = p.title.toLowerCase();
    if (t.includes("chair") || t.includes("chief executive")) return 1;
    if (t.includes("director")) return 2;
    return 3;
  });
  return tiers.length ? Math.min(...tiers) : 1;
}

/**
 * Materialise the canonical `people` + `positions` rows in lk.db. lk.db is a
 * DERIVED store (seeded by scripts/seed.cjs), so this is a full replace of the
 * two tables rather than an incremental merge; evidence remains the durable
 * store. Rows whose source is absent from lk.db are skipped and reported rather
 * than inserted against a fabricated source.
 */
function seedCanonicalStore(people: PersonDto[]): void {
  if (!existsSync(LK_DB_PATH)) {
    console.log("build:people — lk.db not found; skipped canonical people/positions seed (run `npm run seed`).");
    return;
  }
  const db = new Database(LK_DB_PATH);
  db.pragma("foreign_keys = ON");
  const known = new Set(
    (db.prepare("SELECT id FROM sources").all() as Row[]).map((r) => String(r.id)),
  );
  let peopleRows = 0;
  let positionRows = 0;
  let skippedSource = 0;
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.exec("DELETE FROM positions");
    db.exec("DELETE FROM people");
    const insPerson = db.prepare(
      `INSERT INTO people (id, slug, name_en, name_np, tier, source_id, last_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    );
    const insPos = db.prepare(
      `INSERT INTO positions (id, person_id, institution_id, role, tier, committee, appointed_at, ended_at, is_current, source_id, last_verified_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?)`,
    );
    for (const p of people) {
      if (!known.has(p.meta.source)) {
        skippedSource++;
        continue;
      }
      insPerson.run(p.id, p.slug, p.name, tierForPositions(p.positions), p.meta.source, p.meta.last_verified_at, now, now);
      peopleRows++;
      for (const pos of p.positions) {
        const posId = `pos-${p.id}-${nameSlugSegment(pos.title)}`;
        insPos.run(posId, p.id, p.institution_id, pos.title, tierForPositions([pos]), p.meta.source, p.meta.last_verified_at);
        positionRows++;
      }
    }
  });
  tx();
  db.close();
  console.log(
    `build:people — seeded lk.db: ${peopleRows} people, ${positionRows} positions` +
      (skippedSource ? `, ${skippedSource} person(s) skipped (source not in lk.db)` : ""),
  );
}

function uniqueBySourceClaim(rows: (PersonAssertionRecord & { confidence: number | null })[]) {
  // Each source owns at most one current observation per (institution, field,
  // value); keep the latest. Corroboration (distinct source ids for one claim)
  // is preserved because distinct sources remain distinct rows.
  const byKey = new Map<string, PersonAssertionRecord & { confidence: number | null }>();
  for (const r of rows) {
    const key = `${r.institution_id}|${r.field_name}|${r.value}|${r.source_id}`;
    const prev = byKey.get(key);
    if (!prev || r.observed_at > prev.observed_at) byKey.set(key, r);
  }
  return [...byKey.values()];
}

function main(): void {
  // The canonical-store seed replaces the two derived people tables, so this is
  // dev-only tooling and must never run against staging/production.
  guardOrExit("build:people");
  if (!existsSync(DB_PATH)) {
    console.error(
      `build:people — no evidence store at ${DB_PATH}.\n` +
        `Run \`npm run durable:build\` first, or set M35_PEOPLE_DB to a pinned evidence database.`,
    );
    writeFileSync(OUT_PATH, buildModuleBody([], []));
    process.exit(1);
  }
  if (!DB_OVERRIDE) assertStoreFresh(DB_PATH);

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT a.entity_id, a.source_id, a.field_name, a.value, a.observed_at, a.valid_to, a.verification_status, a.confidence
         FROM data_assertions a
        WHERE a.entity_type = 'institution' AND a.field_name LIKE 'people_%'
        ORDER BY a.value, a.field_name, a.observed_at`,
    )
    .all() as Row[];

  // -------------------------------------------------------------------------
  // Staff-directory gate (build-time application of the frozen extraction rule).
  //
  // The durable store also carries RAW people assertions from older parser
  // passes that never ran the v2 staff-directory classification, so a page that
  // enumerates employees arrives labelled `people_board`. National Laghubitta's
  // 2026-09-27 snapshot alone contributes 199 such names at uniform confidence
  // 0.55 — a staff roster, not a board. Publishing them would be exactly the
  // bulk over-promotion P2-A forbids.
  //
  // The same thresholds the extractor uses (STAFF_DIRECTORY_MIN_ENTRIES and
  // STAFF_DIRECTORY_MAX_LEADERSHIP_RATIO) are applied per observed page: an
  // entry is "leadership" when its field is chair/CEO/director and generic when
  // it is people_board. A large page whose entries are overwhelmingly generic is
  // a directory; its rows stay in evidence and are not promoted. This is the
  // single classification definition, reused — not a second model.
  // -------------------------------------------------------------------------
  const LEADERSHIP_FIELDS = new Set(["people_chair", "people_ceo", "people_director"]);
  const pageGroups = new Map<string, { n: number; lead: number }>();
  for (const r of rows) {
    if (String(r.verification_status) === "REJECTED") continue;
    if (r.valid_to !== null && r.valid_to !== undefined) continue;
    const key = `${String(r.source_id)}|${String(r.observed_at)}`;
    const g = pageGroups.get(key) ?? { n: 0, lead: 0 };
    g.n += 1;
    if (LEADERSHIP_FIELDS.has(String(r.field_name))) g.lead += 1;
    pageGroups.set(key, g);
  }
  const directoryPages = new Set<string>();
  for (const [key, g] of pageGroups) {
    if (g.n >= STAFF_DIRECTORY_MIN_ENTRIES && g.lead / g.n < STAFF_DIRECTORY_MAX_LEADERSHIP_RATIO) {
      directoryPages.add(key);
    }
  }

  const people: (PersonAssertionRecord & { confidence: number | null })[] = [];
  const droppedSources = new Map<string, number>();
  const droppedUnaddressable = new Map<string, number>();
  const droppedNonPerson = new Map<string, number>();
  const droppedRetired = new Map<string, number>();
  const droppedDirectory = new Map<string, number>();
  for (const r of rows) {
    if (String(r.verification_status) === "REJECTED") continue;
    if (r.valid_to !== null && r.valid_to !== undefined) {
      const k = String(r.source_id);
      droppedRetired.set(k, (droppedRetired.get(k) ?? 0) + 1);
      continue;
    }
    const sourceId = String(r.source_id);
    const pageKey = `${sourceId}|${String(r.observed_at)}`;
    if (directoryPages.has(pageKey)) {
      droppedDirectory.set(pageKey, (droppedDirectory.get(pageKey) ?? 0) + 1);
      continue;
    }
    const inst = resolveInstitution(sourceId);
    if (!inst) {
      droppedSources.set(sourceId, (droppedSources.get(sourceId) ?? 0) + 1);
      continue;
    }
    // A public person must be individually addressable. A value written entirely
    // in a non-Latin script (the mathematical-bold Unicode block some Nepali
    // sites use) yields an empty slug segment and would collapse onto one id.
    if (!nameSlugSegment(String(r.value))) {
      const k = `${inst.slug} :: ${String(r.value)}`;
      droppedUnaddressable.set(k, (droppedUnaddressable.get(k) ?? 0) + 1);
      continue;
    }
    // The frozen plausibility gate: a run of name tokens with no organisation,
    // job-title, document or site-furniture vocabulary. This is what keeps
    // "Divisional Manager", "Head of IT Department" and "Nepal Rastra Bank" out.
    if (!nameLike(String(r.value))) {
      const k = `${inst.slug} :: ${String(r.value)} (${String(r.field_name)})`;
      droppedNonPerson.set(k, (droppedNonPerson.get(k) ?? 0) + 1);
      continue;
    }
    people.push({
      institution_id: inst.id,
      institution_slug: inst.slug,
      institution_name: inst.name,
      field_name: String(r.field_name),
      value: String(r.value),
      source_id: sourceId,
      source_url: sourceUrlById(sourceId),
      observed_at: String(r.observed_at),
      verification_status: String(r.verification_status),
      confidence: num(r.confidence),
    });
  }

  const deduped = uniqueBySourceClaim(people);
  deduped.sort(
    (a, b) =>
      a.institution_slug.localeCompare(b.institution_slug) ||
      a.value.localeCompare(b.value) ||
      a.field_name.localeCompare(b.field_name) ||
      a.observed_at.localeCompare(b.observed_at),
  );

  // Only a genuine CROSS-SOURCE disagreement is a conflict. A single source
  // listing several names under one role heading is a multi-holder role, not a
  // contradiction. `source_a_id <> source_b_id` is the discriminator.
  const conflictRows = db
    .prepare(
      `SELECT a.source_id, a.field_name FROM data_conflicts c
         JOIN data_assertions a
           ON a.entity_id = c.entity_id AND a.field_name = c.field_name AND a.source_id = c.source_a_id
        WHERE c.resolution_status = 'OPEN'
          AND c.entity_type = 'institution'
          AND c.field_name LIKE 'people_%'
          AND c.source_a_id <> c.source_b_id
        GROUP BY a.source_id, a.field_name
        ORDER BY a.source_id, a.field_name`,
    )
    .all() as Row[];
  const open: OpenConflictLiteral[] = conflictRows
    .map((r) => {
      const inst = resolveInstitution(String(r.source_id));
      return inst ? { institution_id: inst.id, field_name: String(r.field_name) } : undefined;
    })
    .filter((x): x is OpenConflictLiteral => x !== undefined);
  db.close();

for (const [page, n] of droppedDirectory) {
    console.log(`  DROPPED (staff directory — held in evidence, not promoted as leadership): ${page} — ${n} assertion(s)`);
  }
  for (const [sourceId, n] of droppedSources) {
    console.log(`  DROPPED (unresolvable institution identity): ${sourceId} — ${n} assertions kept in evidence, not published`);
  }
  for (const [who, n] of droppedUnaddressable) {
    console.log(`  DROPPED (not individually addressable): ${who} — ${n} assertion(s) kept in evidence`);
  }
  for (const [who, n] of droppedNonPerson) {
    console.log(`  DROPPED (not a person — nameLike gate): ${who} — ${n} assertion(s) kept in evidence`);
  }

  writeFileSync(OUT_PATH, buildModuleBody(deduped, open));

  const projection = peopleFromAssertionRows(
    deduped,
    { openConflictKeys: new Set(open.map((c) => `${c.institution_id}|${c.field_name}`)) },
  );
  seedCanonicalStore(projection);

  const institutionsCovered = new Set(deduped.map((p) => p.institution_id)).size;
  console.log(
    `WROTE ${OUT_PATH}\n` +
      `people assertions: ${deduped.length}, distinct people: ${projection.length}, ` +
      `institutions: ${institutionsCovered}, open (cross-source) conflicts: ${open.length} [store=${DB_PATH}]`,
  );
}

main();