// ============================================================================
// Phase M3.4-PILOT =? controlled real-source Branch Directory validation.
//
// Same pipeline as scripts/run-pilot-people.ts (controlled fetcher, per-run
// budgets, evidence writer, snapshot mechanism, deterministic extractor,
// validator contract, assertion lifecycle, provenance, audit trail) but scoped
// to the BRANCH_DIRECTORY capability only, so a Branch milestone never
// silently spends the crawl budget of another capability.
//
// Scope rules (deliberate, not oversights):
//   - Only sources whose pilot config declares a BRANCH_DIRECTORY known_url are
//     fetched. With M3.4 the 18 structurally verified branch pages were
//     re-pointed into data/pilot/pilot-sources.json by
//     scripts/apply-branch-target-corrections.ts, so the config IS the
//     verified target list. No URL is invented and no per-MFB code/branch
//     exists anywhere in this file.
//   - Budgets come from data/pilot/pilot-budget.json unchanged. If a budget is
//     insufficient the run reports it; it never raises a limit.
//   - Evidence lands UNVERIFIED. Nothing is auto-promoted, nothing is deleted.
//   - Branch attributes (district/place/address/phone/...) are deliberately
//     evidence-only (0.45 below the 0.5 assertion gate) and never assert.
//
// Run: npx tsx scripts/run-pilot-branches.ts --db data/pilot/evidence/pilot-branches-ext-<date>.db
//      npx tsx scripts/run-pilot-branches.ts --repeat   (pass 2, idempotency)
//      npx tsx scripts/run-pilot-branches.ts --diagnose (shape report, no writes)
//      npx tsx scripts/run-pilot-branches.ts --db <path> --audit-only
// ============================================================================

import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BrowserDiscovery,
  DISCOVERY_HINT_RULES,
  buildEngine,
  branchDirectoryExtractor,
  ControlledFetcher,
  deterministicHtmlCanonicalizer,
  listOpenConflicts,
  LocalSqliteEvidenceWriter,
  LocalSourceRegistry,
  nodeResolveHost,
  structuredValidators,
} from "../lib/ingestion";
import type { SourceRegistry, IngestionSourceSpec, CapabilitySpec } from "../lib/ingestion";

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

interface PilotCapability {
  capability: string;
  status: string;
  known_url: string | null;
  link_type: string;
  note?: string;
}

interface PilotRecord {
  id: string;
  source_type: string;
  institution_id: string;
  url: string;
  domain: string;
  title?: string;
  publisher?: string;
  capabilities: PilotCapability[];
}

interface Budget {
  maxTargets?: number;
  maxFetches?: number;
  maxDocuments?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxRetries?: number;
  maxRuntimeMs?: number;
}

const PILOT_JSON = join(process.cwd(), "data", "pilot", "pilot-sources.json");
const BUDGET_JSON = join(process.cwd(), "data", "pilot", "pilot-budget.json");
const DISCOVERY_JSON = join(process.cwd(), "data", "pilot", "branch-url-discovery.json");
const REPORT_JSON = join(process.cwd(), "data", "pilot", "pilot-branches-report.json");

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

/** Only the BRANCH_DIRECTORY capability is in scope for this milestone. */
const isBranch = (c: CapabilitySpec): boolean => c.kind === "BRANCH_DIRECTORY";

/** Source ids whose branch page was structurally verified by M3.4 discovery. */
function verifiedBranchSourceIds(): string[] {
  const discovery = JSON.parse(readFileSync(DISCOVERY_JSON, "utf8")) as {
    results: Array<{ sourceId: string; verified: Array<{ verdict: string; url: string }> }>;
  };
  const out: string[] = [];
  for (const r of discovery.results) {
    if (r.verified.some((v) => v.verdict === "VERIFIED_BRANCH_DIRECTORY")) out.push(r.sourceId);
  }
  return out.sort();
}

/**
 * Generic decorator: narrows any registry's capabilities to BRANCH_DIRECTORY so
 * the engine cannot spend another capability's crawl budget. No per-institution
 * logic - the narrowing is by capability name only.
 */
