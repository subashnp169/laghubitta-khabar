// ============================================================================
// Branch evidence snapshot generator (M3.4) — reads a pilot-branches run DB
// (read-only) and emits a deterministic `src/data/branches.ts` module: the raw
// branch-name evidence rows (data_assertions with field_name LIKE 'branch%')
// plus the OPEN branch conflicts, so the static site + B2B API can project
// BranchDtos (lib/repository/projection.ts) without touching D1.
//
//   npm run pilot:export:branches -- <absolute-or-relative-db-path>
//   env LK_PILOT_DB=path npm run pilot:export:branches
//
// Falls back to data/pilot/pilot-branches-report.json for dbPath. READ-ONLY: no
// DDL, no writes to the source DB. Emits an empty (honest) module when the DB
// has no branch evidence yet — the API then reports 0 branches, never a guess.
//
// Entity identity: the pilot engine writes branch_name assertions scoped to the
// institution (entity_id = the pilot stub institution). The public read model
// groups branches by entity_id to make one BranchDto per branch, so this exporter
// re-keys every row to branchIdentityKey(institutionId, name) —
// `<institution>|<normalized name>|<geo>`, with geo "-" because M3.3/M3.4 branch
// attributes are deliberately evidence-only and never assert. Two observations
// that normalize to the same key are the same branch; they merge in the module
// so the projection cannot invent a duplicate branch from spelling noise.
//
// Institution identity is resolved from the SOURCE (its official MFB website
// identity, carried in data/pilot/pilot-sources.json with NRB provenance), not
// from the pilot DB's placeholder `institutions` rows and not from the bare
// mfi-0NN id. Assertions whose source identity cannot be resolved against the
// public registry are left in the evidence layer and NOT published.
// ============================================================================

import { createRequire } from "node:module";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { institutions } from "../src/data/institutions";
import { branchIdentityKey } from "../lib/ingestion/branch-records";

/** Minimal public-registry shape this exporter needs. */
type PublicInstitution = (typeof institutions)[number];

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

type Row = Record<string, unknown>;
type DB = {
  prepare(sql: string): { get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[] };
  close(): void;
};

interface BranchAssertionLiteral {
  entity_id: string;
  institution_id: string;
  institution_slug: string;
  field_name: string;
  value: string;
  source_id: string;
  source_url: string | null;
  observed_at: string;
  valid_to: string | null;
  verification_status: string;
  confidence: number | null;
}

interface OpenBranchConflictLiteral {
  entity_id: string;
  field_name: string;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * A published branch must be individually addressable. branchSlug() reduces the
 * branch tail of the identity key to [a-z0-9], so a value written entirely in a
 * non-Latin script (e.g. pure Devanagari branch names) yields an EMPTY tail —
 * every such branch at one institution would collapse onto the identical slug
 * and become unreachable. Publishing them would publish duplicate-looking
 * public identities, so they stay in evidence and are not published. This is a
 * slug-normalisation limitation, not a judgement about the name.
 */
function hasLatinTail(name: string): boolean {
  return /[a-z0-9]/i.test(String(name ?? ""));
}

function main(): void {
  const readDbPath = (file: string, key: string): string | undefined => {
    const p = join(process.cwd(), "data", "pilot", file);
    if (!existsSync(p)) return undefined;
    const v = (JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>)[key] as string | undefined;
    return v && !v.startsWith("<") ? v : undefined;
  };
  const branchesPilot = readDbPath("pilot-branches-report.json", "db_path");
  const dbPath = process.argv[2] ?? process.env.LK_PILOT_DB ?? branchesPilot;
  console.log(`source db: ${dbPath ?? "(none)"}`);
  if (!dbPath) {
    console.error("USAGE: npm run pilot:export:branches -- <db-path>   (or set LK_PILOT_DB)");
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true }) as DB;

  // ---------------------------------------------------------------------------
  // Canonical institution identity — same rule as pilot-export-people.ts: the
  // SOURCE is the identity that is actually evidence; a source that cannot be
  // resolved against the public registry is DROPPED, never invented.
  // ---------------------------------------------------------------------------
  const pilotSourcesPath = join(process.cwd(), "data", "pilot", "pilot-sources.json");
  const pilotSources: { id: string; institution_id: string; url?: string | null; publisher?: string; domain?: string; capabilities?: Array<{ capability: string; known_url?: string | null }> }[] = existsSync(
    pilotSourcesPath,
  )
    ? ((JSON.parse(readFileSync(pilotSourcesPath, "utf8")) as { sources?: unknown }).sources ??
        (JSON.parse(readFileSync(pilotSourcesPath, "utf8")) as unknown[])) as never
    : [];

  const sourceBranchUrlById = (sourceId: string): string | null => {
    const src = pilotSources.find((s) => s.id === sourceId);
    const known = src?.capabilities?.find((c) => c.capability === "BRANCH_DIRECTORY")?.known_url;
    return typeof known === "string" && /^https?:\/\//i.test(known) ? known : null;
  };

