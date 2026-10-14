// ============================================================================
// P2-B — canonical Branches builder.
//
// Reads the merged durable evidence store (data/durable/store.db by default)
// and generates the deterministic `src/data/branches.ts` evidence snapshot that
// the public institution pages and `GET /api/institutions/:slug/branches` read
// through lib/repository/projection.ts.
//
// Why this replaces the pilot-DB export as the canonical build
//
//   The old `scripts/pilot-export-branches.ts` reads one pilot run database. No
//   build script ever regenerated the committed module, so it drifted from the
//   evidence (1,331 published rows vs 2,932 in the durable store). The store
//   also carries RAW branch assertions written by the pre-gate parser pass
//   (phase-o): values such as "Branch Manager", "Regional Office", "Head Office"
//   and bare district names ("Morang") sit in `data_assertions` as if they were
//   branch names. This builder applies the committed isAssertableBranchName()
//   plausibility gate at BUILD time, so a repeated heading or a district column
//   read as a name can never reach a published branch, while the value stays
//   untouched in the evidence layer.
//
// Identity is re-keyed too: the store rows are institution-scoped
// (entity_id = the pilot mfi-0NN stub), which would collapse every branch of an
// institution onto one record. Each row is re-keyed with
// branchIdentityKey(institutionId, name) so the projection yields one branch per
// (institution, name), which is exactly what the UNIQUE (institution_id,
// branch_name) contract in schema/schema.sql means.
//
// ASSERTION-ONLY on purpose. The canonical `branches` table requires
// province + district NOT NULL, and the evidence states NEITHER for any MFI
// branch (only branch_name exists). Seeding it would mean fabricating geography,
// so lk.db `branches` / `branch_history` stay at 0 rows and the branch layer is
// published from evidence only. See docs/data/P2-B-BRANCHES-AUDIT.md.
//
// Run: npm run build:branches
// ============================================================================

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { institutions } from "../src/data/institutions";
import { isAssertableBranchNameValue } from "../lib/ingestion/structured";
import { branchIdentityKey } from "../lib/ingestion/branch-records";
import {
  branchesFromAssertionRows,
  type BranchAssertionRecord,
} from "../lib/repository/projection";
import { guardOrExit } from "./guard-env.cjs";

const require = createRequire(import.meta.url);

type Row = Record<string, unknown>;
interface Db {
  prepare(sql: string): { all(...args: unknown[]): Row[] };
  close(): void;
}
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => Db;

/**
 * The merged durable store is the default evidence source. Set `M35_BRANCH_DB`
 * to pin a single evidence database for a reproducible rebuild.
 */
const DB_OVERRIDE = process.env.M35_BRANCH_DB;
const DB_PATH = DB_OVERRIDE ?? join(__dirname, "..", "data", "durable", "store.db");
const OUT_PATH = join(__dirname, "..", "src", "data", "branches.ts");

/** Refuse to publish rows older than the evidence they came from. */
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
      `build:branches — durable store is stale: ${newestFile} is newer than ${dbPath}.\n` +
        `Run \`npm run durable:build\` first, or set M35_BRANCH_DB to a pinned evidence database.`,
    );
    process.exit(1);
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

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

// Canonical institution identity is resolved from the SOURCE, never from the
// pilot `mfi-0NN` entity_id (the pilot and the public registry both number from
// 1 but disagree on rows). Every pilot source is an official MFB website
// carrying the institution's real publisher name, so the join is made on that
// source identity against the public registry. An unresolvable source is dropped
// from the public layer and kept in evidence — nothing is invented.
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

interface OpenBranchConflictLiteral {
  entity_id: string;
  field_name: string;
}

function buildModuleBody(
  branches: (BranchAssertionRecord & { confidence: number | null })[],
  open: OpenBranchConflictLiteral[],
): string {
  return `// Deterministic snapshot generated by scripts/build-branches-module.ts (read-only)
// from the merged durable evidence store (data_assertions + data_conflicts).
// Raw branch evidence rows only — the BranchDto projection lives in
// lib/repository/projection.ts so every adapter means the same thing.
//
// entity_id is the canonical branch identity (branchIdentityKey): the store's
// institution-scoped rows are re-keyed so one branch is not collapsed into one
// branch per institution.
//
// Values that are not plausibly a branch name (isAssertableBranchName gate) and
// assertions whose source identity cannot be resolved against the public
// registry are held in the evidence layer and are NOT published here.
import type { BranchAssertionRecord } from "../../lib/repository/projection";

export const branchAssertions: (BranchAssertionRecord & { confidence: number | null })[] = ${JSON.stringify(branches, null, 2)};

export const openBranchConflicts: { entity_id: string; field_name: string }[] = ${JSON.stringify(open, null, 2)};
`;
}

function uniqueBySourceClaim(rows: (BranchAssertionRecord & { confidence: number | null })[]) {
  // Each source owns at most one current observation per (branch, field, value);
  // keep the latest. Corroboration (distinct source ids for one claim) is
  // preserved because distinct sources remain distinct rows.
  const byKey = new Map<string, BranchAssertionRecord & { confidence: number | null }>();
  for (const r of rows) {
    const key = `${r.entity_id}|${r.field_name}|${r.value}|${r.source_id}`;
    const prev = byKey.get(key);
    if (!prev || r.observed_at > prev.observed_at) byKey.set(key, r);
  }
  return [...byKey.values()];
}

