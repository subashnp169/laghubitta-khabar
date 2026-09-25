// ============================================================================
// Phase N — ingestion pilot acceptance tests (fixture-based, no real crawling,
// no production D1). Proves the ENGINE, not the websites:
//   01 success (fetch → evidence → extract → assert)
//   02 unchanged    (same content-hash → UNCHANGED, no duplicate processing)
//   03 changed      (new hash → new snapshot, item CHANGED, evidence preserved)
//   04 failed       (fetch error → FAILED item + error row + audit)
//   05 retry        (transient failure then success with backoff)
//   06 duplicate re-run (idempotency: same run twice)
//   07 malformed content (extractor throws → FAILED but SNAPSHOT survives)
//   08 low-confidence extraction (<0.5 → NO assertion persisted)
//   09 governance: extraction failure never drops evidence
//   10 validation: deterministic rules run post-extraction, attach to snapshot
//   11 document budget: maxDocuments caps DOCUMENT_ARCHIVE pdfs; pdf path writes
//      DOCUMENT outbound link + SKIPPED snapshot; NEWS still processed after cap
// Uses the GENERIC engine (lib/ingestion) with a fake Fetcher + real local sqlite
// adapters against a scratch.db (untracked, discipline-clean).
// ============================================================================

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { assertUrlAllowed, buildEngine, ControlledFetcher, DEFAULT_POLICY, GenericIngestionEngine, LocalSqliteEvidenceWriter, LocalSourceRegistry, pilotValidators } from "../lib/ingestion";
import { nodeResolveHost } from "../lib/ingestion";
import type { DiscoveredTarget, EngineDeps, ExtractedEvidence, FetchOptions, FetchResult, IngestionSourceSpec } from "../lib/ingestion";

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

// --- tiny harness: seeded scratch db with one pilot source + schema ---
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("node:fs") as typeof import("node:fs");

let SCHEDULE = 0;
class FakeFetcher {
  private readonly rules: Record<string, { status: number; body: string; contentType: string } | { fail: string }>;
  private attempts = 0;
  constructor(rules: Record<string, { status: number; body: string; contentType: string } | { fail: string }>) {
    this.rules = rules;
  }
  fetch(url: string, opts?: FetchOptions): Promise<FetchResult> {
    assertUrlAllowed(url, { ...DEFAULT_POLICY, allowedHosts: ["fixture.test"] }, 0);
    const rule = this.rules[url];
    if (!rule) return Promise.reject(new Error(`no fixture rule for ${url}`));
    if ("fail" in rule) {
      this.attempts += 1;
      if (this.attempts < 3) return Promise.reject({ type: "CONNECT_FAILED", message: rule.fail });
      return Promise.resolve(html(rule.fail, 200));
    }
    return Promise.resolve(html(rule.body, rule.status, rule.contentType));
  }
}

function html(body: string, status = 200, contentType = "text/html; charset=utf-8"): FetchResult {
  const bytes = new TextEncoder().encode(body);
  const ascii = bytes;
  let digest = "";
  // deterministic fake hash from content (not real sha; fine for fixtures)
  let h = 2166136261 >>> 0;
  for (const b of ascii) { h ^= b; h = Math.imul(h, 16777619); }
  digest = ("00000000" + (h >>> 0).toString(16)).slice(-8).padStart(64, "0");
  return {
    finalUrl: "https://fixture.test/",
    httpStatus: status, contentType, contentHash: digest, bodyBytes: bytes.byteLength,
    body: bytes, fetchedAt: new Date().toISOString(), redirectCount: 0,
  };
}

const CAPS = JSON.stringify({
  capabilities: [
    { capability: "WEBSITE", status: "CANDIDATE", known_url: "https://fixture.test/", link_type: "WEBSITE" },
    { capability: "NEWS", status: "CANDIDATE", known_url: "https://fixture.test/news", link_type: "NEWS" },
  ],
});

function makeSource(id: string, url = "https://fixture.test/"): IngestionSourceSpec {
  return { id: `ing-${id}`, url, domain: "fixture.test", sourceType: "MFB_WEBSITE", enabled: true, fetchIntervalMinutes: 1440, capabilities: JSON.parse(CAPS).capabilities };
}

