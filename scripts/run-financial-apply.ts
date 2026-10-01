// ============================================================================
// PHASE C — FINANCIAL EVIDENCE APPLICATION PASS (no discovery, no content reads).
//
// The base crawl recorded where financial documents live; this pass does the
// writing. It RE-FETCHES each located target under the frozen Phase C research
// budget (data/pilot/financial-pilot-budget.json), snapshots what it actually
// received, and asserts one FINANCIAL entity per observed document:
//
//   - A PDF/report target is itself the document: its URL, a title (filename),
//     and the deterministic document/rate kind are asserted. The file is
//     snapshotted as SKIPPED and never read, so no metric and no numeric rate
//     is ever asserted — a number this system cannot show byte-level is a claim
//     it cannot defend.
//   - An HTML directory page is scanned for same-host document links, each link
//     is classified (classifyFinancialDocument) and every classified document is
//     asserted. A link to a foreign host is a link, not the institution's
//     evidence, so it is never asserted.
//   - The six same-host interest/base-rate PDFs recorded as outbound_links in
//     the committed base evidence DB are re-fetched and asserted as RATE
//     notices with public identity resolution. (A seventh recorded rate link is
//     hosted off-domain and is deliberately skipped.)
//
// Every row lands UNVERIFIED. Idempotency is read-then-write; a repeat run adds
// nothing. Output is a dated evidence database plus data/pilot/financial-pilot-report.json.
//
//   npx tsx scripts/run-financial-apply.ts
//   npx tsx scripts/run-financial-apply.ts --db <path> --audit-only
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  ControlledFetcher,
  LocalSqliteEvidenceWriter,
  classifyFinancialDocument,
  applyFinancialDocument,
  planFinancialDocumentEvidence,
  FINANCIAL_ENTITY_TYPE,
  FINANCIAL_PARSER_VERSION,
  listOpenConflicts,
  nodeResolveHost,
} from "../lib/ingestion";
import { institutions as publicInstitutions } from "../src/data/institutions";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string, o?: unknown) => {
  prepare(s: string): {
    get(...a: unknown[]): Record<string, unknown> | undefined;
    all(...a: unknown[]): Record<string, unknown>[];
    run(...a: unknown[]): unknown;
  };
  exec(s: string): void;
  close(): void;
};

const BUDGET_FILE = "data/pilot/financial-pilot-budget.json";
const SOURCES_FILE = "data/pilot/pilot-sources.json";
const BASE_EVIDENCE_DB = "data/pilot/evidence/phase-o-2026-09-26-base-51-source.db";
const REPORT_JSON = "data/pilot/financial-pilot-report.json";
const DEFAULT_DB = "data/pilot/evidence/pilot-financials-ext-2026-10-01.db";

const DOC_EXT = /\.(?:pdf|docx?|xlsx?|pptx?)$/i;
const PARSER_VERSION = "financials-apply-v1";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

interface CapabilitySpec {
  capability: string;
  status: string;
  known_url: string | null;
  link_type: string;
}

interface PilotSource {
  id: string;
  source_type: string;
  institution_id: string | null;
  url: string;
  domain: string;
  title: string;
  publisher?: string;
  capabilities: CapabilitySpec[];
}

interface PhaseBudget {
  maxFetches: number;
  maxBytes: number;
}

interface Target {
  url: string;
  sourceId: string;
  institutionId: string;
  phase: "reports" | "archive" | "rates";
}

interface TargetResult {
  phase: Target["phase"];
  url: string;
  final_url: string | null;
  source: string;
  institution: string;
  http: number | null;
  bytes: number;
  content_type: string | null;
  extraction: "EXTRACTED" | "SKIPPED" | "FAILED" | "none";
  documents: number;
  asserted: number;
  status: string;
  detail: string;
}

function apexOf(host: string): string {
  const parts = host.split(".");
  while (parts.length > 2) parts.shift();
  return parts.join(".");
}

