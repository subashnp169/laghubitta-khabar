// ============================================================================
// M1.5.1 — NRB INTAKE (bounded, evidence-first, no publication to the public
// site). The eight crawlable NRB sources run through the generic capability
// engine into a scratch review DB. Deterministic only: AI OFF, no OCR, no
// browser automation, no per-MFB code. The nrb-listing-v1 parser is the only
// NRB-specific extractor and it self-limits to sourceType "NRB" on
// DOCUMENT_ARCHIVE / REPORTS pages.
//
//   Real NRB Category → Configured Source → Controlled Fetch → Evidence →
//   nrb-listing-v1 + finmeta composition → Assertions(UNVERIFIED) + outbound links
//
// Run:  npx tsx scripts/nrb-ingest.ts            (bounded real NRB intake)
//       npx tsx scripts/nrb-ingest.ts --repeat   (idempotency: run each source
//                                                 twice, expect no duplicate)
// ============================================================================

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  nrbListingExtractor,
  nrbStructuredValidators,
  vacancyExtractor,
} from "../lib/ingestion";
import type { ExtractedEvidence, HtmlExtractor } from "../lib/ingestion";

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

interface NrbRecord {
  id: string;
  source_type: string;
  url: string;
  domain: string;
  title: string;
  doc_type: string | null;
  capabilities: Array<{ capability: string; status: string; known_url: string | null; link_type: string; note?: string }>;
  is_active: number;
}

const NRB_JSON = join(process.cwd(), "data", "nrb", "nrb-sources.json");
const BUDGET_JSON = join(process.cwd(), "data", "nrb", "nrb-budget.json");

// Same deterministic pilot extractor as run-pilot.ts (title + visible email),
// capability-self-limited. AI OFF; nothing invented.
const pilotExtractor: HtmlExtractor = {
  parserId: "pilot-html-v1",
  async extract(ctx) {
    const text = new TextDecoder().decode(ctx.body);
    const out: ExtractedEvidence[] = [];
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]
      ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text)?.[1];
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

// The pilot extractor (title + email, capability-self-limited) is composed for
// uniformity; the people/branch/vacancy parsers are MFB-specific and stay
// silent on NRB pages (capability gating). NRB listing + finmeta composition is
// the observable surface: nrb-listing-v1 reads arrowed-list rows into outbound
// links + DOCUMENT_TITLE assertions; overlap with finmeta is deduped by the
// engine (field + value) so nothing asserts twice.
const nrbExtractor: HtmlExtractor = composeExtractors(
  composeExtractors(pilotExtractor, peopleExtractor),
  composeExtractors(
    branchDirectoryExtractor,
    composeExtractors(vacancyExtractor, composeExtractors(financialMetadataExtractor, nrbListingExtractor)),
  ),
);

const nrbAllValidators = [
  ...pilotValidators,
  ...peopleValidators,
  ...nrbStructuredValidators,
];