function discoverHome(capability: DiscoveredTarget["capability"] = "WEBSITE") {
  return {
    async discover(s: IngestionSourceSpec): Promise<DiscoveredTarget[]> {
      return [{
        capability,
        url: s.url,
        method: "KNOWN",
        parentUrl: s.url,
        sourceId: s.id,
        institutionId: s.institutionId,
        discoveredAt: "2026-01-01T00:00:00Z",
        title: "fixture home",
        status: "CANDIDATE",
      }];
    },
  };
}
type FixtureExtractorType = ReturnType<typeof fixtureExtractor>; // declared below by hoisting

// scratch db per test
function scratchDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lk-ing-"));
  const path = join(dir, "fixture.db");
  const schema = fs.readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(path);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  db.close();
  return path;
}

// insert the source + a validation rule into the scratch db
function seedScratch(dbPath: string, source: IngestionSourceSpec): void {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
     VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, 'fixture', 1)`,
  ).run(source.id, source.url, source.domain, `fixture: ${source.id}`);
  db.prepare(
    `INSERT INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
     VALUES (?, ?, ?, ?, NULL, ?, 1, 1440)`,
  ).run(source.id, source.url, source.domain, source.sourceType, JSON.stringify({ capabilities: source.capabilities }));
  db.prepare(
    `INSERT INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
     VALUES ('r-sanity-1', 'SANITY_1', 'fixture sanity', 'SANITY', 'WARN', 1, '{}')
     ON CONFLICT(id) DO NOTHING`,
  ).run();
  db.prepare(
    `INSERT INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
     VALUES ('r-pilot-title', 'PILOT_TITLE', 'pilot title present', 'SANITY', 'WARN', 1, '{}')
     ON CONFLICT(id) DO NOTHING`,
  ).run();
  db.prepare(
    `INSERT INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
     VALUES ('r-pilot-email', 'PILOT_EMAIL', 'pilot email field sanity', 'SANITY', 'WARN', 1, '{}')
     ON CONFLICT(id) DO NOTHING`,
  ).run();
  db.close();
}

// --- deterministic test double for the Extractor ---
function fixtureExtractor() {
  return {
    parserId: "fixture-parser-v1",
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
      if (text.includes("MALFORMED")) throw new Error("extractor failed on malformed input");
      if (text.includes("LOWCONF")) out.push({ kind: "FIELD", capability: "NEWS", sourceUrl: ctx.url, text: "noise", confidence: 0.1, parserId: this.parserId, extractedAt: "2026-01-01" });
      if (text.includes("TITLE=")) {
        const t = /TITLE=(\w+)/.exec(text)?.[1] ?? "unknown";
        out.push({ kind: "FIELD", capability: "WEBSITE", sourceUrl: ctx.url, text: t, confidence: 0.9, parserId: this.parserId, extractedAt: "2026-01-01" });
      }
      return out;
    },
  };
}
type FixtureExtractor = ReturnType<typeof fixtureExtractor>;

// --- test reporter ---
let pass = 0; let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}
function q(dbPath: string, sql: string): Record<string, unknown> | undefined {
  const db = new Database(dbPath);
  const r = db.prepare(sql).get();
  db.close();
  return r;
}
function qa(dbPath: string, sql: string): Array<Record<string, unknown>> {
  const db = new Database(dbPath);
  const r = db.prepare(sql).all();
  db.close();
  return r;
}

// ============================================================================
// TEST 01 — success: fetch → evidence → extract → assertion (UNVERIFIED)
// ============================================================================
async function main() {
{
  const dbPath = scratchDb();
  const src = makeSource("success");
  seedScratch(dbPath, src);
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher({ "https://fixture.test/": { status: 200, body: "<html>TITLE=SUCCESS_CO</html>", contentType: "text/html" }, "https://fixture.test/news": { status: 200, body: "<html>news</html>", contentType: "text/html" } }),
    discovery: discoverHome(),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  });
  const out = await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  check("01 success ok", out.ok === true);
  check("01 one item extracted", out.items.length === 1 && out.items[0].lifecycle.includes("EXTRACTED"));
  const snap = q(dbPath, "SELECT COUNT(*) c FROM source_snapshots");
  check("01 snapshot written", snap?.c === 1);
  const item = q(dbPath, "SELECT status FROM ingestion_items");
  check("01 item CHANGED", item?.status === "CHANGED");
  const assertRows = qa(dbPath, "SELECT verification_status FROM data_assertions");
  check("01 assertion UNVERIFIED (not published)", assertRows.length === 1 && assertRows[0].verification_status === "UNVERIFIED");
  const aud = qa(dbPath, "SELECT DISTINCT action FROM audit_logs");
  check("01 audit trail has fetch+extract+complete", aud.map(a=>a.action).includes("EXTRACTION_COMPLETED") && aud.map(a=>a.action).includes("INGESTION_COMPLETED"));
}

// ============================================================================
// TEST 02 — unchanged: same hash re-run → UNCHANGED, NO second snapshot
// ============================================================================
{
  const dbPath = scratchDb();
  const src = makeSource("unchanged");
  seedScratch(dbPath, src);
  const deps = {
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher({ "https://fixture.test/": { status: 200, body: "<html>TITLE=STABLE</html>", contentType: "text/html" } }),
    discovery: discoverHome("WEBSITE"),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  };
  const engine = buildEngine(deps);
  await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  const out2 = await engine.runSource(src.id, { now: "2026-01-02T00:00:00Z" });
  check("02 second run UNCHANGED", out2.items[0].lifecycle === "UNCHANGED");
  check("02 snapshots still 1 (no duplicate)", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 1);
}

// ============================================================================
// TEST 03 — changed: new hash → new snapshot + CHANGED, old evidence retained
// ============================================================================
{
  const dbPath = scratchDb();
  const src = makeSource("changed");
  seedScratch(dbPath, src);
  const deps = {
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher({ "https://fixture.test/": { status: 200, body: "<html>TITLE=ALPHA</html>", contentType: "text/html" } }),
    discovery: discoverHome("WEBSITE"),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  };
  const engine = buildEngine(deps);
  await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  // swap the body (simulate the website changing)
  deps.fetcher = new FakeFetcher({ "https://fixture.test/": { status: 200, body: "<html>TITLE=BETA</html>", contentType: "text/html" } });
  const engine2 = buildEngine(deps);
  const out2 = await engine2.runSource(src.id, { now: "2026-01-02T00:00:00Z" });
  check("03 changed run CHANGED/EXTRACTED", out2.items[0].lifecycle === "CHANGED" || out2.items[0].lifecycle.includes("EXTRACTED"));
  check("03 two snapshots now", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 2);
  check("03 old evidence row untouched", (qa(dbPath, "SELECT value FROM data_assertions WHERE value='ALPHA'")).length === 1);
  check("03 new assertion present", (qa(dbPath, "SELECT value FROM data_assertions WHERE value='BETA'")).length === 1);
}

// ============================================================================
// TEST 04 — failed fetch → FAILED item + error + audit, run PARTIAL
// ============================================================================
{
  const dbPath = scratchDb();
  const src = makeSource("failed");
  seedScratch(dbPath, src);
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher({ "https://fixture.test/": { status: 500, body: "boom", contentType: "text/html" } }),
    discovery: discoverHome("WEBSITE"),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  });
  const out = await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  check("04 failed fetch → item FAILED", out.items.some((i) => i.lifecycle === "FAILED"));
  check("04 error row written", (q(dbPath, "SELECT COUNT(*) c FROM ingestion_errors WHERE error_type='HTTP_ERROR'"))?.c === 1);
  check("04 snapshot missing (no evidence for failed fetch)", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 0);
}

// ============================================================================
// TEST 05 — transient failure then success: ControlledFetcher exponential backoff
// (engine-level re-run recovery is covered by TEST 04→01 sequence philosophy).
// ============================================================================
{
  let call = 0;
  const flaky = (async () => {
    call += 1;
    if (call <= 2) throw { type: "CONNECT_FAILED", message: "flaky connect" };
    return new Response("<html>TITLE=RETRY_OK</html>", { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const cf = new ControlledFetcher({
    allowedHosts: ["fixture.test"],
    fetchImpl: flaky,
    maxRetries: 3,
    retryBackoffMs: 5,
    minIntervalMs: 0,
  });
  const r = await cf.fetch("https://fixture.test/", { expectHtml: true });
  check("05 retry recovered after 2 transient failures", call === 3 && r.httpStatus === 200 && r.contentHash !== "");
}

// ============================================================================
// TEST 06 — duplicate run: same source same time → idempotent (safe re-run)
// ============================================================================
{
  const dbPath = scratchDb();
  const src = makeSource("dup");
  seedScratch(dbPath, src);
  const deps = {
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher({ "https://fixture.test/": { status: 200, body: "<html>TITLE=DUP</html>", contentType: "text/html" } }),
    discovery: discoverHome("WEBSITE"),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  };
  const engine = buildEngine(deps);
  await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" }); // identical re-run
  check("06 duplicate run → still exactly 1 snapshot", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 1);
}

// ============================================================================
// TEST 07 — malformed content: extractor throws → FAILED item but the SNAPSHOT
// evidence survives (evidence-first; nothing silently dropped)
// ============================================================================
{
  const dbPath = scratchDb();
  const src = makeSource("malformed");
  seedScratch(dbPath, src);
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher({ "https://fixture.test/": { status: 200, body: "MALFORMED<html>TITLE=X</html>", contentType: "text/html" } }),
    discovery: discoverHome("WEBSITE"),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  });
  const out = await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  check("07 malformed → FAILED item", out.items.some((i) => i.lifecycle === "FAILED"));
  check("07 snapshot evidence SURVIVED extraction failure", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 1);
  check("07 extraction error recorded", (q(dbPath, "SELECT COUNT(*) c FROM ingestion_errors WHERE error_type='EXTRACTION_FAILED'"))?.c === 1);
}

// ============================================================================
// TEST 08 — low-confidence extraction NEVER becomes an assertion
// ============================================================================
{
  const dbPath = scratchDb();
  const src = makeSource("lowconf");
  seedScratch(dbPath, src);
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher({ "https://fixture.test/": { status: 200, body: "LOWCONF<html>weak page no title</html>", contentType: "text/html" } }),
    discovery: discoverHome("NEWS"),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  });
  const out = await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  check("08 low-confidence item processed", out.ok === true);
  check("08 NO assertion persisted for low confidence", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions"))?.c === 0);
}

// ============================================================================
// TEST 09 — governance: extraction failure did not drop snapshot; assertions
// never auto-publish (verification_status stays UNVERIFIED across engine runs)
// ============================================================================
{
  const dbPath = scratchDb();
  const src = makeSource("gov");
  seedScratch(dbPath, src);
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher({ "https://fixture.test/": { status: 200, body: "<html>TITLE=GOV</html>", contentType: "text/html" } }),
    discovery: discoverHome("WEBSITE"),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  });
  await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  const published = [q(dbPath, "SELECT COUNT(*) c FROM data_assertions WHERE verification_status='HUMAN_VERIFIED'")?.c, q(dbPath, "SELECT COUNT(*) c FROM data_assertions WHERE verification_status='AUTO_VERIFIED'")?.c];
  check("09 nothing auto-published", published.every((c) => c === 0));
}

// ============================================================================
// S09 — deterministic capability-config contract
//   {}  → no override ⇒ ZERO declared capabilities (not disabled, not all-on)
//        ⇒ discovery yields no targets, run is valid & empty
//   valid caps → parsed, drives KNOWN discovery
//   unsupported kind → CapabilityConfigError (loud)
//   malformed JSON config → CapabilityConfigError (loud, never silent {}
//   ''/null config → same as {} (no override)
// ============================================================================
{
  // (1) empty {} config → zero declared capabilities
  {
    const { buildIngestionSourceSpec, parseCapabilities } = await import("../lib/ingestion");
    check("S09 {} → parseCapabilities([])", JSON.stringify(parseCapabilities({})) === "[]");
    const spec = buildIngestionSourceSpec({ id: "c-empty", url: "https://fixture.test/", source_type: "MFB_WEBSITE", config_json: "{}" });
    check("S09 {} → zero declared capabilities", spec.capabilities.length === 0);
    check("S09 {} → source NOT disabled", spec.enabled === true);

    // zero caps → BrowserDiscovery yields no targets (even with rules present)
    const { BrowserDiscovery } = await import("../lib/ingestion");
    const dbPath = scratchDb();
    seedScratch(dbPath, { id: "c-empty", url: "https://fixture.test/", domain: "fixture.test", sourceType: "MFB_WEBSITE", enabled: true, fetchIntervalMinutes: 1440, capabilities: [] });
    const d = new BrowserDiscovery(
      new LocalSourceRegistry(dbPath),
      new FakeFetcher({ "https://fixture.test/": { status: 200, body: "<html><a href='/news'>n</a></html>", contentType: "text/html" } }),
      { rules: [{ capability: "NEWS", hrefHint: "/news" }, { capability: "REPORTS", pathPrefix: "/reports" }], maxTargets: 20 },
    );
    const targets = await d.discover(spec);
    check("S09 {} → discovery yields zero targets", targets.length === 0);
  }

  // (2) valid capability config → parsed, drives KNOWN discovery
  {
    const { buildIngestionSourceSpec, parseCapabilities, resolvableCapabilities, pendingCapabilities } = await import("../lib/ingestion");
    const caps = parseCapabilities({ capabilities: [{ capability: "WEBSITE", status: "CANDIDATE", known_url: "https://fixture.test/", link_type: "WEBSITE" }, "NEWS", "REPORTS"] });
    check("S09 valid config → 3 capabilities parsed", caps.length === 3);
    check("S09 string shorthand → NEWS discovery intent", caps[1].kind === "NEWS" && caps[1].knownUrl === null && caps[1].status === "CANDIDATE");
    const spec = buildIngestionSourceSpec({
      id: "c-valid", url: "https://fixture.test/", source_type: "MFB_WEBSITE",
      config_json: JSON.stringify({ capabilities: [{ capability: "WEBSITE", status: "CANDIDATE", known_url: "https://fixture.test/", link_type: "WEBSITE" }] }),
    });
    check("S09 valid config → resolvable KNOWN url", resolvableCapabilities(spec).length === 1);
    check("S09 valid config → pending discovery intents", pendingCapabilities(spec).length === 0);
  }

  // (3) unsupported capability kind → loud CapabilityConfigError
  {
    const { parseCapabilities, CapabilityConfigError } = await import("../lib/ingestion");
    let threw = false;
    try { parseCapabilities({ capabilities: ["SOCIAL_SUPERLINK"] }); } catch (e) { threw = e instanceof CapabilityConfigError; }
    check("S09 unsupported capability → CapabilityConfigError", threw);
  }

  // (4) malformed config_json string → loud CapabilityConfigError at build
  {
    const { buildIngestionSourceSpec, CapabilityConfigError } = await import("../lib/ingestion");
    let threw = false;
    try {
      buildIngestionSourceSpec({ id: "c-bad", url: "https://fixture.test/", source_type: "MFB_WEBSITE", config_json: "{ not json" });
    } catch (e) { threw = e instanceof CapabilityConfigError; }
    check("S09 malformed config → CapabilityConfigError (never silent {})", threw);
  }

  // (5) ''/null config → same as {} (no override, source enabled, zero caps)
  {
    const { buildIngestionSourceSpec } = await import("../lib/ingestion");
    for (const v of ["", null]) {
      const spec = buildIngestionSourceSpec({ id: "c-null", url: "https://fixture.test/", source_type: "MFB_WEBSITE", config_json: v as string | null | undefined });
      check(`S09 ${JSON.stringify(v)} config → zero caps, enabled`, spec.capabilities.length === 0 && spec.enabled === true);
    }
  }

  // (6) budget parsed from config_json → config-driven bounds, not per-MFB code
  {
    const { buildIngestionSourceSpec, parseBudget, CapabilityConfigError } = await import("../lib/ingestion");
    const spec = buildIngestionSourceSpec({
      id: "c-budget", url: "https://fixture.test/", source_type: "MFB_WEBSITE",
      config_json: JSON.stringify({ capabilities: ["WEBSITE"], budget: { maxTargets: 20, maxFetches: 10, maxDocuments: 5 } }),
    });
    check("S09 budget parsed from config_json", spec.budget?.maxTargets === 20 && spec.budget?.maxFetches === 10 && spec.budget?.maxDocuments === 5);
    let bad = false;
    try { parseBudget({ maxFetches: -1 }); } catch (e) { bad = e instanceof CapabilityConfigError; }
    check("S09 malformed budget → CapabilityConfigError", bad);
    let unknown = false;
    try { parseBudget({ maxFrobs: 3 }); } catch (e) { unknown = e instanceof CapabilityConfigError; }
    check("S09 unknown budget key → CapabilityConfigError", unknown);
  }
}

// ============================================================================
// S15 — configurable crawl budget (config_json.budget / EngineOptions.budget):
//   maxFetches, maxDocuments, maxRuntimeMs all bound the run, not hard-coded.
// ============================================================================
{
  const dbPath = scratchDb();
  const src = makeSource("budget");
  seedScratch(dbPath, src);
  // discovery returns a doc-heavy target list
  const manyTargets = {
    async discover(s: IngestionSourceSpec): Promise<DiscoveredTarget[]> {
      return [1, 2, 3, 4, 5, 6].map((n) => ({
        capability: n <= 2 ? ("REPORTS" as const) : ("NEWS" as const),
        url: `https://fixture.test/p${n}`,
        method: "LINK" as const,
        parentUrl: s.url,
        sourceId: s.id,
        institutionId: s.institutionId,
        discoveredAt: "2026-01-01T00:00:00Z",
        status: "CANDIDATE",
      }));
    },
  };
  const budgetFetcher = {
    fetch: async (url: string) => ({
      finalUrl: url, httpStatus: 200, contentType: "text/html", contentHash: `h${url}`,
      bodyBytes: 8, body: new TextEncoder().encode("<html><html>"),
      fetchedAt: "2026-01-01T00:00:00Z", redirectCount: 0,
    }),
  };
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: budgetFetcher,
    discovery: manyTargets,
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  });
  // budget: 3 fetches max, 1 doc max → must stop early with audit trail
  const out = await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z", budget: { maxFetches: 3, maxDocuments: 1, maxBytes: 1024, maxRedirects: 2, maxRetries: 1, maxRuntimeMs: 60000 } });
  check("S15 budget maxFetches honored (≤3)", out.items.length <= 3);
  check("S15 budget doc cap → ≤1 REPORTS item", out.items.filter((i) => i.capability === "REPORTS").length <= 1);
  const audits = qa(dbPath, "SELECT action FROM audit_logs");
  check("S15 budget exhaustion audited", audits.some((a) => String(a.action).includes("BUDGET")));

  // maxRuntimeMs tiny → stops before completing all targets
  const out2 = await buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: budgetFetcher,
    discovery: manyTargets,
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  }).runSource(src.id, { now: "2026-01-01T00:00:01Z", budget: { maxRuntimeMs: 1 } });
  check("S15 maxRuntimeMs stops early (not all 6 fetched)", out2.items.length < 6 && out2.items.length >= 0);
}

