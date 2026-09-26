// ============================================================================
// M1.6 — INGESTION OPS CLI (schedules + control plane). Actionable verbs over
// the same local sqlite ingestion DB the read-only control panel inspects.
// Deterministic only (AI OFF). Writes are local-DB-only and guard-env-gated
// (docs/OPERATIONS.md R1/R3/R4): they never touch lk.db, D1, or the public site.
//
//   npm run ops -- status                      read-only compact ops view
//   npm run ops -- schedule --db <path>        schedule manifest + report json
//   npm run ops -- run                         engine runs for due, enabled sources
//   npm run ops -- run --all | --source=X      run every enabled / one source
//   npm run ops -- retry <source>              force a run now (paused -> refused)
//   npm run ops -- pause <source|--all>        enabled = 0
//   npm run ops -- resume <source|--all>       enabled = 1
//
// DB: --db <path> | LK_OPS_DB | data/pilot/pilot-run-report.json#dbPath.
// See docs/INGESTION-OPERATIONS.md.
// ============================================================================

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  BrowserDiscovery,
  DISCOVERY_HINT_RULES,
  buildEngine,
  composeExtractors,
  ControlledFetcher,
  deterministicHtmlCanonicalizer,
  financialMetadataExtractor,
  LocalSqliteEvidenceWriter,
  LocalSourceRegistry,
  nodeResolveHost,
  peopleExtractor,
  peopleValidators,
  pilotValidators,
  branchDirectoryExtractor,
  structuredValidators,
  vacancyExtractor,
  nrbListingExtractor,
  nrbStructuredValidators,
  DataApiConfigError,
  parseDataApiConfig,
  runDataApiPass,
} from "../lib/ingestion";
import type { ExtractedEvidence, HtmlExtractor, Validator } from "../lib/ingestion";
import {
  cadenceBucket,
  computeDue,
  DEFAULT_CADENCE_MINUTES,
  effectiveCadenceMinutes,
  parseScheduleOverrides,
  sourceCapabilityCadences,
  type ScheduleOverrides,
} from "../lib/ingestion/schedule";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string) => {
  prepare(s: string): {
    get(...a: unknown[]): Record<string, unknown> | undefined;
    all(...a: unknown[]): Record<string, unknown>[];
    run(...a: unknown[]): unknown;
  };
  exec(s: string): void;
  close(): void;
};

const { guardOrExit } = require("./guard-env.cjs") as { guardOrExit(label: string): boolean };

const PILOT_REPORT_JSON = join(process.cwd(), "data", "pilot", "pilot-run-report.json");
const BUDGET_JSON = join(process.cwd(), "data", "pilot", "pilot-budget.json");
const SCHEDULE_REPORT_JSON = join(process.cwd(), "data", "control", "schedule-report.json");

type Verb = "status" | "schedule" | "run" | "retry" | "pause" | "resume";

interface CliArgs {
  verb: string;
  db: string | null;
  source: string | null;
  all: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { verb: argv[0] ?? "", db: null, source: null, all: false };
  for (const a of argv.slice(1)) {
    if (a === "--all") out.all = true;
    else if (a.startsWith("--db=")) out.db = a.slice("--db=".length);
    else if (a.startsWith("--source=")) out.source = a.slice("--source=".length);
    else if (!a.startsWith("--") && out.source === null) out.source = a;
  }
  return out;
}

function resolveDbPath(explicit: string | null): string {
  if (explicit) return explicit;
  if (process.env.LK_OPS_DB) return process.env.LK_OPS_DB;
  if (existsSync(PILOT_REPORT_JSON)) {
    try {
      const report = JSON.parse(readFileSync(PILOT_REPORT_JSON, "utf8")) as { dbPath?: string };
      if (report.dbPath) return report.dbPath;
    } catch {
      /* fall through */
    }
  }
  return "";
}

function requireDb(dbPath: string): void {
  if (!dbPath || !existsSync(dbPath)) {
    console.error("ops: no ingestion db. pass --db=<path>, set LK_OPS_DB, or run a pilot/nrb ingest first.");
    process.exit(1);
  }
}

interface SourceRow {
  id: string;
  url: string;
  domain: string | null;
  source_type: string;
  enabled: number;
  config_json: string;
  last_run_at: string | null;
}