/** Same-host document links with their anchor text, read out of a page body. */
function financialAnchors(
  text: string,
  baseUrl: string,
): { url: string; title: string }[] {
  const host = new URL(baseUrl).hostname.toLowerCase();
  const apex = apexOf(host);
  const anchors = [...text.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#>]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const out: { url: string; title: string }[] = [];
  for (const m of anchors) {
    const raw = m[1];
    if (!/^(?:https?:|\/)/i.test(raw)) continue;
    let u: URL;
    try {
      u = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    const h = u.hostname.toLowerCase();
    if (h !== host && !h.endsWith(`.${apex}`) && apexOf(h) !== apex) continue;
    if (!DOC_EXT.test(u.pathname)) continue;
    let title = m[2].replace(/<[^>]*>?/g, "").replace(/\s+/g, " ").trim();
    if (!title) title = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    out.push({ url: `${u.origin}${u.pathname}`, title });
  }
  return out;
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

/** Seed with the PUBLIC registry's real slug and name, as the careers pass does. */
function seedDb(dbPath: string, sources: PilotSource[]): void {
  const schema = readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(dbPath);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);

  const publicById = new Map(publicInstitutions.map((i) => [i.id, i]));
  const seenInst = new Set<string>();

  for (const s of sources) {
    db.prepare(
      `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
       VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, ?, 1)`,
    ).run(s.id, s.url, s.domain, s.title, s.institution_id ?? null);

    if (s.institution_id && !seenInst.has(s.institution_id)) {
      const pub = publicById.get(s.institution_id);
      if (pub) {
        db.prepare(
          `INSERT OR IGNORE INTO institutions (id, slug, name_en, institution_type, status, source_id)
           VALUES (?, ?, ?, 'NATIONAL', 'ACTIVE', ?)`,
        ).run(s.institution_id, pub.slug, pub.name, s.id);
      }
      seenInst.add(s.institution_id);
    }

    db.prepare(
      `INSERT OR IGNORE INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
       VALUES (?, ?, ?, 'MFB_WEBSITE', ?, ?, 1, 1440)`,
    ).run(s.id, s.url, s.domain, s.institution_id, JSON.stringify({ capabilities: s.capabilities }));
  }

  db.prepare(
    `INSERT OR IGNORE INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
     VALUES ('r-financials', 'FINANCIAL_DOCUMENTS', 'financial document extraction', 'SANITY', 'WARN', 1, '{}')`,
  ).run();
  db.close();
}

/** The same-host rate/baserate PDFs recorded by the base crawl, in the base DB. */
function knownRateTargets(
  dbPath: string,
  pilotById: Map<string, PilotSource>,
): Target[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `SELECT institution_id, source_id, target_url
         FROM outbound_links
        WHERE target_type = 'DOCUMENT'
          AND availability_status = 'AVAILABLE'`,
    )
    .all() as { institution_id: string; source_id: string; target_url: string }[];
  db.close();

  const targets: Target[] = [];
  for (const r of rows) {
    if (!/rate/i.test(r.target_url)) continue;
    const src = pilotById.get(r.source_id);
    if (!src?.institution_id) continue;
    if (src.institution_id !== r.institution_id) continue;
    // Same-host only: a rate document on a third-party host is a link to
    // somewhere else, and this pipeline never asserts another site's file as an
    // institution's evidence.
    let t: URL;
    try {
      t = new URL(r.target_url);
    } catch {
      continue;
    }
    const domain = (src.domain || "").replace(/^www\./i, "").toLowerCase();
    const host = t.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host.endsWith(domain) && host !== domain && !domain.endsWith(host)) continue;
    targets.push({
      url: r.target_url,
      sourceId: r.source_id,
      institutionId: r.institution_id,
      phase: "rates",
    });
  }
  return targets;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const budgetCfg = readJson<{ shared: Record<string, number>; phases: Record<string, PhaseBudget> }>(BUDGET_FILE);
  const pilot = readJson<{ sources: PilotSource[] }>(SOURCES_FILE);
  const pilotById = new Map(pilot.sources.map((s) => [s.id, s]));

  const targets: Target[] = [];
  for (const s of pilot.sources) {
    if (!s.institution_id) continue;
    for (const c of s.capabilities) {
      if (!c.known_url) continue;
      if (c.capability === "REPORTS") targets.push({ url: c.known_url, sourceId: s.id, institutionId: s.institution_id, phase: "reports" });
      else if (c.capability === "DOCUMENT_ARCHIVE") targets.push({ url: c.known_url, sourceId: s.id, institutionId: s.institution_id, phase: "archive" });
    }
  }
  const seen = new Set<string>();
  const uniqueTargets = targets.filter((t) => {
    const k = `${t.phase}:${t.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const rateTargets = knownRateTargets(BASE_EVIDENCE_DB, pilotById);
  const allTargets = [...uniqueTargets, ...rateTargets];

  const byPhase = (ph: Target["phase"]) => allTargets.filter((t) => t.phase === ph);
  console.log(
    `financial targets: ${allTargets.length} (reports ${byPhase("reports").length}, archive ${byPhase("archive").length}, rates ${byPhase("rates").length})`,
  );

  const argDb = flag("db");
  const auditOnly = has("audit-only");
  const dbPath = argDb ?? DEFAULT_DB;
  const needsSeed = !auditOnly && !existsSync(dbPath);
  if (needsSeed) {
    mkdirSync(join(process.cwd(), "data", "pilot", "evidence"), { recursive: true });
    const seedSources = pilot.sources.filter((s) => allTargets.some((t) => t.sourceId === s.id));
    seedDb(dbPath, seedSources);
    console.log(`seeded: ${dbPath}`);
  }

  const writer = new LocalSqliteEvidenceWriter(dbPath);
  const runId = `financials-apply-${new Date().toISOString().slice(0, 10)}`;
  const results: TargetResult[] = [];
  let fetches = 0;
  let bytes = 0;

  if (!auditOnly) {
    for (const phase of ["reports", "archive", "rates"] as const) {
      const phaseBudget = budgetCfg.phases[phase];
      const policy = {
        maxBytes: phaseBudget.maxBytes,
        maxRedirects: budgetCfg.shared.maxRedirects,
        maxRetries: budgetCfg.shared.maxRetries,
        timeoutMs: 20000,
        minIntervalMs: 250,
        resolveHost: nodeResolveHost,
      };
      let phaseFetched = 0;
      for (const [i, t] of byPhase(phase).entries()) {
        if (phaseFetched >= phaseBudget.maxFetches) break;
        if (Date.now() - startedAt > budgetCfg.shared.maxRuntimeMs) break;

        const fetcher = new ControlledFetcher({
          allowedHosts: [new URL(t.url).hostname],
          allowSubdomainsOf: [new URL(t.url).hostname.replace(/^www\./i, "")],
          ...policy,
        });

        const observedAt = new Date().toISOString();
        let fetchError: string | null = null;
        let body: Uint8Array | null = null;
        let contentType: string | null = null;
        let contentHash: string | null = null;
        let httpStatus: number | null = null;
        let finalUrl = t.url;
        let bodyBytes = 0;
        let fetchedAt = observedAt;

        phaseFetched++;
        fetches++;
        try {
          const r = (await fetcher.fetchControlled({ url: t.url, requestId: `fc-apply-${phase}-${i}` })).result;
          body = r.body;
          contentType = r.contentType;
          contentHash = r.contentHash ?? null;
          httpStatus = r.httpStatus ?? null;
          finalUrl = r.finalUrl ?? t.url;
          bodyBytes = r.bodyBytes;
          fetchedAt = r.fetchedAt ?? observedAt;
          bytes += bodyBytes;
        } catch (e) {
          fetchError = (e as { message?: string }).message ?? String(e);
        }

        const lowerCt = (contentType ?? "").toLowerCase();
        const localDoc = DOC_EXT.test(new URL(t.url).pathname);
        const isDocument = body !== null && (lowerCt.includes("application/pdf") || localDoc);

        let snapId: string | null = null;
        let extraction: TargetResult["extraction"] = "none";
        let documents = 0;
        let asserted = 0;

        if (body !== null && bodyBytes > 0) {
          const hash = contentHash ?? createHash("sha256").update(body).digest("hex");
          snapId = await writer.saveSnapshot({
            sourceId: t.sourceId,
            fetchedAt,
            contentHash: hash,
            httpStatus,
            mimeType: contentType,
            r2Key: null,
            parserVersion: PARSER_VERSION,
            extractionStatus: isDocument ? "SKIPPED" : "EXTRACTED",
          });
          extraction = isDocument ? "SKIPPED" : "EXTRACTED";
          await writer.appendAudit({
            action: "FINANCIAL_APPLY_FETCHED",
            targetType: "ingestion_item",
            targetId: t.sourceId,
            afterJson: JSON.stringify({ url: t.url, finalUrl, httpStatus, contentType, bytes: bodyBytes, phase }),
          });

          if (isDocument) {
            // The target itself is a document: assert it if its name reads as
            // financial. Nothing inside the file is ever read.
            documents = 1;
            const classification = classifyFinancialDocument(t.url, t.url);
            if (classification.role !== "NONE") {
              // No title is passed: a bare document target has no anchor text,
              // and the planner falls back to the filename. This keeps the row
              // identical to the one the directory-page scan writes for the same
              // entity, so the two phases cannot re-churn each other's title.
              const plan = planFinancialDocumentEvidence({
                institutionId: t.institutionId,
                url: t.url,
                classification,
              });
              const out = await applyFinancialDocument(writer, plan, {
                sourceId: t.sourceId,
                sourceSnapshotId: snapId,
                observedAt,
                runId,
              });
              if (out.status !== "UNCHANGED") asserted = out.fieldsWritten;
              else asserted = plan.assertions.length; // present in a previous run
            }
          } else {
            const text = new TextDecoder("utf-8", { fatal: false }).decode(body);
            const links = [...new Map(financialAnchors(text, finalUrl).map((l) => [l.url, l])).values()];
            for (const link of links) {
              const classification = classifyFinancialDocument(link.url, link.title);
              if (classification.role === "NONE") continue;
              documents++;
              const plan = planFinancialDocumentEvidence({
                institutionId: t.institutionId,
                url: link.url,
                title: link.title || undefined,
                classification,
              });
              const out = await applyFinancialDocument(writer, plan, {
                sourceId: t.sourceId,
                sourceSnapshotId: snapId,
                observedAt,
                runId,
              });
              if (out.status !== "UNCHANGED") asserted += out.fieldsWritten;
              else asserted += plan.assertions.length;
            }
          }
        }

        const detail = fetchError
          ? `fetch failed: ${fetchError.slice(0, 160)}`
          : bodyBytes === 0
            ? "empty body"
            : isDocument
              ? documents === 0
                ? "document did not classify as financial"
                : "document asserted"
              : `${documents} financial document(s) on page, ${asserted} field(s) asserted`;
        const status =
          fetchError !== null
            ? "FETCH_FAILED"
            : body === null
              ? "NO_BODY"
              : isDocument
                ? documents > 0
                  ? "FINANCIAL_DOCUMENT"
                  : "OBSERVED_NO_FINANCIAL"
                : documents > 0
                  ? "FINANCIAL_LINKS"
                  : "OBSERVED_NO_FINANCIAL";

        results.push({
          phase,
          url: t.url,
          final_url: finalUrl,
          source: t.sourceId,
          institution: t.institutionId,
          http: httpStatus,
          bytes: bodyBytes,
          content_type: contentType,
          extraction,
          documents,
          asserted,
          status,
          detail,
        });
        console.log(
          ` [${phase[0].toUpperCase()}] ${t.sourceId.padEnd(24)} ${String(httpStatus ?? "-").padStart(3)} ${status.padEnd(20)} ${String(documents).padStart(2)} docs ${String(asserted).padStart(2)} asserted ${t.url}` +
            (fetchError ? `  [${fetchError.slice(0, 90)}]` : ""),
        );
      }
    }
  }

  // ------------------------------------------------------------------ audit
  const db = new Database(dbPath, { readonly: true });
  const q = (sql: string, ...a: unknown[]): Record<string, unknown>[] => db.prepare(sql).all(...a);
  const open = listOpenConflicts(dbPath);

  const audit = {
    assertionsTotal: (db.prepare("SELECT COUNT(*) c FROM data_assertions WHERE entity_type='FINANCIAL'").get() as { c: number }).c,
    assertionsUnverified: (db.prepare("SELECT COUNT(*) c FROM data_assertions WHERE entity_type='FINANCIAL' AND verification_status='UNVERIFIED'").get() as { c: number }).c,
    distinctDocuments: (db.prepare("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions WHERE entity_type='FINANCIAL'").get() as { c: number }).c,
    reportDocuments: (db.prepare("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions WHERE entity_type='FINANCIAL' AND field_name='DOCUMENT_TYPE'").get() as { c: number }).c,
    rateNotices: (db.prepare("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions WHERE entity_type='FINANCIAL' AND field_name='RATE_KIND'").get() as { c: number }).c,
    byField: q("SELECT field_name, COUNT(*) n, COUNT(DISTINCT value) vals FROM data_assertions WHERE entity_type='FINANCIAL' GROUP BY 1 ORDER BY 2 DESC"),
    byStatus: q("SELECT verification_status, COUNT(*) n FROM data_assertions WHERE entity_type='FINANCIAL' GROUP BY 1"),
    byConfidence: q("SELECT confidence, COUNT(*) n, COUNT(DISTINCT entity_id) entities FROM data_assertions WHERE entity_type='FINANCIAL' GROUP BY 1 ORDER BY 1"),
    byKind: q(
      `SELECT COALESCE((SELECT value FROM data_assertions x WHERE x.entity_type='FINANCIAL' AND x.entity_id=a.entity_id AND x.field_name IN ('RATE_KIND','DOCUMENT_TYPE') LIMIT 1),'none') kind,
              COUNT(DISTINCT a.entity_id) entities
         FROM data_assertions a WHERE a.entity_type='FINANCIAL'
        GROUP BY 1 ORDER BY 2 DESC`,
    ),
    provenanceOrphans: q(
      `SELECT a.id, a.field_name, a.value, a.source_id, a.source_snapshot_id
         FROM data_assertions a
        WHERE a.entity_type='FINANCIAL'
          AND (a.source_snapshot_id IS NULL
               OR a.observed_at IS NULL
               OR NOT EXISTS (SELECT 1 FROM source_snapshots ss WHERE ss.id = a.source_snapshot_id)
               OR NOT EXISTS (SELECT 1 FROM sources s WHERE s.id = a.source_id))`,
    ),
    snapshotFieldsMissing: q(
      `SELECT ss.id, ss.http_status, ss.mime_type, ss.content_hash, ss.fetched_at, s.source_grade
         FROM source_snapshots ss JOIN sources s ON s.id = ss.source_id
        WHERE ss.id IN (SELECT source_snapshot_id FROM data_assertions WHERE entity_type='FINANCIAL')
          AND (ss.content_hash IS NULL OR ss.content_hash = '' OR ss.mime_type IS NULL
               OR ss.fetched_at IS NULL OR s.source_grade IS NULL)`,
    ),
    usage: {
      targets: allTargets.length,
      byPhase: { reports: byPhase("reports").length, archive: byPhase("archive").length, rates: byPhase("rates").length },
      fetches,
      bytes,
      elapsedMs: Date.now() - startedAt,
    },
  };
  db.close();

  console.log("\n== provenance audit");
  console.log(`financial assertions: ${audit.assertionsTotal} (UNVERIFIED ${audit.assertionsUnverified}, distinct documents ${audit.distinctDocuments}, rate notices ${audit.rateNotices})`);
  console.log(`provenance orphans: ${audit.provenanceOrphans.length}`);
  console.log(`snapshots with missing hash/mime/clock/grade: ${audit.snapshotFieldsMissing.length}`);
  console.log(`open conflicts: ${open.length}`);
  for (const c of open) console.log(`  conflict: ${c.fieldName} ${c.valueA} <> ${c.valueB} (${c.sourceAId} / ${c.sourceBId})`);

  if (!auditOnly) {
    writeFileSync(
      REPORT_JSON,
      JSON.stringify(
        {
          $schema: "pilot-financials-evidence/v1",
          generated_at: new Date().toISOString(),
          db_path: dbPath,
          budget: BUDGET_FILE,
          base_evidence_db: BASE_EVIDENCE_DB,
          results,
          audit,
          open_conflicts: open,
        },
        null,
        2,
      ),
    );
    console.log(`\nreport written: ${REPORT_JSON}`);
  }
}

main().catch((e) => {
  console.error("Phase C financials apply failed:", e);
  process.exit(1);
});