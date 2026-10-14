// ============================================================================
// P2-D — canonical general document builder.
//
// Reads the merged durable evidence store (data/durable/store.db by default)
// and generates the deterministic `src/data/documents.ts` evidence snapshot
// for the general document layer: every `document_title` / `notice_title`
// assertion an institution's own site produced. The public /documents page
// reads it through lib/repository/static-documents.ts; the D1 adapter serves
// the same projection at runtime.
//
// What this layer is, and what it deliberately is not
//
//   The evidence here is TITLE-ONLY. A source linked a document and the link
//   text was asserted; no target URL, no publication date, no reporting period
//   was ever recorded, because none of them exists in evidence. So the module
//   carries (institution, exact title, owning source, observed_at) and nothing
//   else — `official_url`, `go_slug` and `period` stay null in the read model,
//   and filling any of them would put a claim on a page that no source made.
//   The institution-published financial documents (P2-C) are a separate,
//   URL-keyed layer with their own builder; nothing here touches it.
//
// Canonical identity follows the P2-C precedent: the owning institution is
// resolved from the SOURCE's publisher against the public registry
// (`src/data/institutions.ts`), never joined from the store's `institutions`
// copy, whose pilot `mfi-0NN` numbering disagrees with the registry for three
// institutions. `entity_id` is written as the canonical
// `document-<institution>|<title>` through the projection's own helper, so the
// builder, the D1 adapter and the read model cannot disagree about identity.
//
// A title that is a bare call to action ("Download", "Read more") or the
// institution's own registered name is not a document title: such rows are
// held in the evidence store and NOT written to the module, and the projection
// gates them a second time for callers that never go through this build.
//
// Run: npm run build:documents
// ============================================================================

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { institutions } from "../src/data/institutions";
import {
  documentConflictRows,
  documentEntityId,
  documentsFromAssertionRows,
  titleGateReason,
  type DocumentAssertionRecord,
  type EvidenceConflictRow,
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
 * The merged durable store is the default evidence source. Set
 * `M35_DOCUMENTS_DB` to pin a single evidence database for a reproducible
 * rebuild (which is how the smoke tests exercise conflict and gate paths).
 */
const DB_OVERRIDE = process.env.M35_DOCUMENTS_DB;
const DB_PATH = DB_OVERRIDE ?? join(__dirname, "..", "data", "durable", "store.db");
const OUT_PATH = join(__dirname, "..", "src", "data", "documents.ts");

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
      `build:documents — durable store is stale: ${newestFile} is newer than ${dbPath}.\n` +
        `Run \`npm run durable:build\` first, or set M35_DOCUMENTS_DB to a pinned evidence database.`,
    );
    process.exit(1);
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Institution-only identity key for publisher/alias matching (same as P2-A/B/C). */
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

// Canonical institution identity is resolved from the SOURCE, never from a
// pilot `mfi-0NN` entity id. Every pilot source is an official MFB website
// carrying the institution's real publisher name, so the join is made on that
// source identity against the public registry. An unresolvable source is
// dropped from the public layer and kept in evidence — nothing is invented.
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

function buildModuleBody(
  assertions: (DocumentAssertionRecord & { confidence: number | null })[],
  open: { entity_id: string; field_name: string }[],
  provenance: string,
): string {
  return `// Deterministic snapshot generated by scripts/build-documents-module.ts (read-only)
// from the merged durable evidence store (data_assertions + data_conflicts).
// Raw general document evidence rows only — the DocumentDto projection lives in
// lib/repository/projection.ts so every adapter means the same thing.
//
// entity_id is the canonical \`document-<institution>|<title>\` identity.
// Identity was resolved from each source's publisher against the public
// registry, never from the store's pilot mfi-0NN numbering.
//
// The evidence is title-only: no target URL, no date and no period was ever
// observed for these documents, so the published record carries title,
// institution, owning source and observation time and nothing else.
// Non-rejected, current assertions whose source identity cannot be resolved
// against the public registry, and titles that are a call to action or the
// institution's own name, are held in the evidence layer and are NOT published
// here.
import type { DocumentAssertionRecord } from "../../lib/repository/projection";

/** ${provenance} */
export const documentsProvenance: string = ${JSON.stringify(provenance)};

export const documentAssertions: (DocumentAssertionRecord & { confidence: number | null })[] = ${JSON.stringify(assertions, null, 2)};

export const openDocumentConflicts: { entity_id: string; field_name: string }[] = ${JSON.stringify(open, null, 2)};
`;
}

function uniqueBySourceClaim(rows: (DocumentAssertionRecord & { confidence: number | null })[]) {
  // Each source owns at most one current observation per (document, field, value);
  // keep the latest. Corroboration is preserved because distinct sources remain
  // distinct rows.
  const byKey = new Map<string, DocumentAssertionRecord & { confidence: number | null }>();
  for (const r of rows) {
    const key = `${r.entity_id}|${r.field_name}|${r.value}|${r.source_id}`;
    const prev = byKey.get(key);
    if (!prev || r.observed_at > prev.observed_at) byKey.set(key, r);
  }
  return [...byKey.values()];
}

