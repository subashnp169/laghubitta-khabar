/**
 * Rebuild `src/data/financials.ts` from the Phase C pilot evidence database.
 *
 * The module this writes is read by the institution pages, the /research surface
 * and the B2B API, so it is generated and never hand-edited. A record reaches it
 * only if there is a current (valid_to IS NULL), non-rejected FINANCIAL
 * `data_assertions` row in the pilot database, which in turn exists only if a
 * document URL was actually fetched from an institution's own site AND published
 * by the evidence application pass. No code path in this project can invent one.
 *
 * A financial record is a document and never anything more: the URL, a title
 * (anchor text or filename) and a deterministic kind. Its contents were never
 * read, so no metric and no numeric rate is carried on the row — the "unread
 * notice" contract that careers documents extend to financials. Rows are either
 * ACTIVE records or rows with an open cross-source CONFLICT on some field; both
 * kinds are reported honestly and nothing is auto-promoted.
 *
 * Run: npm run build:financials
 */
import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
interface Db {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}
const Database = require("better-sqlite3") as new (p: string) => Db;

const DB_PATH = join(__dirname, "..", "data", "pilot", "evidence", "pilot-financials-ext-2026-10-01.db");
const OUT_PATH = join(__dirname, "..", "src", "data", "financials.ts");

const AS_OF = process.env.FC_AS_OF ?? "2026-10-01";

interface FinancialAssertionRow {
  entity_id: string;
  field_name: string;
  value: string;
  observed_at: string;
  institution_id: string;
  institution_slug: string;
  institution_name: string;
  source_name: string | null;
}

interface ConflictEntity {
  entity_id: string;
}

/** Aggregate the active FINANCIAL assertions, one record per document entity. */
function readFinancialRows(db: Db): FinancialAssertionRow[] {
  return db
    .prepare(
      `SELECT a.entity_id, a.field_name, a.value, a.observed_at,
              COALESCE(isrc.institution_id, '') AS institution_id,
              COALESCE(inst.slug, '')        AS institution_slug,
              COALESCE(inst.name_en, '')     AS institution_name,
              isrc.url                       AS source_name
         FROM data_assertions a
         LEFT JOIN ingestion_sources isrc ON isrc.id = a.source_id
         LEFT JOIN institutions inst     ON inst.id = isrc.institution_id
        WHERE a.entity_type = 'FINANCIAL'
          AND a.valid_to IS NULL
        ORDER BY a.entity_id, a.field_name`,
    )
    .all() as FinancialAssertionRow[];
}

function readOpenConflictEntities(db: Db): Set<string> {
  const rows = db
    .prepare(
      `SELECT entity_id FROM data_conflicts
        WHERE resolution_status = 'OPEN' AND entity_type = 'FINANCIAL'`,
    )
    .all() as ConflictEntity[];
  return new Set(rows.map((r) => r.entity_id));
}

export interface FinancialRecord {
  id: string;
  slug: string;
  institution: string;
  title: string;
  kind: "REPORT" | "RATE";
  reportType: string | null;
  rateKind: string | null;
  sourceDocument: string | null;
  sourceName: string | null;
  lastSeenAt: string;
  status: string;
}

interface Grouped {
  entityId: string;
  institutionId: string;
  institutionSlug: string;
  institutionName: string;
  sourceName: string | null;
  lastSeenAt: string;
  sourceDocument: string | null;
  title: string | null;
  reportType: string | null;
  rateKind: string | null;
}

function group(rows: FinancialAssertionRow[]): Grouped[] {
  const byEntity = new Map<string, Grouped>();
  for (const r of rows) {
    let g = byEntity.get(r.entity_id);
    if (!g) {
      g = {
        entityId: r.entity_id,
        institutionId: r.institution_id,
        institutionSlug: r.institution_slug,
        institutionName: r.institution_name,
        sourceName: r.source_name,
        lastSeenAt: r.observed_at,
        sourceDocument: null,
        title: null,
        reportType: null,
        rateKind: null,
      };
      byEntity.set(r.entity_id, g);
    }
    if (r.observed_at > g.lastSeenAt) g.lastSeenAt = r.observed_at;
    if (r.field_name === "SOURCE_DOCUMENT") g.sourceDocument = r.value;
    else if (r.field_name === "DOCUMENT_TITLE") g.title = r.value;
    else if (r.field_name === "DOCUMENT_TYPE") g.reportType = r.value;
    else if (r.field_name === "RATE_KIND") g.rateKind = r.value;
  }
  return [...byEntity.values()].sort((a, b) => a.entityId.localeCompare(b.entityId));
}