class BranchScopedRegistry implements SourceRegistry {
  constructor(private readonly inner: SourceRegistry) {}
  async listEnabled(): Promise<IngestionSourceSpec[]> {
    return (await this.inner.listEnabled()).map((s) => ({ ...s, capabilities: s.capabilities.filter(isBranch) }));
  }
  async get(id: string): Promise<IngestionSourceSpec | null> {
    const s = await this.inner.get(id);
    return s ? { ...s, capabilities: s.capabilities.filter(isBranch) } : null;
  }
  async capabilitiesOf(id: string): Promise<CapabilitySpec[]> {
    return (await this.inner.capabilitiesOf(id)).filter(isBranch);
  }
  lastContentHash(sourceId: string, url: string): Promise<string | null> {
    return this.inner.lastContentHash(sourceId, url);
  }
  healthOf(id: string) {
    return this.inner.healthOf(id);
  }
  recordRun(outcome: Parameters<SourceRegistry["recordRun"]>[0]) {
    return this.inner.recordRun(outcome);
  }
}

/** Identical fetch policy to scripts/run-pilot.ts (no knob is relaxed here). */
function policyFor(url: string, budget: Budget) {
  const host = new URL(url).hostname;
  const apex = host.replace(/^www\./i, "");
  return {
    allowedHosts: [...new Set(apex === host ? [host] : [host, apex])],
    allowSubdomainsOf: [apex],
    maxBytes: budget.maxBytes,
    maxRedirects: budget.maxRedirects,
    maxRetries: budget.maxRetries,
    timeoutMs: 15000,
    minIntervalMs: 250,
    resolveHost: nodeResolveHost,
  };
}

/** Same scratch-DB seed as scripts/run-pilot.ts (scratch only, never lk.db). */
function seedDb(dbPath: string, sources: PilotRecord[]): void {
  const schema = readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(dbPath);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  for (const s of sources) {
    db.prepare(
      `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
       VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, ?, 1)`,
    ).run(s.id, s.url, s.domain, s.title ?? `${s.id} pilot source`, s.publisher ?? `pilot (${s.institution_id})`);
    db.prepare(
      `INSERT OR IGNORE INTO institutions (id, slug, name_en, institution_type, status, source_id)
       VALUES (?, ?, ?, 'NATIONAL', 'ACTIVE', ?)`,
    ).run(s.institution_id, s.institution_id, `${s.institution_id} (pilot stub)`, s.id);

    const caps = s.capabilities.slice();
    db.prepare(
      `INSERT OR IGNORE INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
       VALUES (?, ?, ?, 'MFB_WEBSITE', ?, ?, 1, 1440)`,
    ).run(s.id, s.url, s.domain, s.institution_id, JSON.stringify({ capabilities: caps }));
  }
  db.prepare(
    `INSERT OR IGNORE INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
     VALUES ('r-branch-directory', 'BRANCH_DIRECTORY', 'branch directory extraction', 'SANITY', 'WARN', 1, '{}')`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
     VALUES ('r-vacancies', 'VACANCIES', 'career vacancy extraction', 'SANITY', 'WARN', 1, '{}')`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
     VALUES ('r-financial-metadata', 'FINANCIAL_METADATA', 'financial metadata extraction', 'SANITY', 'WARN', 1, '{}')`,
  ).run();
  db.close();
}

interface SourceResult {
  institution: string;
  source: string;
  branchedUrl: string | null;
  capability: string;
  http: number | null;
  evidence: string;
  extracted: number;
  assertions: number;
  distinctBranches: number;
  jsRendered: boolean;
  status: string;
  detail: string;
}

