// ============================================================================
// P2-C — canonical Financial documents builder.
//
// Reads the merged durable evidence store (data/durable/store.db by default)
// and generates the deterministic `src/data/financials.ts` evidence snapshot
// that the public institution pages and the Phase C API read through
// lib/repository/projection.ts.
//
// What changed from the pre-P2-C builder, and why
//
//   The old `build-financials-module.ts` resolved the owning institution with a
//   store join `ingestion_sources -> institutions`. The store's `institutions`
//   copy carries PILOT `mfi-0NN` numbering that does not agree with the public
//   registry, so a document published by Mahila Laghubitta could be labelled with
//   a different company that happens to share its pilot number. Canonical
//   identity is now resolved from the SOURCE's publisher against the public
//   registry (`src/data/institutions.ts`), the same rule P2-A and P2-B use, and
//   written onto every row as `institution_id` / `institution_slug`. No consumer
//   re-parses an `entity_id` prefix to find the owner again.
//
//   entity_id is re-keyed to `financial-<institution>|<url>` so the store's
//   pilot-numbered ids never leak into the published layer.
//
//   A visible-text link label ("Download", "Read more", the institution's own
//   registered name) is not a document title. Such a DOCUMENT_TITLE assertion is
//   withheld here and kept in evidence; the projection shows the document's own
//   filename instead. An OPEN cross-source conflict marks the record CONFLICT.
//
//   ASSERTION-ONLY and document-only on purpose: the evidence states a URL and
//   the source's own naming, never a figure. `financial_reports` /
//   `financial_metrics` in lk.db stay at 0 rows because there is nothing to seed
//   them from, exactly as the branch geography gap keeps `branches` empty. See
//   docs/data/P2-C-FINANCIAL-AUDIT.md.
//
// Run: npm run build:financials
// ============================================================================

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { institutions } from "../src/data/institutions";
import {
  financialsFromAssertionRows,
  type FinancialAssertionRecord,
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
 * The merged durable store is the default evidence source. Set `M35_FINANCIALS_DB`
 * to pin a single evidence database for a reproducible rebuild.
 */
const DB_OVERRIDE = process.env.M35_FINANCIALS_DB;
const DB_PATH = DB_OVERRIDE ?? join(__dirname, "..", "data", "durable", "store.db");
const OUT_PATH = join(__dirname, "..", "src", "data", "financials.ts");

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
      `build:financials — durable store is stale: ${newestFile} is newer than ${dbPath}.\n` +
        `Run \`npm run durable:build\` first, or set M35_FINANCIALS_DB to a pinned evidence database.`,
    );
    process.exit(1);
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Institution-only identity key for publisher/alias matching (same as P2-A/P2-B). */
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
// pilot `mfi-0NN` entity_id. Every pilot source is an official MFB website
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

/** A visible-text label that names a call to action, not a document. */
const GENERIC_TITLE =
  /^(download|downloads?|read\s*more|readmore|view(\s*more)?|more|click(\s*here)?|here|details?|see\s*more|open|link|pdf|file|document|notice|english|nepali)$/i;

function urlFromEntityId(entityId: string): string | null {
  const tail = entityId.split("|").slice(1).join("|");
  return /^https?:\/\//i.test(tail) ? tail : null;
}

/**
 * Re-key only the institution segment of `financial-<pilot>|<url>`, preserving the
 * URL tail byte-for-byte. Rebuilding the key from the SOURCE_DOCUMENT value would
 * split one document into two whenever the title row's URL differs in case or
 * encoding from the entity id's tail (which it often does).
 */
function canonicalEntityId(rawId: string, institutionId: string): string {
  const tail = rawId.split("|").slice(1).join("|");
  return tail ? `financial-${institutionId}|${tail}` : rawId;
}

interface FinancialTitleConflict {
  entity_id: string;
  field_name: string;
}