function main(): void {
  // Writes a generated source file; dev-only tooling, never staging/production.
  guardOrExit("build:branches");
  if (!existsSync(DB_PATH)) {
    console.error(
      `build:branches — no evidence store at ${DB_PATH}.\n` +
        `Run \`npm run durable:build\` first, or set M35_BRANCH_DB to a pinned evidence database.`,
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
        WHERE a.entity_type = 'institution' AND a.field_name LIKE 'branch%'
        ORDER BY a.value, a.field_name, a.observed_at`,
    )
    .all() as Row[];

  const droppedSources = new Map<string, number>();
  const droppedUnaddressable = new Map<string, number>();
  const droppedNonBranch = new Map<string, number>();
  let droppedRetiredCount = 0;
  const branches: (BranchAssertionRecord & { confidence: number | null })[] = [];

  for (const r of rows) {
    if (String(r.verification_status) === "REJECTED") continue;
    if (r.valid_to !== null && r.valid_to !== undefined) {
      droppedRetiredCount += 1;
      continue;
    }
    const sourceId = String(r.source_id);
    const inst = resolveInstitution(sourceId);
    if (!inst) {
      droppedSources.set(sourceId, (droppedSources.get(sourceId) ?? 0) + 1);
      continue;
    }
    const value = String(r.value);
    const entityId = branchIdentityKey(inst.id, value);
    // A branch whose name does not normalize to a non-empty identity segment
    // cannot be addressed and must not be published as a nameless row.
    const nameSegment = entityId.split("|")[1] ?? "";
    if (nameSegment.length === 0) {
      const k = `${inst.slug} :: ${value}`;
      droppedUnaddressable.set(k, (droppedUnaddressable.get(k) ?? 0) + 1);
      continue;
    }
    // The frozen value gate: a repeated column heading ("Branch Manager"), a
    // generic section ("Regional Office"), a bare district read as a name
    // ("Morang") or an institution's own registered name is withheld. The row
    // stays in evidence. A real place name with no branch/office marker
    // ("Sijuwa, Morang") is kept, because a `branch_name` row was recorded under
    // a branch-declaring column.
    if (!isAssertableBranchNameValue(value)) {
      const k = `${inst.slug} :: ${value}`;
      droppedNonBranch.set(k, (droppedNonBranch.get(k) ?? 0) + 1);
      continue;
    }
    branches.push({
      entity_id: entityId,
      institution_id: inst.id,
      institution_slug: inst.slug,
      field_name: String(r.field_name),
      value,
      source_id: sourceId,
      source_url: sourceUrlById(sourceId),
      observed_at: String(r.observed_at),
      valid_to: null,
      verification_status: String(r.verification_status),
      confidence: num(r.confidence),
    });
  }

  const deduped = uniqueBySourceClaim(branches);
  deduped.sort(
    (a, b) =>
      a.entity_id.localeCompare(b.entity_id) ||
      a.field_name.localeCompare(b.field_name) ||
      a.observed_at.localeCompare(b.observed_at),
  );

  // Only a genuine CROSS-SOURCE disagreement is a conflict. Same-source rows
  // that normalize to the same branch identity are duplicate observations, not a
  // contradiction. `source_a_id <> source_b_id` is the discriminator.
  const conflictRows = db
    .prepare(
      `SELECT a.entity_id, a.field_name FROM data_conflicts c
         JOIN data_assertions a
           ON a.entity_id = c.entity_id AND a.field_name = c.field_name AND a.source_id = c.source_a_id
        WHERE c.resolution_status = 'OPEN'
          AND c.entity_type = 'institution'
          AND c.field_name LIKE 'branch%'
          AND c.source_a_id <> c.source_b_id
        GROUP BY a.entity_id, a.field_name
        ORDER BY a.entity_id, a.field_name`,
    )
    .all() as Row[];
  const open: OpenBranchConflictLiteral[] = conflictRows.map((r) => ({
    entity_id: String(r.entity_id),
    field_name: String(r.field_name),
  }));
  db.close();

  for (const [sourceId, n] of droppedSources) {
    console.log(`  DROPPED (unresolvable institution identity): ${sourceId} — ${n} assertions kept in evidence, not published`);
  }
  for (const [who, n] of droppedUnaddressable) {
    console.log(`  DROPPED (not individually addressable): ${who} — ${n} assertion(s) kept in evidence`);
  }
  for (const [who, n] of droppedNonBranch) {
    console.log(`  DROPPED (not a branch name — isAssertableBranchName gate): ${who} — ${n} assertion(s) kept in evidence`);
  }
  if (droppedRetiredCount > 0) {
    console.log(`  DROPPED (retired/superseded): ${droppedRetiredCount} assertion(s) kept in evidence`);
  }

  writeFileSync(OUT_PATH, buildModuleBody(deduped, open));

  const projection = branchesFromAssertionRows(
    deduped,
    { openConflictKeys: new Set(open.map((c) => `${c.entity_id}|${c.field_name}`)) },
  );
  const institutionsCovered = new Set(deduped.map((b) => b.institution_id)).size;
  console.log(
    `WROTE ${OUT_PATH}\n` +
      `branch assertions: ${deduped.length}, distinct branches: ${projection.length}, ` +
      `institutions: ${institutionsCovered}, open (cross-source) conflicts: ${open.length} [store=${DB_PATH}]\n` +
      `ASSERTION-ONLY: lk.db branches/branch_history are NOT seeded (no province/district in evidence).`,
  );
}

main();