async function main(): Promise<void> {
  const pilot = JSON.parse(readFileSync(PILOT_JSON, "utf8")) as { sources: PilotRecord[] };
  const budgetCfg = JSON.parse(readFileSync(BUDGET_JSON, "utf8")) as { defaults: Budget; perSource: Record<string, Budget> };

  const verified = new Set(verifiedBranchSourceIds());
  const withBranch = pilot.sources.filter((s) => s.capabilities.some((c) => c.capability === "BRANCH_DIRECTORY" && c.known_url));
  const verifiedInScope = withBranch.filter((s) => verified.has(s.id));
  const verifiedOutOfScope = withBranch.filter((s) => !verified.has(s.id));
  const withoutBranch = pilot.sources.filter((s) => !s.capabilities.some((c) => c.capability === "BRANCH_DIRECTORY" && c.known_url));

  console.log(`pilot universe: ${pilot.sources.length} sources`);
  console.log(`BRANCH_DIRECTORY capability declared with a verified known url: ${verifiedInScope.length}`);
  console.log(`BRANCH_DIRECTORY declared but NOT structurally verified this run: ${verifiedOutOfScope.length}`);
  console.log(`BRANCH_DIRECTORY = NOT_DISCOVERED in config: ${withoutBranch.length}`);

  const argDb = flag("db");
  const auditOnly = has("audit-only");
  const dbPath = argDb ?? join(mkdtempSync(join(tmpdir(), "lk-pilot-branches-")), "pilot-branches.db");
  const needsSeed = !auditOnly && (!argDb || !existsSync(dbPath));
  if (needsSeed) {
    seedDb(dbPath, pilot.sources);
    console.log(`branch pilot db seeded: ${dbPath}`);
  }

  const results: SourceResult[] = [];

  if (!auditOnly) {
    for (const s of verifiedInScope) {
      const cap = s.capabilities.find((c) => c.capability === "BRANCH_DIRECTORY") as PilotCapability | undefined;
      const branchUrl = cap?.known_url ?? null;
      const budget = { ...budgetCfg.defaults, ...(budgetCfg.perSource[s.id] ?? {}) };
      const policy = policyFor(s.url, budget);

      const registry = new LocalSourceRegistry(dbPath);
      const scoped = new BranchScopedRegistry(registry);
      const fetcher = new ControlledFetcher(policy);
      const engine = buildEngine({
        registry: scoped,
        fetcher,
        discovery: new BrowserDiscovery(scoped, new ControlledFetcher(policy), {
          rules: DISCOVERY_HINT_RULES,
          maxTargets: budget.maxTargets,
        }),
        extractor: branchDirectoryExtractor,
        writer: new LocalSqliteEvidenceWriter(dbPath),
        canonicalizer: deterministicHtmlCanonicalizer,
        validators: structuredValidators,
      });

      const nowIso = new Date().toISOString();
      const out = await engine.runSource(s.id, { budget, now: nowIso });

      const db = new Database(dbPath, { readonly: true });
      const runRows = db
        .prepare("SELECT id, status, items_found, items_changed, items_new, items_failed, error_count FROM ingestion_runs WHERE ingestion_source_id=? ORDER BY started_at DESC")
        .all(s.id) as Array<Record<string, unknown>>;
      const itemRows = db
        .prepare("SELECT url, item_type, status FROM ingestion_items WHERE run_id=?")
        .all(String(runRows[0]?.id ?? "")) as Array<Record<string, unknown>>;
      const snapRows = db
        .prepare("SELECT http_status, mime_type, extraction_status, content_hash FROM source_snapshots WHERE source_id=? ORDER BY fetched_at")
        .all(s.id) as Array<Record<string, unknown>>;
      const assertionRows = db
        .prepare("SELECT COUNT(*) c FROM data_assertions WHERE source_id=?")
        .get(s.id) as { c: number };
      const distinct = db
        .prepare("SELECT COUNT(DISTINCT value) c FROM data_assertions WHERE source_id=? AND field_name LIKE 'branch%'")
        .get(s.id) as { c: number };
      const statuses = db
        .prepare("SELECT status, COUNT(*) n FROM ingestion_items WHERE run_id=? GROUP BY 1")
        .all(String(runRows[0]?.id ?? "")) as Array<{ status: string; n: number }>;
      const errors = db
        .prepare("SELECT url, error_type, error_message FROM ingestion_errors WHERE ingestion_source_id=? ORDER BY created_at DESC LIMIT 5")
        .all(s.id) as Array<Record<string, unknown>>;
      db.close();

      const http = snapRows.length ? (snapRows[snapRows.length - 1].http_status as number) : null;
      const evidence = snapRows.length ? (snapRows[snapRows.length - 1].extraction_status as string) : "none";
      const result: SourceResult = {
        institution: s.institution_id,
        source: s.id,
        branchedUrl: branchUrl,
        capability: "BRANCH_DIRECTORY",
        http: http ?? null,
        evidence,
        extracted: assertionRows.c,
        assertions: assertionRows.c,
        distinctBranches: distinct.c,
        jsRendered: evidence === "EMPTY" && (snapRows[snapRows.length - 1]?.mime_type ?? "") === "text/html",
        status: out.ok ? "HEALTHY" : "PARTIAL",
        detail: itemRows.map((i) => `${i.status}:${i.url}`).join(" ; "),
      };
      results.push(result);
      console.log(
        ` [branch] ${s.id.padEnd(26)} http=${String(result.http).padEnd(4)} evidence=${String(result.evidence).padEnd(8)} assertions=${String(result.assertions).padEnd(4)} distinct=${String(result.distinctBranches).padEnd(4)} ${result.status}`,
      );
      for (const e of errors) console.log(`      err: ${e.error_type} :: ${String(e.error_message).slice(0, 120)}`);
      for (const st of statuses) console.log(`      items: ${st.status}=${st.n}`);
    }

    const notRun = [...verifiedOutOfScope, ...withoutBranch];
    for (const s of pilot.sources.filter((x) => notRun.includes(x))) {
      const verifiedButNotInScope = verified.has(s.id);
      results.push({
        institution: s.institution_id,
        source: s.id,
        branchedUrl: null,
        capability: verifiedButNotInScope ? "BRANCH_DIRECTORY (declared, not verified this run)" : "BRANCH_DIRECTORY = NOT_DISCOVERED",
        http: null,
        evidence: "none",
        extracted: 0,
        assertions: 0,
        distinctBranches: 0,
        jsRendered: false,
        status: verifiedButNotInScope ? "NOT_IN_SCOPE" : "NOT_DISCOVERED",
        detail: verifiedButNotInScope
          ? "BRANCH_DIRECTORY capability declared but branch page not structurally verified; nothing invented, nothing fetched"
          : "no verified branch-directory url; nothing invented, nothing fetched",
      });
    }
  }

  // ------------------------------------------------------------------ audit
  const db = new Database(dbPath, { readonly: true });
  const q = (sql: string, ...a: unknown[]): Record<string, unknown>[] => db.prepare(sql).all(...a);

  const open = listOpenConflicts(dbPath);

  const audit = {
    assertionsTotal: (db.prepare("SELECT COUNT(*) c FROM data_assertions WHERE field_name LIKE 'branch%'").get() as { c: number }).c,
    assertionsUnverified: (db.prepare("SELECT COUNT(*) c FROM data_assertions WHERE field_name LIKE 'branch%' AND verification_status='UNVERIFIED'").get() as { c: number }).c,
    distinctBranches: (db.prepare("SELECT COUNT(DISTINCT value) c FROM data_assertions WHERE field_name LIKE 'branch%'").get() as { c: number }).c,
    byField: q("SELECT field_name, COUNT(*) n, COUNT(DISTINCT value) branches FROM data_assertions WHERE field_name LIKE 'branch%' GROUP BY 1 ORDER BY 2 DESC"),
    byStatus: q("SELECT verification_status, COUNT(*) n FROM data_assertions WHERE field_name LIKE 'branch%' GROUP BY 1"),
    byConfidence: q("SELECT confidence, COUNT(*) n FROM data_assertions WHERE field_name LIKE 'branch%' GROUP BY 1 ORDER BY 1"),
    // provenance: every assertion must resolve to a snapshot + source. Any NULL
    // here is an orphan (the supplier of a value is never optional).
    provenanceOrphans: q(
      `SELECT a.id, a.field_name, a.value, a.source_id, a.source_snapshot_id
         FROM data_assertions a
        WHERE a.field_name LIKE 'branch%'
          AND (a.source_snapshot_id IS NULL
               OR a.observed_at IS NULL
               OR NOT EXISTS (SELECT 1 FROM source_snapshots ss WHERE ss.id = a.source_snapshot_id)
               OR NOT EXISTS (SELECT 1 FROM sources s WHERE s.id = a.source_id))`,
    ),
    snapshotFieldsMissing: q(
      `SELECT ss.id, ss.http_status, ss.mime_type, ss.content_hash, ss.fetched_at, s.source_grade
         FROM source_snapshots ss JOIN sources s ON s.id = ss.source_id
        WHERE ss.id IN (SELECT source_snapshot_id FROM data_assertions WHERE field_name LIKE 'branch%')
          AND (ss.content_hash IS NULL OR ss.content_hash = '' OR ss.mime_type IS NULL
               OR ss.fetched_at IS NULL OR s.source_grade IS NULL)`,
    ),
    snapshots: q(
      `SELECT ss.source_id, ss.http_status, ss.mime_type, ss.extraction_status, ss.parser_version, ss.fetched_at, LENGTH(ss.content_hash) hash_len
         FROM source_snapshots ss
        WHERE ss.source_id IN (SELECT DISTINCT source_id FROM data_assertions WHERE field_name LIKE 'branch%')
        ORDER BY ss.source_id, ss.fetched_at`,
    ),
    assertions: q(
      `SELECT a.source_id, a.field_name, a.value, a.verification_status, a.confidence, a.observed_at,
              a.source_snapshot_id, ss.content_hash, ss.mime_type, s.source_grade
         FROM data_assertions a
         JOIN source_snapshots ss ON ss.id = a.source_snapshot_id
         JOIN sources s ON s.id = a.source_id
        WHERE a.field_name LIKE 'branch%'
        ORDER BY a.source_id, a.field_name, a.value`,
    ),
    validationResults: q(
      `SELECT vr.target_id, vr.rule_id, vr.status, vr.message, COUNT(*) n
         FROM validation_results vr
        WHERE vr.rule_id LIKE '%branch%' GROUP BY 1,2,3,4`,
    ),
    runs: q(
      `SELECT r.ingestion_source_id, r.status, r.items_found, r.items_changed, r.items_new, r.items_failed, r.error_count, r.parser_version
         FROM ingestion_runs r WHERE r.ingestion_source_id IN (SELECT id FROM ingestion_sources)
        ORDER BY r.started_at`,
    ),
    errors: q("SELECT ingestion_source_id, url, error_type, error_message, retry_count FROM ingestion_errors ORDER BY created_at"),
    budget: q("SELECT id, fetch_interval_minutes, enabled, error_count FROM ingestion_sources ORDER BY id"),
  };
  db.close();

  console.log("\n== provenance audit");
  console.log(`branch assertions: ${audit.assertionsTotal} (UNVERIFIED ${audit.assertionsUnverified}, distinct branches ${audit.distinctBranches})`);
  console.log(`provenance orphans: ${audit.provenanceOrphans.length}`);
  console.log(`snapshots with missing hash/mime/clock/grade: ${audit.snapshotFieldsMissing.length}`);
  console.log(`open conflicts: ${open.length}`);
  for (const r of audit.assertions) {
    console.log(
      `  ${r.source_id} | ${r.field_name} | ${r.value} | ${r.verification_status} | conf=${r.confidence} | snap=${String(r.source_snapshot_id).slice(0, 18)} | grade=${r.source_grade} | mime=${r.mime_type} | observed=${r.observed_at}`,
    );
  }
  for (const c of open) console.log(`  conflict: ${c.fieldName} ${c.valueA} <> ${c.valueB} (${c.sourceAId} / ${c.sourceBId})`);

  if (!auditOnly) {
    writeFileSync(
      REPORT_JSON,
      JSON.stringify(
        {
          $schema: "pilot-branch-evidence/v1",
          generated_at: new Date().toISOString(),
          db_path: dbPath,
          pilot_universe: pilot.sources.length,
          branch_verified: verifiedInScope.length,
          branch_declared_not_verified: verifiedOutOfScope.length,
          branch_not_discovered: withoutBranch.length,
          repeat: has("repeat"),
          results,
          audit,
        },
        null,
        2,
      ),
    );
    console.log(`\nreport written: ${REPORT_JSON}`);
  }
}

main().catch((e) => {
  console.error("M3.4 branch pilot failed:", e);
  process.exit(1);
});