function buildModuleBody(
  assertions: (FinancialAssertionRecord & { confidence: number | null })[],
  open: FinancialTitleConflict[],
  provenance: string,
): string {
  return `// Deterministic snapshot generated by scripts/build-financials-module.ts (read-only)
// from the merged durable evidence store (data_assertions + data_conflicts).
// Raw financial document evidence rows only — the FinancialDocumentDto
// projection lives in lib/repository/projection.ts so every adapter means the
// same thing.
//
// entity_id is the canonical \`financial-<institution>|<url>\` identity. Identity
// was resolved from each source's publisher against the public registry, never
// from the store's pilot mfi-0NN numbering.
//
// Non-rejected, current assertions whose source identity cannot be resolved
// against the public registry, and DOCUMENT_TITLE labels that are a call to
// action or the institution's own name, are held in the evidence layer and are
// NOT published here.
import type { FinancialAssertionRecord } from "../../lib/repository/projection";

/** ${provenance} */
export const financialsProvenance: string = ${JSON.stringify(provenance)};

export const financialAssertions: (FinancialAssertionRecord & { confidence: number | null })[] = ${JSON.stringify(assertions, null, 2)};

export const openFinancialConflicts: { entity_id: string; field_name: string }[] = ${JSON.stringify(open, null, 2)};
`;
}

function uniqueBySourceClaim(rows: (FinancialAssertionRecord & { confidence: number | null })[]) {
  // Each source owns at most one current observation per (document, field, value);
  // keep the latest. Corroboration is preserved because distinct sources remain
  // distinct rows.
  const byKey = new Map<string, FinancialAssertionRecord & { confidence: number | null }>();
  for (const r of rows) {
    const key = `${r.entity_id}|${r.field_name}|${r.value}|${r.source_id}`;
    const prev = byKey.get(key);
    if (!prev || r.observed_at > prev.observed_at) byKey.set(key, r);
  }
  return [...byKey.values()];
}

