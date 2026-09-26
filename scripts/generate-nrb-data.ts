// ============================================================================
// Front-end snapshot generator — reads the NRB ledger DB (read-only) and emits
// a deterministic `src/data/nrb.ts` module consumed by the Next.js pages so the
// static site never touches the network or the scratch DB at render time.
//
//   npm run nrb:data -- <ledger-db-path> [<intake-db-path>]
//   env LK_NRB_LEDGER=... [LK_NRB_INTAKE=...] npm run nrb:data
//
// Falls back to data/nrb/nrb-ledger-report.json for both paths. The intake DB
// is optional and used only to carry the listing-row size label (stored in
// outbound_links.description); when missing, size is null. READ-ONLY by design:
// no DDL, no writes to either DB.
// ============================================================================

import { createRequire } from "node:module";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

type Row = Record<string, unknown>;
type DB = {
  prepare(sql: string): { get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[] };
};
function qa(db: DB, sql: string, ...args: unknown[]): Row[] {
  return db.prepare(sql).all(...args);
}

interface ReportJson {
  ledgerDbPath?: string;
  intakeDbPath?: string;
  observedAt?: string;
}

function resolve(target: string | undefined, env: string, fallbackInReport: (r: ReportJson) => string | undefined, label: string): string {
  const v = target ?? process.env[env] ?? fallbackInReport(lastReport);
  if (!v || v.startsWith("<")) {
    console.error(`USAGE: npm run nrb:data -- <ledger-db-path> [<intake-db-path>]   (or set ${env === "LK_NRB_LEDGER" ? "LK_NRB_LEDGER/LK_NRB_INTAKE" : env})`);
    process.exit(1);
  }
  if (!existsSync(v)) {
    console.error(`${label} not found: ${v}`);
    process.exit(1);
  }
  return v;
}

