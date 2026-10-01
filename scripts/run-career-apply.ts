// ============================================================================
// M3.5-CAREERS — EVIDENCE APPLICATION PASS (no discovery).
//
// The discovery pass (scripts/run-career-pilot.ts) is observation-only by
// design: it classifies every located CAREER_PAGE URL and deliberately writes
// no assertions, so the committed registry (data/pilot/career-source-registry.json)
// can never be mistaken for a published vacancy. This pass does the writing.
//
// It RE-FETCHES each page the registry recorded (fresh bytes, fresh snapshot),
// analyses the body it actually received, plans vacancy records with
// planVacancyEvidence and unread vacancy documents with
// planVacancyDocumentEvidence, and applies them through the real SQLite
// evidence writer (LocalSqliteEvidenceWriter). Three things follow:
//
//   - Every assertion is traced to the snapshot the value was observed in.
//     Nothing recorded by discovery is asserted against a snapshot that does
//     not contain it: the registry is a list of where to look, not a list of
//     values, and the apply pass only asserts what its own fetch received.
//   - Every row lands UNVERIFIED. Nothing is auto-promoted.
//   - Fetches are bounded by data/pilot/career-pilot-budget.json, a one-off
//     research budget that is deliberately separate from the frozen production
//     budget (data/pilot/pilot-budget.json, which this script never reads).
//
// A vacancy document (a PDF/JPG notice) is asserted as a document and nothing
// else: its text is not extracted, so no field inside it is supported by any
// byte this system can show. A vacancy whose institution id is unknown is not
// applied - identity is institution-scoped and a placeholder id would collide
// with a real one.
//
// No URL is invented. No field is invented. Cross-source disagreements are
// recorded as conflicts and both values stay readable. Output is a dated
// evidence database plus data/pilot/pilot-careers-report.json.
//
//   npx tsx scripts/run-career-apply.ts
//   npx tsx scripts/run-career-apply.ts --db <path>
//   npx tsx scripts/run-career-apply.ts --db <path> --audit-only
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  ControlledFetcher,
  analyzeCareerPage,
  classifyDocumentLink,
  listOpenConflicts,
  LocalSqliteEvidenceWriter,
  nodeResolveHost,
} from "../lib/ingestion";
import {
  applyVacancyDocument,
  applyVacancyEvidence,
  planVacancyDocumentEvidence,
  planVacancyEvidence,
} from "../lib/ingestion/career-evidence";
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

const BUDGET_FILE = "data/pilot/career-pilot-budget.json";
const SOURCES_FILE = "data/pilot/pilot-sources.json";
const REGISTRY_FILE = "data/pilot/career-source-registry.json";
const REPORT_JSON = "data/pilot/pilot-careers-report.json";
const DEFAULT_DB = "data/pilot/evidence/pilot-careers-ext-2026-10-01.db";

const NON_HTML_DOC_EXT = /\.(?:pdf|docx?|xlsx?|pptx?|csv|zip)$/i;
const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|bmp|tiff?)$/i;
/** The apply pass asserts document evidence, so the snapshot is EXTRACTED when
 * parseable; a document body is recorded as SKIPPED, exactly like the engine. */
const PARSER_VERSION = "careers-apply-v1";

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
  note?: string;
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

interface Entry {
  institution_id: string | null;
  source_id: string;
  url: string;
}

interface PhaseBudget {
  maxFetches: number;
  maxBytes: number;
  maxFetchesPerSource?: number;
}

interface Target {
  url: string;
  sourceId: string;
  institutionId: string | null;
  phase: "primary" | "detail";
}

interface PageResult {
  phase: "primary" | "detail";
  url: string;
  final_url: string | null;
  source: string;
  institution: string | null;
  http: number | null;
  bytes: number;
  content_type: string | null;
  extraction: "EXTRACTED" | "SKIPPED" | "FAILED" | "none";
  records: number;
  vacancies_applied: number;
  document_entities: number;
  status: string;
  detail: string;
}

function apexOf(host: string): string {
  const parts = host.split(".");
  while (parts.length > 2) parts.shift();
  return parts.join(".");
}

/**
 * Same-host document and image URLs on a page. Only in-body references to the
 * institution's own site count as its evidence; a linked PDF elsewhere is a
 * link, not an observed document. Mirrors run-career-pilot's routing so the
 * apply pass and the discovery pass treat the same bytes the same way.
 */