  const identityKey = (s: string): string =>
    String(s ?? "")
      .toLowerCase()
      .replace(/\blimited\b/g, "ltd")
      .replace(/\b(ltd|co|company|pvt|private)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const resolveInstitution = (sourceId: string): PublicInstitution | undefined => {
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
    return undefined; // unresolvable -> drop, never guess
  };

  const rows = db
    .prepare(
      `SELECT a.entity_id, a.source_id, a.field_name, a.value, a.observed_at, a.valid_to, a.verification_status, a.confidence
         FROM data_assertions a
        WHERE a.entity_type = 'institution' AND a.field_name LIKE 'branch%'
        ORDER BY a.value, a.field_name, a.observed_at`,
    )
    .all() as Row[];

  const branches: BranchAssertionLiteral[] = [];
  const droppedSources = new Map<string, number>();
  const droppedUnaddressable = new Map<string, number>();
  // One row per (institution, branch identity, field, source): dry re-runs and
  // deduplicated card rows would otherwise emit the same claim twice, and the
  // projection would then count two opinions where one source spoke once.
  const seen = new Set<string>();
  for (const r of rows) {
    const sourceId = String(r.source_id);
    const inst = resolveInstitution(sourceId);
    if (!inst) {
      droppedSources.set(sourceId, (droppedSources.get(sourceId) ?? 0) + 1);
      continue;
    }
    const value = String(r.value);
    const entityId = branchIdentityKey(inst.id, value);
    if (!hasLatinTail(value)) {
      droppedUnaddressable.set(`${inst.slug} :: ${value}`, (droppedUnaddressable.get(`${inst.slug} :: ${value}`) ?? 0) + 1);
      continue;
    }
    const dedupeKey = `${entityId}|${String(r.field_name)}|${sourceId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    branches.push({
      entity_id: entityId,
      institution_id: inst.id,
      institution_slug: inst.slug,
      field_name: String(r.field_name),
      value,
      source_id: sourceId,
      source_url: sourceBranchUrlById(sourceId),
      observed_at: String(r.observed_at),
      valid_to: (r.valid_to as string | null) ?? null,
      verification_status: String(r.verification_status),
      confidence: num(r.confidence),
    });
  }

  branches.sort(
    (a, b) =>
      a.institution_slug.localeCompare(b.institution_slug) ||
      a.entity_id.localeCompare(b.entity_id) ||
      a.field_name.localeCompare(b.field_name) ||
      a.observed_at.localeCompare(b.observed_at),
  );

  // Only a genuine CROSS-SOURCE disagreement over the same branch field is a
  // conflict. Re-keyed entity_id keeps the conflict key identical to what the
  // read model checks (branchesFromAssertionRows -> `${entityId}|${field}`).
  const conflictRows = db
    .prepare(
      `SELECT c.entity_id, c.field_name, a.value, a.source_id
         FROM data_conflicts c
         JOIN data_assertions a
           ON a.entity_id = c.entity_id AND a.field_name = c.field_name AND a.source_id = c.source_a_id
        WHERE c.resolution_status = 'OPEN'
          AND c.entity_type = 'institution'
          AND c.field_name LIKE 'branch%'
          AND c.source_a_id <> c.source_b_id
        ORDER BY c.entity_id, c.field_name`,
    )
    .all() as Row[];
  const openBranchConflicts: OpenBranchConflictLiteral[] = [];
  const conflictSeen = new Set<string>();
  for (const r of conflictRows) {
    const inst = resolveInstitution(String(r.source_id));
    if (!inst) continue;
    const entityId = branchIdentityKey(inst.id, String(r.value));
    const conflictKey = `${entityId}|${String(r.field_name)}`;
    if (conflictSeen.has(conflictKey)) continue;
    conflictSeen.add(conflictKey);
    openBranchConflicts.push({ entity_id: entityId, field_name: String(r.field_name) });
  }

  for (const [sourceId, n] of droppedSources) {
    console.log(`  DROPPED (unresolvable institution identity): ${sourceId} — ${n} assertions kept in evidence, not published`);
  }
  for (const [who, n] of droppedUnaddressable) {
    console.log(`  DROPPED (not individually addressable — name has no [a-z0-9] characters): ${who} — ${n} assertion(s) kept in evidence, not published`);
  }

  const body = `// Deterministic snapshot generated by scripts/pilot-export-branches.ts (read-only)
// from ingestion evidence (data_assertions + data_conflicts). Raw branch
// evidence rows only — the BranchDto projection lives in
// lib/repository/projection.ts so every adapter means the same thing.
import type { BranchAssertionRecord } from "../../lib/repository/projection";

export const branchAssertions: (BranchAssertionRecord & { confidence: number | null })[] = ${JSON.stringify(branches, null, 2)};

export const openBranchConflicts: { entity_id: string; field_name: string }[] = ${JSON.stringify(openBranchConflicts, null, 2)};
`;

  const target = join(process.cwd(), "src", "data", "branches.ts");
  writeFileSync(target, body);
  console.log(
    `WROTE ${target}\nbranch assertions: ${branches.length}, distinct branches: ${new Set(branches.map((b) => `${b.institution_slug}|${b.value}`)).size}, open conflicts: ${openBranchConflicts.length} [raw=${dbPath}]`,
  );
  db.close();
}

main();