async function main(): Promise<void> {
  const repeat = process.argv.includes("--repeat");
  const cfg = JSON.parse(readFileSync(NRB_JSON, "utf8")) as { sources: NrbRecord[] };
  const budgetCfg = JSON.parse(readFileSync(BUDGET_JSON, "utf8")) as {
    defaults: Record<string, number>;
    perSource: Record<string, Record<string, number>>;
  };

  const dbPath = join(mkdtempSync(join(tmpdir(), "lk-nrb-")), "nrb.db");
  const schema = readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(dbPath);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  db.close();
  console.log(`nrb scratch db: ${dbPath}`);

  // Seed sources + ingestion_sources rows. NRB sources are regulator-scoped:
  // source_type/source_scope 'NRB' (valid per schema CHECK), NO institution_id.
  // Each source carries its own config_json.budget (parseBudget) so the budget
  // knob travels with the source config, exactly like the pilot's.
  for (const s of cfg.sources) {
    const budget = { ...budgetCfg.defaults, ...(budgetCfg.perSource[s.id] ?? {}) };
    const db2 = new Database(dbPath);
    db2.prepare(
      `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
       VALUES (?, 'NRB', 'NRB', 'A', ?, ?, ?, 'Nepal Rastra Bank', ?)`,
    ).run(s.id, s.url, s.domain, s.title, s.is_active);
    db2.prepare(
      `INSERT OR IGNORE INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
       VALUES (?, ?, ?, 'NRB', NULL, ?, 1, 1440)`,
    ).run(s.id, s.url, s.domain, JSON.stringify({ capabilities: s.capabilities, budget }));
    for (const rule of [
      ["r-pilot-title", "PILOT_TITLE", "pilot title present", "SANITY", "WARN"],
      ["r-pilot-email", "PILOT_EMAIL", "pilot email field sanity", "SANITY", "WARN"],
      ["r-people-directory", "PEOPLE_DIRECTORY", "people directory extraction", "SANITY", "WARN"],
      ["r-people-staff-directory", "PEOPLE_STAFF_DIRECTORY", "staff directory suppressed as a non-person listing", "SANITY", "INFO"],
      ["r-branch-directory", "BRANCH_DIRECTORY", "branch directory extraction", "SANITY", "WARN"],
      ["r-vacancies", "VACANCIES", "career vacancy extraction", "SANITY", "WARN"],
      ["r-financial-metadata", "FINANCIAL_METADATA", "financial document metadata extraction", "SANITY", "WARN"],
      ["r-nrb-listing", "NRB_LISTING", "nrb listing extraction", "SANITY", "WARN"],
    ]) {
      db2.prepare(
        `INSERT OR IGNORE INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
         VALUES (?, ?, ?, ?, ?, 1, '{}')`,
      ).run(rule[0], rule[1], rule[2], rule[3], rule[4]);
    }
    db2.close();
  }
  console.log(`seeded ${cfg.sources.length} NRB sources (scratch only)`);

  const summary: Array<Record<string, string | number | boolean>> = [];

  for (const s of cfg.sources) {
    const budget = { ...budgetCfg.defaults, ...(budgetCfg.perSource[s.id] ?? {}) };
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
    const makes: Array<{ runId: string; status: string; items: number; fetched: number; errors: number; lifecycle: string[] }> = [];

    const runOnce = async (runId: string) => {
      const deps = {
        registry: new LocalSourceRegistry(dbPath),
        fetcher: new ControlledFetcher(policy),
        discovery: new BrowserDiscovery(
          new LocalSourceRegistry(dbPath),
          new ControlledFetcher(policy),
          {
            rules: DISCOVERY_HINT_RULES,
            maxTargets: budget.maxTargets,
          },
        ),
        extractor: nrbExtractor,
        writer: new LocalSqliteEvidenceWriter(dbPath),
        canonicalizer: deterministicHtmlCanonicalizer,
        validators: nrbAllValidators,
      };
      const engine = buildEngine(deps);
      const out = await engine.runSource(s.id, { budget, now: new Date().toISOString() });
      const fetched = out.items.filter((i) => i.lifecycle !== "DISCOVERED").length;
      makes.push({ runId, status: out.ok ? "SUCCESS" : "PARTIAL", items: out.items.length, fetched, errors: out.errors.length, lifecycle: out.items.map((i) => i.lifecycle) });
      console.log(` [run] ${s.id.padEnd(18)} ${runId} status=${out.ok ? "SUCCESS" : "PARTIAL"} items=${out.items.length} fetched=${fetched} errors=${out.errors.length}`);
      return out;
    };

    const first = await runOnce(`run-${Date.now()}-${s.id}`);
    if (repeat) {
      await new Promise((r) => setTimeout(r, 500));
      await runOnce(`run-${Date.now()}-${s.id}`);
      const dbc = new Database(dbPath);
      const snaps = dbc.prepare("SELECT COUNT(*) c FROM source_snapshots WHERE source_id = ?").get(s.id) as { c: number };
      const unchanged = dbc.prepare(
        "SELECT COUNT(*) c FROM ingestion_items i JOIN ingestion_runs r ON r.id=i.run_id WHERE r.ingestion_source_id=? AND i.status='UNCHANGED'",
      ).get(s.id) as { c: number };
      dbc.close();
      summary.push({
        source: s.id,
        snapshots: snaps.c,
        unchangedItems: unchanged.c,
        repeatedOk: true,
        discoveryUrls: first.targetsDiscovered,
      });
      console.log(` [idem] ${s.id}: snapshots=${snaps.c} unchanged_items=${unchanged.c}`);
    } else {
      summary.push({
        source: s.id,
        snapshots: 0,
        unchangedItems: 0,
        repeatedOk: false,
        discoveryUrls: first.targetsDiscovered,
        runStatus: first.ok ? "SUCCESS" : "PARTIAL",
        runs: makes.length,
      });
    }
  }

  const out = new Database(dbPath);
  const totals = out.prepare(
    `SELECT
       (SELECT COUNT(*) FROM ingestion_runs) runs,
       (SELECT COUNT(*) FROM ingestion_items) items,
       (SELECT COUNT(*) FROM source_snapshots) snapshots,
       (SELECT COUNT(*) FROM data_assertions) assertions,
       (SELECT COUNT(*) FROM outbound_links) outbound_links,
       (SELECT COUNT(*) FROM ingestion_errors) errors,
       (SELECT COUNT(*) FROM audit_logs WHERE action='FETCH_FAILED') fetch_failures`,
  ).get() as Record<string, number>;

  const perSource = (out.prepare(
    `SELECT
       s.id source,
       (SELECT COUNT(*) FROM data_assertions a WHERE a.source_id=s.id) assertions,
       (SELECT COUNT(*) FROM outbound_links l WHERE l.source_id=s.id) outbound_links,
       (SELECT COUNT(*) FROM source_snapshots s2 WHERE s2.source_id=s.id) snapshots,
       (SELECT COUNT(*) FROM ingestion_errors e WHERE e.ingestion_source_id=s.id) errors
     FROM sources s ORDER BY s.id`,
  ).all() as Array<Record<string, unknown>>).map((r) => ({
    source: r.source, assertions: r.assertions, outboundLinks: r.outbound_links, snapshots: r.snapshots, errors: r.errors,
  }));

  const errorsBySource = (out.prepare(
    `SELECT e.ingestion_source_id source, e.error_type type, e.error_message msg, e.url, COUNT(*) n
       FROM ingestion_errors e
      GROUP BY e.ingestion_source_id, e.error_type, e.error_message, e.url
      ORDER BY e.ingestion_source_id LIMIT 40`,
  ).all() as Array<Record<string, unknown>>).map((r) => ({
    source: r.source, type: r.type, message: String(r.msg).slice(0, 140), url: r.url ?? null, count: r.n,
  }));

  const report = {
    phase: "M1.5.1 — NRB intake (eight crawlable NRB sources)",
    mode: repeat ? "idempotency (repeat)" : "single run",
    dbPath,
    totals,
    perSource,
    errorsBySource,
    publishedToPublicSite: false,
    aiUsed: false,
    note: "scratch review DB only; all assertions UNVERIFIED; regulator-scoped sources (no institution_id); no schema change; no publish",
  };
  const reportJson = join(process.cwd(), "data", "nrb", "nrb-run-report.json");
  await require("node:fs").promises.writeFile(reportJson, JSON.stringify(report, null, 2));
  console.log(`\nNRB INTAKE REPORT -> ${reportJson}`);
  for (const row of summary) console.log(" ", JSON.stringify(row));
}

main().catch((e) => {
  console.error("nrb ingest crashed:", e);
  process.exit(1);
});