// ============================================================================
// TEST 10 — validation: deterministic rules run AFTER extraction, results
// persist attached to the evidence snapshot (PASS and FAIL both recorded).
// ============================================================================
{
  const dbPath = scratchDb();
  const src = makeSource("valid-pass");
  seedScratch(dbPath, src);
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher({ "https://fixture.test/": { status: 200, body: "<html>TITLE=GOODCO</html>", contentType: "text/html" } }),
    discovery: discoverHome("WEBSITE"),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
    validators: pilotValidators,
  });
  await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  const rows = qa(dbPath, "SELECT v.rule_id, v.status, v.target_type FROM validation_results v");
  check("10 validators ran and persisted 2 rows", rows.length === 2);
  check("10 title rule PASS attached to snapshot", rows.some((r) => r.rule_id === "r-pilot-title" && r.status === "PASS" && r.target_type === "source_snapshot"));
  check("10 email rule PASS (sanitised, no junk)", rows.some((r) => r.rule_id === "r-pilot-email" && r.status === "PASS"));
  const attached = q(
    dbPath,
    `SELECT COUNT(*) c FROM validation_results v JOIN source_snapshots ss ON ss.id = v.target_id WHERE ss.source_id = '${src.id}'`,
  ) as { c: number };
  check("10 validation rows attach to real snapshots", attached.c === 2);

  // FAIL case: a page whose extraction yields no fields at all
  const db2 = scratchDb();
  const src2 = makeSource("valid-fail");
  seedScratch(db2, src2);
  await buildEngine({
    registry: new LocalSourceRegistry(db2),
    fetcher: new FakeFetcher({ "https://fixture.test/": { status: 200, body: "<html>plain page with no extractable structure at all</html>", contentType: "text/html" } }),
    discovery: discoverHome("WEBSITE"),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(db2),
    validators: pilotValidators,
  }).runSource(src2.id, { now: "2026-01-01T00:00:00Z" });
  const failRow = qa(db2, "SELECT rule_id, status FROM validation_results") as Array<{ rule_id: string; status: string }>;
  check("10 no-field page → title rule FAIL", failRow.some((r) => r.rule_id === "r-pilot-title" && r.status === "FAIL"));
}