function main(): void {
  // Writes a generated source file; dev-only tooling, never staging/production.
  guardOrExit("build:documents");
  if (!existsSync(DB_PATH)) {
    console.error(
      `build:documents — no evidence store at ${DB_PATH}.\n` +
        `Run \`npm run durable:build\` first, or set M35_DOCUMENTS_DB to a pinned evidence database.`,
    );
    writeFileSync(OUT_PATH, buildModuleBody([], [], "0 document record(s); no evidence store found"), "utf8");
    process.exit(1);
  }
  if (!DB_OVERRIDE) assertStoreFresh(DB_PATH);

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT a.entity_id, a.source_id, a.field_name, a.value, a.observed_at, a.valid_to, a.verification_status, a.confidence
         FROM data_assertions a
        WHERE a.field_name IN ('document_title', 'notice_title')
        ORDER BY a.entity_id, a.field_name, a.observed_at, a.value`,
    )
    .all() as Row[];

  let droppedRejectedCount = 0;
  let droppedRetiredCount = 0;
  let droppedTitles = 0;
  const droppedSources = new Map<string, number>();
  const assertions: (DocumentAssertionRecord & { confidence: number | null })[] = [];

  for (const r of rows) {
    if (String(r.verification_status) === "REJECTED") {
      droppedRejectedCount += 1;
      continue;
    }
    if (r.valid_to !== null && r.valid_to !== undefined) {
      droppedRetiredCount += 1;
      continue;
    }
    const sourceId = String(r.source_id);
    const inst = resolveInstitution(sourceId);
    if (!inst) {
      // Held in evidence, not published: an owner that cannot be identified
      // from the source's own publisher must never be guessed.
      droppedSources.set(sourceId, (droppedSources.get(sourceId) ?? 0) + 1);
      continue;
    }
    const value = String(r.value);
    if (titleGateReason(value, inst.name)) {
      droppedTitles += 1;
      continue;
    }
    assertions.push({
      entity_id: documentEntityId(inst.id, value),
      institution_id: inst.id,
      institution_slug: inst.slug,
      institution_name: inst.name,
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

  const deduped = uniqueBySourceClaim(assertions);
  deduped.sort(
    (a, b) =>
      a.entity_id.localeCompare(b.entity_id) ||
      String(a.field_name).localeCompare(String(b.field_name)) ||
      a.value.localeCompare(b.value) ||
      a.observed_at.localeCompare(b.observed_at),
  );

  // Only a genuine CROSS-SOURCE disagreement is a conflict, mapped through the
  // canonical document identity so it lines up with the published rows. The
  // conflict's institution comes from its own source's publisher — the same
  // authority assertion rows use — never from the conflict's entity id.
  const conflictRows = db
    .prepare(
      `SELECT entity_id, field_name, value_a, value_b, source_a_id, source_b_id
         FROM data_conflicts
        WHERE resolution_status = 'OPEN'
          AND field_name IN ('document_title', 'notice_title')
          AND source_a_id IS NOT NULL
          AND source_b_id IS NOT NULL
          AND source_a_id <> source_b_id
        ORDER BY entity_id, field_name, value_a, value_b`,
    )
    .all() as Row[];
  const resolvedConflicts: EvidenceConflictRow[] = conflictRows.map((c) => ({
    entity_id: String(c.entity_id),
    field_name: String(c.field_name),
    value_a: c.value_a === null || c.value_a === undefined ? null : String(c.value_a),
    value_b: c.value_b === null || c.value_b === undefined ? null : String(c.value_b),
    institution_id:
      resolveInstitution(String(c.source_a_id ?? ""))?.id ??
      resolveInstitution(String(c.source_b_id ?? ""))?.id ??
      null,
  }));
  const open = documentConflictRows(resolvedConflicts);
  open.sort((a, b) => a.entity_id.localeCompare(b.entity_id) || a.field_name.localeCompare(b.field_name));
  db.close();

  const projection = documentsFromAssertionRows(deduped, {
    openConflictKeys: new Set(open.map((c) => `${c.entity_id}|${c.field_name}`)),
  });
  const notices = projection.filter((p) => p.doc_type === "NOTICE").length;
  const links = projection.length - notices;
  const institutionsCovered = new Set(projection.map((p) => p.institution_id)).size;
  const provenance =
    `${projection.length} current document record(s) ` +
    `(${notices} notice(s), ${links} document link(s), ${institutionsCovered} institution(s)); ` +
    `titles observed as link text on institutions' own sites, target URLs and dates never observed; ` +
    `all UNVERIFIED, contents never read`;

  writeFileSync(OUT_PATH, buildModuleBody(deduped, open, provenance));

  for (const [sourceId, n] of droppedSources) {
    console.log(
      `  DROPPED (unresolvable institution identity): ${sourceId} — ${n} assertion(s) kept in evidence, not published`,
    );
  }
  if (droppedTitles > 0) {
    console.log(
      `  DROPPED (title is a call to action or the institution's own name): ${droppedTitles} assertion(s) kept in evidence`,
    );
  }
  if (droppedRetiredCount > 0) {
    console.log(`  DROPPED (retired/superseded): ${droppedRetiredCount} assertion(s) kept in evidence`);
  }
  if (droppedRejectedCount > 0) {
    console.log(`  DROPPED (rejected): ${droppedRejectedCount} assertion(s) kept in evidence`);
  }

  console.log(
    `WROTE ${OUT_PATH}\n` +
      `document assertions: ${deduped.length}, distinct documents: ${projection.length}, ` +
      `notices: ${notices}, document links: ${links}, institutions: ${institutionsCovered}, ` +
      `open (cross-source) conflicts: ${open.length} [store=${DB_PATH}]\n` +
      `TITLE-ONLY: no URL/date/period exists in evidence — official_url/go_slug/period stay null.`,
  );
}

main();