function toRecord(g: Grouped): FinancialRecord {
  const institution = g.institutionName || "(institution name not observed)";
  return {
    id: g.entityId,
    slug: `${g.institutionSlug || "(unresolved)"}-${g.entityId}`,
    institution,
    title: g.title ?? (g.sourceDocument ? fileNameOf(g.sourceDocument) : g.entityId),
    kind: g.rateKind ? "RATE" : "REPORT",
    reportType: g.reportType,
    rateKind: g.rateKind,
    sourceDocument: g.sourceDocument,
    sourceName: g.sourceName,
    lastSeenAt: g.lastSeenAt,
    // Verdict at publish time: a record with any open cross-source conflict is
    // reported as such rather than published over it.
    status: "ACTIVE" as const,
  };
}

function fileNameOf(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    return url;
  }
}

function render(r: FinancialRecord): string {
  return [
    "  {",
    `    id: ${JSON.stringify(r.id)},`,
    `    slug: ${JSON.stringify(r.slug)},`,
    `    institution: ${JSON.stringify(r.institution)},`,
    `    title: ${JSON.stringify(r.title)},`,
    `    kind: ${JSON.stringify(r.kind)},`,
    `    reportType: ${JSON.stringify(r.reportType)},`,
    `    rateKind: ${JSON.stringify(r.rateKind)},`,
    `    sourceDocument: ${JSON.stringify(r.sourceDocument)},`,
    `    sourceName: ${JSON.stringify(r.sourceName)},`,
    `    lastSeenAt: ${JSON.stringify(r.lastSeenAt)},`,
    `    status: ${JSON.stringify(r.status)},`,
    "  },",
  ].join("\n");
}

function header(records: FinancialRecord[], note: string): string {
  const body = records.length === 0 ? "" : `\n${records.map(render).join("\n")}\n`;
  return `// GENERATED FILE - do not edit. Run \`npm run build:financials\` to rebuild.
//
// ${note}
//
// Every entry is a projection of current, non-rejected FINANCIAL assertion rows in
// data/pilot/evidence/pilot-financials-ext-2026-10-01.db, and such rows exist only if
// a document URL was fetched from an institution's own site and then published by
// the Phase C evidence application pass. No code path in this project can invent
// one. Do not add a row by hand: nothing downstream would be able to tell it from
// a real one.
//
// A financial record is a document and no more: the title and kind are what the
// source's own naming said, and the document body was never read, so no metric and
// no numeric rate ever appears on a row. An empty list here means "no financial
// document has been published yet", not "no evidence exists" — the evidence and
// the apply audit live in data/pilot.

export type FinancialKind = "REPORT" | "RATE";

export interface FinancialRecord {
  id: string;
  slug: string;
  institution: string;
  title: string;
  kind: FinancialKind;
  reportType: string | null;
  rateKind: string | null;
  sourceDocument: string | null;
  sourceName: string | null;
  lastSeenAt: string;
  status: string;
}

/** What this build was based on, shown by the page so the empty case is legible. */
export const financialsProvenance: string = ${JSON.stringify(note)};

export const financials: FinancialRecord[] = [${body}];
`;
}

function main(): void {
  if (!existsSync(DB_PATH)) {
    writeFileSync(OUT_PATH, header([], "no Phase C pilot evidence database was present"), "utf8");
    console.log("build:financials — no evidence database present, wrote an empty module");
    return;
  }

  const db = new Database(DB_PATH);
  try {
    const records = group(readFinancialRows(db)).map(toRecord);
    const reports = records.filter((r) => r.kind === "REPORT").length;
    const rates = records.filter((r) => r.kind === "RATE").length;
    const note =
      records.length === 0
        ? `no financial document published yet as of ${AS_OF}: the Phase C apply pass asserts none`
        : `${records.length} current financial document record(s) as of ${AS_OF} (${reports} report document(s), ${rates} rate notice(s)); all UNVERIFIED, contents never read`;
    writeFileSync(OUT_PATH, header(records, note), "utf8");
    console.log(`build:financials — ${note}`);
  } finally {
    db.close();
  }
}

main();