const lastReport: ReportJson = (() => {
  const p = join(process.cwd(), "data", "nrb", "nrb-ledger-report.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as ReportJson) : {};
})();

function main(): void {
  const ledgerPath = resolve(process.argv[2], "LK_NRB_LEDGER", (r) => r.ledgerDbPath, "ledger DB");
  const intakeTarget = process.argv[3] ?? process.env.LK_NRB_INTAKE ?? lastReport.intakeDbPath;
  const intakePath = intakeTarget && !intakeTarget.startsWith("<") && existsSync(intakeTarget) ? intakeTarget : undefined;
  const observedAt = typeof lastReport.observedAt === "string" ? lastReport.observedAt : "2026-06-20";

  const db = new Database(ledgerPath, { readonly: true });

  const sourcesMap = new Map<string, { title: string; publisher: string }>();
  for (const s of qa(db, "SELECT id, title, publisher FROM sources WHERE source_scope='NRB' ORDER BY id")) {
    sourcesMap.set(String(s.id), { title: String(s.title ?? s.id), publisher: String(s.publisher ?? "Nepal Rastra Bank") });
  }
  const instMap = new Map<string, { name: string; slug: string }>();
  for (const i of qa(db, "SELECT id, name_en, slug FROM institutions ORDER BY id")) {
    instMap.set(String(i.id), { name: String(i.name_en ?? i.id), slug: String(i.slug ?? i.id) });
  }

  const sizeByDoc = new Map<string, string>();
  if (intakePath) {
    const intake = new Database(intakePath, { readonly: true });
    for (const o of qa(intake, "SELECT source_id, target_url, description FROM outbound_links WHERE source_id LIKE 'nrb-%' AND target_type='DOCUMENT'")) {
      if (typeof o.description !== "string") continue;
      try {
        const meta = JSON.parse(o.description) as { size?: string };
        if (typeof meta.size === "string") sizeByDoc.set(`${o.source_id}\u0001${o.target_url}`, meta.size);
      } catch { /* ignore unparseable metadata */ }
    }
    intake.close();
  }

  const documents = qa(db, "SELECT id, title, doc_type, topic, official_url, published_at, source_id FROM nrb_documents ORDER BY doc_type ASC, published_at DESC, title ASC").map((row) => {
    const source = sourcesMap.get(String(row.source_id));
    const url = String(row.official_url ?? "");
    return {
      id: String(row.id),
      title: String(row.title),
      docType: String(row.doc_type),
      topic: row.topic ? String(row.topic) : null,
      officialUrl: url,
      publishedAt: row.published_at ? String(row.published_at) : null,
      size: sizeByDoc.get(`${String(row.source_id)}\u0001${url}`) ?? null,
      sourceId: String(row.source_id),
      sourceTitle: source?.title ?? String(row.source_id),
    };
  });

  const links = qa(db, "SELECT id, institution_id, nrb_document_id, link_type, link_date FROM nrb_institution_links ORDER BY institution_id ASC, link_type ASC, link_date ASC").map((row) => {
    const inst = instMap.get(String(row.institution_id));
    return {
      id: String(row.id),
      institutionId: String(row.institution_id),
      institutionSlug: inst?.slug ?? String(row.institution_id),
      institutionName: inst?.name ?? String(row.institution_id),
      linkType: String(row.link_type),
      linkDate: row.link_date ? String(row.link_date) : null,
      nrbDocumentId: row.nrb_document_id ? String(row.nrb_document_id) : null,
    };
  });

  const events = qa(db, "SELECT id, institution_id, event_type, title, occurred_at, description FROM regulatory_events ORDER BY occurred_at DESC, institution_id ASC, title ASC").map((row) => {
    const inst = instMap.get(String(row.institution_id));
    return {
      id: String(row.id),
      institutionId: String(row.institution_id),
      institutionSlug: inst?.slug ?? String(row.institution_id),
      institutionName: inst?.name ?? String(row.institution_id),
      eventType: String(row.event_type),
      title: String(row.title),
      occurredAt: row.occurred_at ? String(row.occurred_at) : null,
      description: row.description ? String(row.description) : "",
    };
  });

  const breakdown = (rows: Array<{ docType?: string; linkType?: string; eventType?: string }>, key: "docType" | "linkType" | "eventType"): Record<string, number> => {
    const acc: Record<string, number> = {};
    for (const r of rows) acc[String(r[key])] = (acc[String(r[key])] ?? 0) + 1;
    return acc;
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    observedAt,
    documents: documents.length,
    documentsByType: breakdown(documents, "docType"),
    institutions: instMap.size,
    institutionLinks: links.length,
    institutionLinksByType: breakdown(links, "linkType"),
    regulatoryEvents: events.length,
    eventsByType: breakdown(events, "eventType"),
    sources: Array.from(sourcesMap.entries()).map(([id, s]) => ({ id, title: s.title, publisher: s.publisher })),
  };

  const body = `// Deterministic snapshot generated by scripts/generate-nrb-data.ts (read-only)
// from the NRB ledger DB. ${documents.length} documents,
// ${links.length} institution links, ${events.length} regulatory events.
import type { NrbSummary, NrbDocument, NrbInstitutionLink, NrbRegulatoryEvent } from "@/types";

export const nrbSummary: NrbSummary = ${JSON.stringify(summary, null, 2)};

export const nrbDocuments: NrbDocument[] = ${JSON.stringify(documents, null, 2)};

export const nrbInstitutionLinks: NrbInstitutionLink[] = ${JSON.stringify(links, null, 2)};

export const nrbRegulatoryEvents: NrbRegulatoryEvent[] = ${JSON.stringify(events, null, 2)};
`;

  const target = join(process.cwd(), "src", "data", "nrb.ts");
  writeFileSync(target, body);
  console.log(`WROTE ${target}`);
  console.log(`summary: ${documents.length} documents (${JSON.stringify(summary.documentsByType)}), ${links.length} links, ${events.length} events [ledger=${ledgerPath}]`);
  db.close();
}

main();