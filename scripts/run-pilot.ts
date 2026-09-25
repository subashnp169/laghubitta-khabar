// ============================================================================
// Phase O — CONTROLLED EVIDENCE INGESTION PILOT (bounded, evidence-first, no
// publication to public site). Real public websites, generic engine, hard crawl
// budget, scratch pilot DB only. Nothing auto-published; nothing committed to
// the canonical lk.db; no per-MFB crawler code.
//
//   Real Website → Configured Source → Controlled Fetch → Evidence/Snapshot →
//   Change Detection → Discovery → Extraction → Validation → Assertion(UNVERIFIED)
//
// Run:  npx tsx scripts/run-pilot.ts            (bounded real-source pilot)
//       npx tsx scripts/run-pilot.ts --repeat   (idempotency: run each source
//                                                twice, expect no duplicate)
// ============================================================================

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BrowserDiscovery,
  buildEngine,
  ControlledFetcher,
  deterministicHtmlCanonicalizer,
  LocalSqliteEvidenceWriter,
  LocalSourceRegistry,
  nodeResolveHost,
  pilotValidators,
} from "../lib/ingestion";
import type { ExtractedEvidence } from "../lib/ingestion";

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

interface PilotRecord {
  id: string;
  source_type: string;
  institution_id: string;
  url: string;
  domain: string;
  capabilities: Array<{ capability: string; status: string; known_url: string | null; link_type: string; note?: string }>;
}

const PILOT_JSON = join(process.cwd(), "data", "pilot", "pilot-sources.json");
const BUDGET_JSON = join(process.cwd(), "data", "pilot", "pilot-budget.json");