interface ListSource extends SourceRow {
  capabilities: Array<{ capability: string }>;
  overrides: ScheduleOverrides;
  cadenceMinutes: number;
  cadenceBuckets: number[];
  bucket: "frequent" | "periodic" | "slow";
  lastRunAt: string | null;
  nextDueAt: string;
  isDue: boolean;
}

export type { SourceRow, ListSource };

export function listSources(dbPath: string, now: string): ListSource[] {
  const db = new Database(dbPath);
  const rows = db
    .prepare(
      `SELECT id, url, domain, source_type, enabled, config_json, last_run_at
         FROM ingestion_sources ORDER BY id`,
    )
    .all() as unknown as SourceRow[];
  const lastRuns = new Map<string, string | null>();
  for (const r of db
    .prepare(
      `SELECT ingestion_source_id, MAX(started_at) last
         FROM ingestion_runs GROUP BY ingestion_source_id`,
    )
    .all() as unknown as Array<{ ingestion_source_id: string; last: string | null }>) {
    lastRuns.set(r.ingestion_source_id, r.last);
  }
  db.close();

  return rows.map((r) => {
    let cfg: { capabilities?: Array<{ capability: string }> } = {};
    try {
      cfg = JSON.parse(r.config_json) as { capabilities?: Array<{ capability: string }> };
    } catch {
      cfg = {};
    }
    const capabilities = Array.isArray(cfg.capabilities) ? cfg.capabilities : [];
    const overrides = parseScheduleOverrides(r.config_json);
    const cadenceMinutes = effectiveCadenceMinutes(capabilities, overrides);
    const lastRunAt: string | null = r.last_run_at ?? lastRuns.get(r.id) ?? null;
    const due = computeDue(lastRunAt, cadenceMinutes, now);
    return {
      ...r,
      capabilities,
      overrides,
      cadenceMinutes,
      cadenceBuckets: sourceCapabilityCadences(capabilities, overrides),
      bucket: cadenceBucket(cadenceMinutes),
      lastRunAt,
      nextDueAt: due.nextDueAt,
      isDue: due.isDue,
    };
  });
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const col = (v: string | number | null, width: number) => pad(String(v ?? "-"), width);

function bucketCounts(sources: ListSource[]): Record<"frequent" | "periodic" | "slow", number> {
  const out = { frequent: 0, periodic: 0, slow: 0 };
  for (const s of sources) out[s.bucket] += 1;
  return out;
}

function printScheduleTable(sources: ListSource[]): void {
  console.log(
    `${col("SOURCE", 20)}${col("TYPE", 12)}${col("CAD", 6)}${col("BUCKET", 10)}${col("LAST_RUN", 20)}${col("NEXT_DUE", 20)}${col("DUE", 4)}${col("STATE", 8)}`,
  );
  for (const s of sources) {
    console.log(
      `${col(s.id, 20)}${col(s.source_type, 12)}${col(s.cadenceMinutes, 6)}${col(s.bucket, 10)}${col((s.lastRunAt ?? "").slice(0, 19), 20)}${col(s.nextDueAt.slice(0, 19), 20)}${col(s.isDue ? "YES" : "", 4)}${col(s.enabled ? "active" : "paused", 8)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Engine composition (mirrors each intake's own extractor set so ops runs keep
// identical evidence semantics). Deterministic, capability-self-limiting.
// ---------------------------------------------------------------------------
const pilotExtractor: HtmlExtractor = {
  parserId: "pilot-html-v1",
  async extract(ctx) {
    const text = new TextDecoder().decode(ctx.body);
    const out: ExtractedEvidence[] = [];
    const t =
      /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1] ??
      /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text)?.[1];
    if (t) {
      out.push({
        kind: "FIELD",
        capability: "WEBSITE",
        sourceUrl: ctx.url,
        text: t.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 200),
        confidence: 0.7,
        parserId: this.parserId,
        extractedAt: new Date().toISOString(),
      });
    }
    const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(text)?.[0];
    if (email && (ctx.capability === "WEBSITE" || ctx.capability === "NEWS")) {
      out.push({
        kind: "FIELD",
        capability: "WEBSITE",
        sourceUrl: ctx.url,
        text: email,
        confidence: 0.8,
        parserId: this.parserId,
        extractedAt: new Date().toISOString(),
      });
    }
    return out;
  },
};

const pilotStructuredExtractor: HtmlExtractor = composeExtractors(
  composeExtractors(pilotExtractor, peopleExtractor),
  composeExtractors(
    branchDirectoryExtractor,
    composeExtractors(vacancyExtractor, financialMetadataExtractor),
  ),
);

const nrbOpsExtractor: HtmlExtractor = composeExtractors(
  composeExtractors(pilotExtractor, peopleExtractor),
  composeExtractors(
    branchDirectoryExtractor,
    composeExtractors(
      vacancyExtractor,
      composeExtractors(financialMetadataExtractor, nrbListingExtractor),
    ),
  ),
);

function extractorFor(sourceType: string): HtmlExtractor {
  return sourceType === "NRB" ? nrbOpsExtractor : pilotStructuredExtractor;
}

function validatorsFor(sourceType: string): Validator[] {
  return sourceType === "NRB"
    ? [...pilotValidators, ...peopleValidators, ...nrbStructuredValidators]
    : [...pilotValidators, ...peopleValidators, ...structuredValidators];
}

function budgetFor(source: SourceRow): Record<string, number> {
  const defaults = JSON.parse(readFileSync(BUDGET_JSON, "utf8")) as {
    defaults: Record<string, number>;
    perSource: Record<string, Record<string, number>>;
  };
  try {
    const cfg = JSON.parse(source.config_json) as { budget?: Record<string, number> };
    if (cfg.budget && typeof cfg.budget === "object") {
      return { ...defaults.defaults, ...cfg.budget };
    }
  } catch {
    /* fall through to defaults */
  }
  return defaults.defaults;
}

interface RunOutcome {
  source: string;
  runId: string;
  status: string;
  items: number;
  fetched: number;
  errors: number;
}

async function runSource(dbPath: string, s: SourceRow, now: string): Promise<RunOutcome> {
  const budget = budgetFor(s);
  const host = new URL(s.url).hostname;
  const apex = host.replace(/^www\./i, "");
  const allowedHosts = [...new Set(apex === host ? [host] : [host, apex])];
  const policy = {
    allowedHosts,
    allowSubdomainsOf: [apex],
    maxBytes: budget.maxBytes,
    maxRedirects: budget.maxRedirects,
    maxRetries: budget.maxRetries,
    timeoutMs: 15000,
    minIntervalMs: 250,
    resolveHost: nodeResolveHost,
  };
  const deps = {
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new ControlledFetcher(policy),
    discovery: new BrowserDiscovery(
      new LocalSourceRegistry(dbPath),
      new ControlledFetcher(policy),
      { rules: DISCOVERY_HINT_RULES, maxTargets: budget.maxTargets },
    ),
    extractor: extractorFor(s.source_type),
    writer: new LocalSqliteEvidenceWriter(dbPath),
    canonicalizer: deterministicHtmlCanonicalizer,
    validators: validatorsFor(s.source_type),
  };
  const engine = buildEngine(deps);
  const runId = `run-${Date.now()}-${s.id}`;
  const out = await engine.runSource(s.id, { budget, now });
  const fetched = out.items.filter((i) => i.lifecycle !== "DISCOVERED").length;

  let status = out.ok ? "SUCCESS" : "PARTIAL";
  let errors = out.errors.length;
  let items = out.items.length;

  // M3.2 — data-API pass for JS-backed sources: config_json.data_api declares
  // backing JSON routes; matched by strict parse (null → no pass). A malformed
  // data_api block must fail LOUDLY like any bad capability config — recorded
  // as a FAILED run, never silently skipped.
  let cfg: unknown = {};
  try {
    cfg = JSON.parse(s.config_json);
  } catch {
    cfg = {};
  }
  let dataApi: ReturnType<typeof parseDataApiConfig> = null;
  try {
    dataApi = parseDataApiConfig(cfg);
  } catch (e) {
    const msg = e instanceof DataApiConfigError ? e.message : String(e);
    console.error(` [api] ${s.id}: data_api config error: ${msg}`);
    await deps.registry.recordRun({
      sourceId: s.id, startedAt: now, completedAt: now, status: "FAILED",
      itemsFound: 0, itemsChanged: 0, itemsNew: 0, itemsFailed: 0, errorCount: 1,
    });
    status = "PARTIAL";
    errors += 1;
  }
  if (dataApi) {
    const spec = await deps.registry.get(s.id);
    if (!spec) {
      console.error(` [api] ${s.id}: source not found in registry`);
      status = "PARTIAL";
      errors += 1;
    } else {
      const pass = await runDataApiPass({
        source: spec,
        config: dataApi,
        budget,
        now,
        deps: {
          registry: deps.registry,
          fetcher: new ControlledFetcher({
            allowedHosts: dataApi.hosts,
            maxBytes: budget.maxBytes,
            maxRedirects: budget.maxRedirects,
            maxRetries: budget.maxRetries,
            timeoutMs: 15000,
            minIntervalMs: 250,
            resolveHost: nodeResolveHost,
          }),
          writer: deps.writer,
          canonicalizer: deterministicHtmlCanonicalizer,
          validators: validatorsFor(s.source_type),
        },
      });
      console.log(
        ` [api] ${s.id.padEnd(18)} ${pass.runId} processed=${pass.processed} errors=${pass.errors.length}`,
      );
      items += pass.processed;
      errors += pass.errors.length;
      if (pass.errors.length > 0) status = "PARTIAL";
    }
  }

  console.log(
    ` [run] ${s.id.padEnd(18)} ${runId} status=${out.ok ? "SUCCESS" : "PARTIAL"} items=${out.items.length} fetched=${fetched} errors=${out.errors.length}`,
  );
  return {
    source: s.id,
    runId,
    status,
    items,
    fetched,
    errors,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const verb = args.verb.trim() as Verb;

  const dbPath = resolveDbPath(args.db);
  const now = new Date().toISOString();

  if (verb === "pause" || verb === "resume") {
    guardOrExit("ops");
    requireDb(dbPath);
    const enabled = verb === "resume" ? 1 : 0;
    const db = new Database(dbPath);
    if (args.all) {
      db.prepare("UPDATE ingestion_sources SET enabled = ?").run(enabled);
    } else if (!args.source) {
      console.error(`ops ${verb}: need <source> or --all`);
      process.exit(1);
    } else {
      const r = db.prepare("SELECT COUNT(*) c FROM ingestion_sources WHERE id = ?").get(args.source) as { c: number };
      if (r.c === 0) {
        console.error(`ops ${verb}: unknown source "${args.source}"`);
        process.exit(1);
      }
      db.prepare("UPDATE ingestion_sources SET enabled = ? WHERE id = ?").run(enabled, args.source);
    }
    const n = (db.prepare("SELECT COUNT(*) c FROM ingestion_sources WHERE enabled = ?").get(enabled) as { c: number }).c;
    db.close();
    console.log(`ops ${verb}: ${args.all ? "all sources" : `"${args.source}"`} -> ${enabled === 1 ? "active" : "paused"} (${n} sources now ${enabled === 1 ? "active" : "paused"})`);
    return;
  }

  if (verb === "run" || verb === "retry") {
    guardOrExit("ops");
    requireDb(dbPath);
    const sources = listSources(dbPath, now);
    let selected: ListSource[];
    if (args.source) {
      const hit = sources.find((s) => s.id === args.source);
      if (!hit) {
        console.error(`ops ${verb}: unknown source "${args.source}"`);
        process.exit(1);
      }
      if (!hit.enabled) {
        console.error(`ops ${verb}: "${args.source}" is paused - resume it first`);
        process.exit(1);
      }
      selected = [hit];
    } else if (args.all) {
      selected = sources.filter((s) => s.enabled === 1);
    } else {
      selected = sources.filter((s) => s.enabled === 1 && s.isDue);
    }
    if (selected.length === 0) {
      console.log(`ops ${verb}: no ${args.source ? "source" : args.all ? "enabled sources" : "due, enabled sources"}`);
      return;
    }
    console.log(`ops ${verb}: ${selected.length} source(s): ${selected.map((s) => s.id).join(", ")}`);
    const outcomes: RunOutcome[] = [];
    for (const s of selected) {
      outcomes.push(await runSource(dbPath, s, now));
    }
    console.log(`ops ${verb}: done. ${outcomes.filter((o) => o.status === "SUCCESS").length}/${outcomes.length} SUCCESS`);
    return;
  }

  // Read-only verbs below: status | schedule.
  requireDb(dbPath);
  const sources = listSources(dbPath, now);
  const counts = bucketCounts(sources);
  const enabledSources = sources.filter((s) => s.enabled === 1);
  const dueNow = enabledSources.filter((s) => s.isDue);
  const paused = sources.filter((s) => s.enabled === 0);

  if (verb === "schedule" || verb === "status") {
    console.log(
      `sources: ${sources.length} total / ${enabledSources.length} active / ${paused.length} paused; cadence: ${counts.frequent} frequent / ${counts.periodic} periodic / ${counts.slow} slow; due-now: ${dueNow.length}`,
    );
    printScheduleTable(sources);
  }

  if (verb === "status") {
    const db = new Database(dbPath);
    const totals = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM ingestion_runs) runs,
           (SELECT COUNT(*) FROM ingestion_runs WHERE status='SUCCESS') success,
           (SELECT COUNT(*) FROM ingestion_runs WHERE status='PARTIAL') partial,
           (SELECT COUNT(*) FROM ingestion_runs WHERE status='FAILED') failed,
           (SELECT COUNT(*) FROM ingestion_runs WHERE status='RUNNING') running,
           (SELECT COUNT(*) FROM ingestion_items) items,
           (SELECT COUNT(*) FROM source_snapshots) snapshots,
           (SELECT COUNT(*) FROM ingestion_errors) errors,
           (SELECT COUNT(*) FROM data_assertions) assertions`,
      )
      .get() as Record<string, number>;
    db.close();
    console.log(
      `runs: ${totals.runs} (${totals.success} success / ${totals.partial} partial / ${totals.failed} failed / ${totals.running} running); items: ${totals.items}; snapshots: ${totals.snapshots}; errors: ${totals.errors}; assertions: ${totals.assertions}`,
    );
    if (dueNow.length > 0) {
      console.log("due now:");
      for (const s of dueNow) console.log(`  - ${s.id} (cadence ${s.cadenceMinutes} min, bucket ${s.bucket}, last run ${(s.lastRunAt ?? "-").slice(0, 19)})`);
    }
    console.log("read-only plane (sources/runs/items/errors/validation/coverage): npm run control -- <db>");
    return;
  }

  if (verb === "schedule") {
    mkdirSync(join(process.cwd(), "data", "control"), { recursive: true });
    const report = {
      phase: "M1.6 - ingestion schedule manifest",
      dbPath,
      computedAt: now,
      totals: {
        sources: sources.length,
        activeSources: enabledSources.length,
        pausedSources: paused.length,
        dueNow: dueNow.length,
        cadenceBuckets: counts,
        defaultCadenceMinutes: DEFAULT_CADENCE_MINUTES,
      },
      perSource: sources.map((s) => ({
        source: s.id,
        sourceType: s.source_type,
        enabled: s.enabled === 1,
        capabilities: s.capabilities.map((c) => c.capability),
        cadenceMinutes: s.cadenceMinutes,
        cadenceBuckets: s.cadenceBuckets,
        bucket: s.bucket,
        lastRunAt: s.lastRunAt,
        nextDueAt: s.nextDueAt,
        isDue: s.isDue,
        overrides: Object.keys(s.overrides).length > 0 ? s.overrides : undefined,
      })),
      note: "read-only manifest; schedule runs write via `npm run ops -- run`; no schema change; no publish",
    };
    writeFileSync(SCHEDULE_REPORT_JSON, JSON.stringify(report, null, 2));
    console.log(`\nschedule manifest -> ${SCHEDULE_REPORT_JSON}`);
    return;
  }

  console.error(`ops: unknown verb "${verb}" (status | schedule | run | retry | pause | resume)`);
  process.exit(1);
}

if (process.argv[1] && /ops-cli\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error("ops crashed:", e);
    process.exit(1);
  });
}