function main(): void {
  // Writes a generated source file; dev-only tooling, never staging/production.
  guardOrExit("build:financials");
  if (!existsSync(DB_PATH)) {
    console.error(
      `build:financials — no evidence store at ${DB_PATH}.\n` +
        `Run \`npm run durable:build\` first, or set M35_FINANCIALS_DB to a pinned evidence database.`,
    );
    writeFileSync(OUT_PATH, buildModuleBody([], [], "0 financial document record(s); no evidence store found"));
    process.exit(1);
  }
  if (!DB_OVERRIDE) assertStoreFresh(DB_PATH);

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT a.entity_id, a.source_id, a.field_name, a.value, a.observed_at, a.valid_to, a.verification_status, a.confidence
         FROM data_assertions a
        WHERE a.entity_type = 'FINANCIAL'
        ORDER BY a.entity_id, a.field_name, a.observed_at`,
    )
    .all() as Row[];

  // Pass 1: learn each raw entity's URL and canonical institution. Every
  // assertion of one entity shares the entity_id, so the first resolvable row
  // fixes the identity for all of them.
  const entityMeta = new Map<string, { url: string | null; institution: (typeof institutions)[number] }>();
  const droppedSources = new Map<string, number>();
  for (const r of rows) {
    if (String(r.verification_status) === "REJECTED") continue;
    if (r.valid_to !== null && r.valid_to !== undefined) continue;
    const rawId = String(r.entity_id);
    if (entityMeta.has(rawId)) continue;
    const inst = resolveInstitution(String(r.source_id));
    if (!inst) continue;
    entityMeta.set(rawId, { url: urlFromEntityId(rawId), institution: inst });
  }

  // Pass 2: canonicalize, gate and publish.
  let droppedRetiredCount = 0;
  let droppedGenericTitles = 0;
  const assertions: (FinancialAssertionRecord & { confidence: number | null })[] = [];

  // A DOCUMENT_TITLE may not be a generic label nor the institution's own name.
  const rawTitleByEntityInst = new Map<string, string[]>();

  for (const r of rows) {
    if (String(r.verification_status) === "REJECTED") continue;
    if (r.valid_to !== null && r.valid_to !== undefined) {
      droppedRetiredCount += 1;
      continue;
    }
    const rawId = String(r.entity_id);
    const sourceId = String(r.source_id);
    const meta = entityMeta.get(rawId);
    if (!meta) {
      // Either this entity had no resolvable source, or its only rows are of a
      // field this pass does not publish. The row stays in evidence.
      droppedSources.set(sourceId, (droppedSources.get(sourceId) ?? 0) + 1);
      continue;
    }
    const inst = meta.institution;
    const entityId = canonicalEntityId(rawId, inst.id);

    if (String(r.field_name) === "DOCUMENT_TITLE") {
      const value = String(r.value);
      const key = `${entityId}|${inst.id}`;
      if (GENERIC_TITLE.test(value.trim()) || identityKey(value) === identityKey(inst.name)) {
        droppedGenericTitles += 1;
        continue;
      }
      const arr = rawTitleByEntityInst.get(key) ?? [];
      arr.push(value);
      rawTitleByEntityInst.set(key, arr);
    }

    assertions.push({
      entity_id: entityId,
      institution_id: inst.id,
      institution_slug: inst.slug,
      institution_name: inst.name,
      field_name: String(r.field_name),
      value: String(r.value),
      source_id: sourceId,
      source_url: sourceUrlById(sourceId),
      observed_at: String(r.observed_at),
      valid_to: null,
      verification_status: String(r.verification_status),
      confidence: num(r.confidence),
    });
  }

  const deduped = uniqueBySourceClaim(assertions);
  deduped.sort(
    (a, b) =>
      a.entity_id.localeCompare(b.entity_id) ||
      String(a.field_name).localeCompare(String(b.field_name)) ||
      a.value.localeCompare(b.value) ||
      a.observed_at.localeCompare(b.observed_at),
  );

  // Only a genuine CROSS-SOURCE disagreement is a conflict, mapped through the
  // canonical entity id so it lines up with the published rows.
  const conflictRows = db
    .prepare(
      `SELECT a.entity_id, a.source_id, a.field_name FROM data_conflicts c
         JOIN data_assertions a
           ON a.entity_id = c.entity_id AND a.field_name = c.field_name AND a.source_id = c.source_a_id
        WHERE c.resolution_status = 'OPEN'
          AND c.entity_type = 'FINANCIAL'
          AND c.source_a_id <> c.source_b_id
        GROUP BY a.entity_id, a.field_name, a.source_id
        ORDER BY a.entity_id, a.field_name`,
    )
    .all() as Row[];
  const open: FinancialTitleConflict[] = [];
  for (const r of conflictRows) {
    const rawId = String(r.entity_id);
    const inst = resolveInstitution(String(r.source_id)) ?? entityMeta.get(rawId)?.institution;
    if (!inst) continue;
    open.push({ entity_id: canonicalEntityId(rawId, inst.id), field_name: String(r.field_name) });
  }
  db.close();

  const projection = financialsFromAssertionRows(deduped, {
    openConflictKeys: new Set(open.map((c) => `${c.entity_id}|${c.field_name}`)),
  });
  const reports = projection.filter((p) => p.kind === "REPORT").length;
  const rates = projection.filter((p) => p.kind === "RATE").length;
  const institutionsCovered = new Set(projection.map((p) => p.institution_id)).size;
  const provenance =
    `${projection.length} current financial document record(s) ` +
    `(${reports} report document(s), ${rates} rate notice(s), ${institutionsCovered} institution(s)); ` +
    `all UNVERIFIED, contents never read`;

  writeFileSync(OUT_PATH, buildModuleBody(deduped, open, provenance));

  for (const [sourceId, n] of droppedSources) {
    console.log(
      `  DROPPED (unresolvable institution identity): ${sourceId} — ${n} assertion(s) kept in evidence, not published`,
    );
  }
  if (droppedGenericTitles > 0) {
    console.log(
      `  DROPPED (title is a call to action or the institution's own name): ${droppedGenericTitles} assertion(s) kept in evidence`,
    );
  }
  if (droppedRetiredCount > 0) {
    console.log(`  DROPPED (retired/superseded): ${droppedRetiredCount} assertion(s) kept in evidence`);
  }

  console.log(
    `WROTE ${OUT_PATH}\n` +
      `financial assertions: ${deduped.length}, distinct documents: ${projection.length}, ` +
      `reports: ${reports}, rate notices: ${rates}, institutions: ${institutionsCovered}, ` +
      `open (cross-source) conflicts: ${open.length} [store=${DB_PATH}]\n` +
      `ASSERTION-ONLY: lk.db financial_reports/financial_metrics are NOT seeded (no figures in evidence).`,
  );
}

main();