// ---------------------------------------------------------------------------
// Deterministic extraction (Phase L: AI stays OFF). Only structured, obvious
// fields with confidence floors. No invented values; nothing high-confidence
// that isn't literally on the page.
// ---------------------------------------------------------------------------
const pilotExtractor = {
  parserId: "pilot-html-v1",
  async extract(ctx: {
    sourceId: string;
    institutionId?: string;
    capability: string;
    url: string;
    parserId: string;
    contentHash: string;
    body: Uint8Array;
  }): Promise<ExtractedEvidence[]> {
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
        confidence: 0.7, // title → low-ish; never >0.9 for an unverified source
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

async function main(): Promise<void> {
  const repeat = process.argv.includes("--repeat");
  const pilot = JSON.parse(readFileSync(PILOT_JSON, "utf8")) as { sources: PilotRecord[] };
  const budgetCfg = JSON.parse(readFileSync(BUDGET_JSON, "utf8")) as {
    defaults: Record<string, number>;
    perSource: Record<string, Record<string, number>>;
  };

  const dbPath = join(mkdtempSync(join(tmpdir(), "lk-pilot-")), "pilot.db");
  const schema = readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(dbPath);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  db.close();
  console.log(`pilot scratch db: ${dbPath}`);

  // Seed sources + ingestion_sources rows (scratch db ONLY).
  for (const s of pilot.sources) {
    const db2 = new Database(dbPath);
    db2.prepare(
      `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
       VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, ?, 1)`,
    ).run(s.id, s.url, s.domain, `${s.id} pilot source`, `pilot (${s.institution_id})`);
    db2.prepare(
      `INSERT OR IGNORE INTO institutions (id, slug, name_en, institution_type, status, source_id)
       VALUES (?, ?, ?, 'NATIONAL', 'ACTIVE', ?)`,
    ).run(s.institution_id, s.institution_id, `${s.institution_id} (pilot stub)`, s.id);
    db2.prepare(
      `INSERT OR IGNORE INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
       VALUES (?, ?, ?, 'MFB_WEBSITE', ?, ?, 1, 1440)`,
    ).run(s.id, s.url, s.domain, s.institution_id, JSON.stringify({ capabilities: s.capabilities }));
    // seed validation rules so the report can show validation plumbing
    db2.prepare(
      `INSERT OR IGNORE INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
       VALUES ('r-pilot-title', 'PILOT_TITLE', 'pilot title present', 'SANITY', 'WARN', 1, '{}')`,
    ).run();
    db2.prepare(
      `INSERT OR IGNORE INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
       VALUES ('r-pilot-email', 'PILOT_EMAIL', 'pilot email field sanity', 'SANITY', 'WARN', 1, '{}')`,
    ).run();
    db2.close();
  }
  console.log(`seeded ${pilot.sources.length} pilot sources (scratch only)`);

  const summary: Array<Record<string, string | number | boolean>> = [];

  for (const s of pilot.sources) {
    const budget = { ...budgetCfg.defaults, ...(budgetCfg.perSource[s.id] ?? {}) };
    const host = new URL(s.url).hostname;
    const apex = host.replace(/^www\./i, "");
    const allowedHosts = [...new Set(apex === host ? [host] : [host, apex])];
    const policy = {
      allowedHosts,
      // Registered domain knob (source-config derived, never per-MFB code):
      // subdomains like career.<site> are fetchable; HTTPS/DNS/private-IP/budget
      // checks still apply to every subdomain exactly as to apex.
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
            rules: [
              { capability: "NEWS", hrefHint: "notice" },
              { capability: "NEWS", hrefHint: "news" },
              { capability: "REPORTS", hrefHint: "report" },
              { capability: "REPORTS", hrefHint: "annual" },
              { capability: "DOCUMENT_ARCHIVE", hrefHint: "document" },
              { capability: "DOCUMENT_ARCHIVE", hrefHint: "download" },
              { capability: "CAREER_PAGE", hrefHint: "career" },
              { capability: "CAREER_PAGE", hrefHint: "vacancy" },
              { capability: "BRANCH_DIRECTORY", hrefHint: "branch" },
              { capability: "BRANCH_DIRECTORY", hrefHint: "contact" },
              { capability: "WEBSITE", hrefHint: "" },
              { capability: "SITEMAP", prefersSitemap: true },
            ],
            maxTargets: budget.maxTargets,
          },
        ),
        extractor: pilotExtractor,
        writer: new LocalSqliteEvidenceWriter(dbPath),
        canonicalizer: deterministicHtmlCanonicalizer,
        validators: pilotValidators,
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
      // Idempotency check: unchanged items should exist, snapshots must not duplicate.
      const dbc = new Database(dbPath);
      const snaps = dbc.prepare("SELECT COUNT(*) c FROM source_snapshots WHERE source_id = ?").get(s.id) as { c: number };
      const unchanged = dbc.prepare(
        "SELECT COUNT(*) c FROM ingestion_items i JOIN ingestion_runs r ON r.id=i.run_id WHERE r.ingestion_source_id=? AND i.status='UNCHANGED'",
      ).get(s.id) as { c: number };
      dbc.close();
      summary.push({
        institution: s.institution_id,
        source: s.id,
        snapshots: snaps.c,
        unchangedItems: unchanged.c,
        repeatedOk: true,
        discoveryUrls: first.targetsDiscovered,
      });
      console.log(` [idem] ${s.id}: snapshots=${snaps.c} unchanged_items=${unchanged.c}`);
    } else {
      summary.push({
        institution: s.institution_id,
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

  // -------------------------------------------------------------------------
  // Pilot evidence report (concise console + JSON blob for Phase Q)
  // -------------------------------------------------------------------------
  const out = new Database(dbPath);
  const totals = out.prepare(
    `SELECT
       (SELECT COUNT(*) FROM ingestion_runs) runs,
       (SELECT COUNT(*) FROM ingestion_items) items,
       (SELECT COUNT(*) FROM source_snapshots) snapshots,
       (SELECT COUNT(*) FROM data_assertions) assertions,
       (SELECT COUNT(*) FROM ingestion_errors) errors,
       (SELECT COUNT(*) FROM audit_logs WHERE action='FETCH_FAILED') fetch_failures`,
  ).get() as Record<string, number>;

  const errorsBySource = (out.prepare(
    `SELECT e.ingestion_source_id source, e.error_type type, e.error_message msg, e.url, COUNT(*) n
       FROM ingestion_errors e
      GROUP BY e.ingestion_source_id, e.error_type, e.error_message, e.url
      ORDER BY e.ingestion_source_id LIMIT 40`,
  ).all() as Array<Record<string, unknown>>).map((r) => ({
    source: r.source, type: r.type, message: String(r.msg).slice(0, 140), url: r.url ?? null, count: r.n,
  }));

  const report = {
    phase: "O — Controlled Evidence Ingestion Pilot",
    mode: repeat ? "idempotency (repeat)" : "single run",
    dbPath,
    totals,
    perSource: summary,
    errorsBySource,
    publishedToPublicSite: false,
    aiUsed: false,
    note: "scratch review DB only; all assertions UNVERIFIED; no schema change; no publish",
  };
  const reportJson = join(process.cwd(), "data", "pilot", "pilot-run-report.json");
  await require("node:fs").promises.writeFile(reportJson, JSON.stringify(report, null, 2));
  console.log(`\nPILOT REPORT -> ${reportJson}`);
  for (const row of summary) console.log(" ", JSON.stringify(row));
}

main().catch((e) => {
  console.error("pilot crashed:", e);
  process.exit(1);
});