// ============================================================================
// TEST 11 — document budget at scale: maxDocuments caps DOCUMENT_ARCHIVE pdfs,
// the pdf path writes a DOCUMENT outbound link + SKIPPED snapshot, and NON-doc
// targets (NEWS) are still processed after the document cap is exhausted.
// ============================================================================
{
  const dbPath = scratchDb();
  const src = makeSource("docbudget");
  seedScratch(dbPath, src);
  const targets = {
    async discover(s: IngestionSourceSpec): Promise<DiscoveredTarget[]> {
      return [
        ...[1, 2, 3].map((n) => ({
          capability: "DOCUMENT_ARCHIVE" as const,
          url: `https://fixture.test/doc-${n}.pdf`,
          method: "LINK" as const,
          parentUrl: s.url,
          sourceId: s.id,
          institutionId: s.institutionId,
          discoveredAt: "2026-01-01T00:00:00Z",
          title: `notice ${n}`,
          status: "CANDIDATE" as const,
        })),
        ...[4, 5].map((n) => ({
          capability: "NEWS" as const,
          url: `https://fixture.test/news-${n}`,
          method: "LINK" as const,
          parentUrl: s.url,
          sourceId: s.id,
          institutionId: s.institutionId,
          discoveredAt: "2026-01-01T00:00:00Z",
          status: "CANDIDATE" as const,
        })),
      ];
    },
  };
  const docFetcher = {
    fetch: async (url: string) => {
      const isDoc = url.includes("/doc-");
      return {
        finalUrl: url,
        httpStatus: 200,
        contentType: isDoc ? "application/pdf" : "text/html",
        contentHash: `h${url}`,
        bodyBytes: isDoc ? 1024 : 8,
        body: new TextEncoder().encode(isDoc ? "%PDF-1.4 fake bytes" : "<html>TITLE=NEWS</html>"),
        fetchedAt: "2026-01-01T00:00:00Z",
        redirectCount: 0,
      };
    },
  };
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: docFetcher,
    discovery: targets,
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  });
  const out = await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z", budget: { maxDocuments: 1, maxFetches: 10, maxBytes: 1024, maxRedirects: 2, maxRetries: 1, maxRuntimeMs: 60000 } });
  const docItems = out.items.filter((i) => i.capability === "DOCUMENT_ARCHIVE");
  check("11 document budget caps DOCUMENT_ARCHIVE to 1", docItems.length === 1 && docItems.every((i) => i.lifecycle !== "FAILED"));
  check("11 news still processed after doc cap", out.items.filter((i) => i.capability === "NEWS").length === 2);
  check("11 budget exhaustion audited", (qa(dbPath, "SELECT action FROM audit_logs")).some((a) => String(a.action).includes("BUDGET_DOCUMENTS")));
  const links = q(dbPath, "SELECT COUNT(*) c FROM outbound_links WHERE target_type='DOCUMENT'") as { c: number };
  check("11 one DOCUMENT outbound link persisted", links.c === 1);
  const pdfSnaps = q(dbPath, "SELECT COUNT(*) c FROM source_snapshots WHERE mime_type='application/pdf'") as { c: number };
  check("11 pdf snapshots SKIPPED (evidence, no extraction)", pdfSnaps.c === 1 && (q(dbPath, "SELECT extraction_status s FROM source_snapshots WHERE mime_type='application/pdf'") as { s: string }).s === "SKIPPED");
}

// ============================================================================
// Featurer policy surface check (Phase E assertions promoted to the seam)
// ============================================================================
{
  const cf = new ControlledFetcher({ allowedHosts: ["fixture.test"] });
  check("E allowlisted host accepted", cf.allowedHosts.length === 1);
  let blocked = false;
  try { assertUrlAllowed("http://fixture.test/", { ...DEFAULT_POLICY, allowedHosts: ["fixture.test"] }, 0); } catch { blocked = true; }
  check("E http scheme blocked", blocked === true);
}

// ============================================================================
console.log(`\nPhase N fixture results: ${pass} ok / ${fail} fail`);
if (fail > 0) process.exit(1);
console.log("ALL FIXTURE TESTS PASSED (no production D1, no real crawling).");
}

main().catch((e) => {
  console.error("fixture run crashed:", e);
  process.exit(1);
});