function linksFrom(text: string, baseUrl: string): { documents: string[]; images: string[] } {
  const host = new URL(baseUrl).hostname.toLowerCase();
  const apex = apexOf(host);
  const hrefs = [...text.matchAll(/(?:href|src)\s*=\s*["']([^"'#>]+)["']/gi)]
    .map((m) => m[1])
    .filter((raw) => /^(?:https?:|\/)/i.test(raw));
  const docs: string[] = [];
  const images: string[] = [];
  for (const raw of new Set(hrefs)) {
    let u: URL;
    try {
      u = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    const h = u.hostname.toLowerCase();
    if (h !== host && !h.endsWith(`.${apex}`) && apexOf(h) !== apex) continue;
    if (IMAGE_EXT.test(u.pathname)) images.push(`${u.origin}${u.pathname}`);
    else if (NON_HTML_DOC_EXT.test(u.pathname)) {
      if (/\.pdf$/i.test(u.pathname)) docs.push(`${u.origin}${u.pathname}`);
    }
  }
  return { documents: [...new Set(docs)], images: [...new Set(images)] };
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

/** Seed institutions with the PUBLIC registry's real slug and name. */
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
      // The public institutions module is the app's own committed registry of
      // these institutions. A pilot institution that is not in it is left out:
      // the build's LEFT JOIN then marks the gap instead of inventing a name.
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
     VALUES ('r-vacancies', 'VACANCIES', 'career vacancy extraction', 'SANITY', 'WARN', 1, '{}')`,
  ).run();
  db.close();
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const budgetCfg = readJson<{ shared: Record<string, number>; phases: { primary: PhaseBudget; detail: PhaseBudget } }>(BUDGET_FILE);
  const registry = readJson<{ entries: Entry[]; detail_entries: Entry[] }>(REGISTRY_FILE);
  const pilot = readJson<{ sources: PilotSource[] }>(SOURCES_FILE);
  const pilotById = new Map(pilot.sources.map((s) => [s.id, s]));

  const targets: Target[] = [
    ...registry.entries.map((e) => ({
      url: e.url,
      sourceId: e.source_id,
      institutionId: e.institution_id,
      phase: "primary" as const,
    })),
    ...registry.detail_entries.map((e) => ({
      url: e.url,
      sourceId: e.source_id,
      institutionId: e.institution_id,
      phase: "detail" as const,
    })),
  ];
  console.log(`apply targets: ${targets.length} (primary ${registry.entries.length}, detail ${registry.detail_entries.length})`);

  // The DB is accumulated across runs by default; --audit-only never touches it.
  // Schema + seed rows are written only when the database is first created.
  const argDb = flag("db");
  const auditOnly = has("audit-only");
  const dbPath = argDb ?? DEFAULT_DB;
  const needsSeed = !auditOnly && !existsSync(dbPath);
  if (needsSeed) {
    mkdirSync(join(process.cwd(), "data", "pilot", "evidence"), { recursive: true });
    seedDb(dbPath, pilot.sources.filter((s) => targets.some((t) => t.sourceId === s.id)));
    console.log(`seeded: ${dbPath}`);
  }

  const writer = new LocalSqliteEvidenceWriter(dbPath);
  const runId = `careers-apply-${new Date().toISOString().slice(0, 10)}`;
  const results: PageResult[] = [];
  let fetches = 0;
  let bytes = 0;

  if (!auditOnly) {
    for (const phase of ["primary", "detail"] as const) {
      const phaseBudget = budgetCfg.phases[phase];
      // The same fetch policy that bounded the pilot: controlled host, per-page
      // byte cap, bounded redirects and retries, and a quiet interval.
      const policy = {
        maxBytes: phaseBudget.maxBytes,
        maxRedirects: budgetCfg.shared.maxRedirects,
        maxRetries: budgetCfg.shared.maxRetries,
        timeoutMs: 15000,
        minIntervalMs: 250,
        resolveHost: nodeResolveHost,
      };
      let phaseFetched = 0;
      for (const [i, t] of targets.filter((x) => x.phase === phase).entries()) {
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
          const r = (await fetcher.fetchControlled({ url: t.url, requestId: `m35-apply-${phase}-${i}` })).result;
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

        const institutionId = pilotById.get(t.sourceId)?.institution_id ?? t.institutionId;

        const lowerCt = (contentType ?? "").toLowerCase();
        const localDoc = NON_HTML_DOC_EXT.test(new URL(t.url).pathname);
        const isDocument = body !== null && (lowerCt.includes("application/pdf") || localDoc);

        // 1. Snapshot first: every assertion below must point at the snapshot
        //    the value was actually observed in.
        let snapId: string | null = null;
        let extraction: PageResult["extraction"] = "none";
        let records = 0;
        let vacanciesApplied = 0;
        let documentEntities = 0;

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
            action: "CAREER_APPLY_FETCHED",
            targetType: "ingestion_item",
            targetId: t.sourceId,
            afterJson: JSON.stringify({ url: t.url, finalUrl, httpStatus, contentType, bytes: bodyBytes, phase }),
          });

          if (!isDocument) {
            const text = new TextDecoder("utf-8", { fatal: false }).decode(body);
            let json: unknown[] | undefined;
            if (lowerCt.includes("json")) {
              try {
                const parsed = JSON.parse(text) as unknown;
                if (Array.isArray(parsed)) json = parsed;
                else if (parsed && typeof parsed === "object") {
                  const cand = Object.values(parsed as Record<string, unknown>).find((v) => Array.isArray(v));
                  if (Array.isArray(cand)) json = cand;
                }
              } catch {
                /* not JSON after all */
              }
            }
            const analysis = analyzeCareerPage({
              body,
              contentType,
              url: finalUrl,
              httpStatus: httpStatus ?? 0,
              json,
            });
            records = analysis.records.length;

            // 2. Vacancy records: plan + apply on the fresh analysis.
            if (institutionId) {
              for (const rec of analysis.records) {
                if (!rec.title) continue; // no identity without a title
                const planned = planVacancyEvidence(rec, institutionId);
                const applied = await applyVacancyEvidence(writer, planned, {
                  sourceId: t.sourceId,
                  sourceSnapshotId: snapId,
                  observedAt,
                  runId,
                });
                vacanciesApplied += applied.newCount + applied.changedCount;
              }
            }

            // 3. Unread vacancy documents: the notice is asserted as a document,
            //    nothing inside it. One entity per document URL.
            const { documents, images } = linksFrom(text, finalUrl);
            const vacancyDocs = [...documents, ...images].filter((u) => classifyDocumentLink(u) === "VACANCY");
            if (institutionId) {
              for (const docUrl of new Set(vacancyDocs)) {
                const plan = planVacancyDocumentEvidence({
                  institutionId,
                  url: docUrl,
                  label: docUrl, // distinct document URL => distinct entity
                });
                const out = await applyVacancyDocument(writer, plan, {
                  sourceId: t.sourceId,
                  sourceSnapshotId: snapId,
                  observedAt,
                  runId,
                });
                if (out.status === "NEW" || out.status === "CHANGED") documentEntities++;
              }
            }
          } else if (vacancyDocOf(t.url)) {
            // A PDF located as a CAREER_PAGE target is itself a vacancy-shaped
            // document: assert it as one, nothing more.
            if (institutionId) {
              const plan = planVacancyDocumentEvidence({ institutionId, url: t.url, label: t.url });
              const out = await applyVacancyDocument(writer, plan, {
                sourceId: t.sourceId,
                sourceSnapshotId: snapId,
                observedAt,
                runId,
              });
              if (out.status === "NEW" || out.status === "CHANGED") documentEntities++;
            }
          }
        }

        const detail = fetchError
          ? `fetch failed: ${fetchError.slice(0, 160)}`
          : bodyBytes === 0
            ? "empty body"
            : `${records} record(s), ${vacanciesApplied} vacancy applied, ${documentEntities} document asserted`;
        const status =
          fetchError !== null
            ? "FETCH_FAILED"
            : body === null
              ? "NO_BODY"
              : isDocument
                ? "DOCUMENT"
                : records > 0 && vacanciesApplied > 0
                  ? "VACANCY_PUBLISHED"
                  : documentEntities > 0
                    ? "VACANCY_DOCUMENT"
                    : "OBSERVED_NO_VACANCY";

        results.push({
          phase,
          url: t.url,
          final_url: finalUrl,
          source: t.sourceId,
          institution: institutionId,
          http: httpStatus,
          bytes: bodyBytes,
          content_type: contentType,
          extraction,
          records,
          vacancies_applied: vacanciesApplied,
          document_entities: documentEntities,
          status,
          detail,
        });
        console.log(
          ` [${phase === "primary" ? "P" : "D"}] ${t.sourceId.padEnd(24)} ${String(httpStatus ?? "-").padStart(3)} ${status.padEnd(20)} ${String(records).padStart(2)} records ${String(vacanciesApplied).padStart(2)} applied ${String(documentEntities).padStart(2)} docs ${t.url}` +
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
    assertionsTotal: (db.prepare("SELECT COUNT(*) c FROM data_assertions WHERE entity_type='VACANCY'").get() as { c: number }).c,
    assertionsUnverified: (db.prepare("SELECT COUNT(*) c FROM data_assertions WHERE entity_type='VACANCY' AND verification_status='UNVERIFIED'").get() as { c: number }).c,
    distinctVacancies: (db.prepare("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions WHERE entity_type='VACANCY'").get() as { c: number }).c,
    documentsAsserted: (db.prepare("SELECT COUNT(*) c FROM data_assertions WHERE entity_type='VACANCY' AND field_name='SOURCE_DOCUMENT'").get() as { c: number }).c,
    byField: q("SELECT field_name, COUNT(*) n, COUNT(DISTINCT value) vals FROM data_assertions WHERE entity_type='VACANCY' GROUP BY 1 ORDER BY 2 DESC"),
    byStatus: q("SELECT verification_status, COUNT(*) n FROM data_assertions WHERE entity_type='VACANCY' GROUP BY 1"),
    byConfidence: q("SELECT confidence, COUNT(*) n, COUNT(DISTINCT entity_id) entities FROM data_assertions WHERE entity_type='VACANCY' GROUP BY 1 ORDER BY 1"),
    provenanceOrphans: q(
      `SELECT a.id, a.field_name, a.value, a.source_id, a.source_snapshot_id
         FROM data_assertions a
        WHERE a.entity_type='VACANCY'
          AND (a.source_snapshot_id IS NULL
               OR a.observed_at IS NULL
               OR NOT EXISTS (SELECT 1 FROM source_snapshots ss WHERE ss.id = a.source_snapshot_id)
               OR NOT EXISTS (SELECT 1 FROM sources s WHERE s.id = a.source_id))`,
    ),
    snapshotFieldsMissing: q(
      `SELECT ss.id, ss.http_status, ss.mime_type, ss.content_hash, ss.fetched_at, s.source_grade
         FROM source_snapshots ss JOIN sources s ON s.id = ss.source_id
        WHERE ss.id IN (SELECT source_snapshot_id FROM data_assertions WHERE entity_type='VACANCY')
          AND (ss.content_hash IS NULL OR ss.content_hash = '' OR ss.mime_type IS NULL
               OR ss.fetched_at IS NULL OR s.source_grade IS NULL)`,
    ),
    assertions: q(
      `SELECT a.source_id, a.entity_id, a.field_name, a.value, a.verification_status, a.confidence, a.observed_at,
              a.source_snapshot_id, ss.content_hash, s.source_grade
         FROM data_assertions a
         JOIN source_snapshots ss ON ss.id = a.source_snapshot_id
         JOIN sources s ON s.id = a.source_id
        WHERE a.entity_type='VACANCY'
        ORDER BY a.source_id, a.entity_id, a.field_name`,
    ),
    usage: {
      targets: targets.length,
      fetches,
      bytes,
      elapsedMs: Date.now() - startedAt,
      maxFetchesPrimary: budgetCfg.phases.primary.maxFetches,
      maxFetchesDetail: budgetCfg.phases.detail.maxFetches,
    },
  };
  db.close();

  console.log("\n== provenance audit");
  console.log(`vacancy assertions: ${audit.assertionsTotal} (UNVERIFIED ${audit.assertionsUnverified}, distinct vacancies ${audit.distinctVacancies}, documents ${audit.documentsAsserted})`);
  console.log(`provenance orphans: ${audit.provenanceOrphans.length}`);
  console.log(`snapshots with missing hash/mime/clock/grade: ${audit.snapshotFieldsMissing.length}`);
  console.log(`open conflicts: ${open.length}`);
  for (const c of open) console.log(`  conflict: ${c.fieldName} ${c.valueA} <> ${c.valueB} (${c.sourceAId} / ${c.sourceBId})`);

  if (!auditOnly) {
    writeFileSync(
      REPORT_JSON,
      JSON.stringify(
        {
          $schema: "pilot-careers-evidence/v1",
          generated_at: new Date().toISOString(),
          db_path: dbPath,
          registry: REGISTRY_FILE,
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

/** A bare document URL (no html around it) whose filename reads as a vacancy. */
function vacancyDocOf(url: string): boolean {
  return classifyDocumentLink(url) === "VACANCY";
}

main().catch((e) => {
  console.error("M3.5 careers apply failed:", e);
  process.exit(1);
});