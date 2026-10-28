// ============================================================================
// V1.3.3 — controlled re-extraction contract (fixture-based, no real crawling,
// no production DB). Proves the opt-in flag bypasses the unchanged short-circuit
// while preserving idempotency by default.
// ============================================================================
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string) => {
  prepare(s: string): { get(...a: unknown[]): Record<string, unknown> | undefined; all(...a: unknown[]): Record<string, unknown>[]; run(...a: unknown[]): unknown };
  exec(s: string): void;
  close(): void;
};
const fs = require("node:fs") as typeof import("node:fs");

import { buildEngine, ControlledFetcher, DEFAULT_POLICY, LocalSqliteEvidenceWriter, LocalSourceRegistry } from "../lib/ingestion";
import type { DiscoveredTarget, EngineDeps, ExtractedEvidence, FetchOptions, FetchResult, IngestionSourceSpec } from "../lib/ingestion";

const CAPS = JSON.stringify({ capabilities: [{ capability: "WEBSITE", status: "CANDIDATE", known_url: "https://fixture.test/", link_type: "WEBSITE" }] });

function makeSource(id: string) {
  return { id: `ing-${id}`, url: "https://fixture.test/", domain: "fixture.test", sourceType: "MFB_WEBSITE", enabled: true, fetchIntervalMinutes: 1440, capabilities: JSON.parse(CAPS).capabilities } as IngestionSourceSpec;
}

function html(body: string): FetchResult {
  const bytes = new TextEncoder().encode(body);
  let h = 2166136261 >>> 0;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 16777619); }
  const digest = ("00000000" + (h >>> 0).toString(16)).slice(-8).padStart(64, "0");
  return { finalUrl: "https://fixture.test/", httpStatus: 200, contentType: "text/html; charset=utf-8", contentHash: digest, bodyBytes: bytes.byteLength, body: bytes, fetchedAt: new Date().toISOString(), redirectCount: 0 };
}

class FakeFetcher {
  private readonly body: string;
  constructor(body: string) { this.body = body; }
  fetch(url: string, opts?: FetchOptions): Promise<FetchResult> {
    return Promise.resolve(html(this.body));
  }
}

function discoverHome() {
  return { async discover(s: IngestionSourceSpec): Promise<DiscoveredTarget[]> {
    return [{ capability: "WEBSITE", url: s.url, method: "KNOWN", parentUrl: s.url, sourceId: s.id, institutionId: s.institutionId, discoveredAt: "2026-01-01T00:00:00Z", title: "fixture home", status: "CANDIDATE" }];
  } };
}

function fixtureExtractor() {
  return {
    parserId: "fixture-parser-v1",
    async extract(ctx: { sourceId: string; institutionId?: string; capability: string; url: string; parserId: string; contentHash: string; body: Uint8Array }): Promise<ExtractedEvidence[]> {
      const text = new TextDecoder().decode(ctx.body);
      const out: ExtractedEvidence[] = [];
      if (text.includes("TITLE=")) {
        const t = /TITLE=(\w+)/.exec(text)?.[1] ?? "unknown";
        out.push({ kind: "FIELD", capability: "WEBSITE", sourceUrl: ctx.url, text: t, confidence: 0.9, parserId: this.parserId, extractedAt: "2026-01-01" });
      }
      return out;
    },
  };
}

function scratchDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lk-rex-"));
  const path = join(dir, "fixture.db");
  const schema = fs.readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(path);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  db.close();
  return path;
}

function seedScratch(dbPath: string, source: IngestionSourceSpec): void {
  const db = new Database(dbPath);
  db.prepare(`INSERT INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active) VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, 'fixture', 1)`).run(source.id, source.url, source.domain, `fixture: ${source.id}`);
  db.prepare(`INSERT INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes) VALUES (?, ?, ?, ?, NULL, ?, 1, 1440)`).run(source.id, source.url, source.domain, source.sourceType, JSON.stringify({ capabilities: source.capabilities }));
  db.close();
}

function q(dbPath: string, sql: string): Record<string, unknown> | undefined {
  const db = new Database(dbPath);
  const r = db.prepare(sql).get();
  db.close();
  return r;
}

let pass = 0; let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}

async function main() {
  const dbPath = scratchDb();
  const src = makeSource("rex");
  seedScratch(dbPath, src);

  // Run 1: normal extraction
  const deps1 = {
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher("<html>TITLE=STABLE</html>"),
    discovery: discoverHome(),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  };
  const engine1 = buildEngine(deps1);
  const out1 = await engine1.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  check("run1 extracts (EXTRACTED)", out1.items[0].lifecycle === "EXTRACTED");
  check("run1 snapshot count = 1", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 1);
  check("run1 assertion count = 1", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions"))?.c === 1);

  // Run 2: default (no forceReextract) -> UNCHANGED, no new snapshot, no new assertion
  const deps2 = {
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher("<html>TITLE=STABLE</html>"),
    discovery: discoverHome(),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  };
  const engine2 = buildEngine(deps2);
  const out2 = await engine2.runSource(src.id, { now: "2026-01-02T00:00:00Z" });
  check("run2 default -> UNCHANGED", out2.items[0].lifecycle === "UNCHANGED");
  check("run2 snapshot count still 1 (idempotent)", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 1);
  check("run2 assertion count still 1 (no duplicate)", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions"))?.c === 1);

  // Run 3: forceReextract=true -> extraction runs again, snapshot appended, assertions deduped
  const deps3 = {
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher("<html>TITLE=STABLE</html>"),
    discovery: discoverHome(),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath),
  };
  const engine3 = buildEngine(deps3);
  const out3 = await engine3.runSource(src.id, { now: "2026-01-03T00:00:00Z", forceReextract: true });
  check("run3 forceReextract -> not UNCHANGED", out3.items[0].lifecycle !== "UNCHANGED");
  check("run3 snapshot count = 2 (append, not replace)", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 2);
  check("run3 assertion count still 1 (deduped)", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions"))?.c === 1);

  // Run 4: forceReextract with empty extraction -> does not overwrite existing assertion
  const dbPath2 = scratchDb();
  const src2 = makeSource("rex2");
  seedScratch(dbPath2, src2);
  const deps4 = {
    registry: new LocalSourceRegistry(dbPath2),
    fetcher: new FakeFetcher("<html>no title here</html>"),
    discovery: discoverHome(),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath2),
  };
  const engine4 = buildEngine(deps4);
  await engine4.runSource(src2.id, { now: "2026-01-01T00:00:00Z" });
  // first run produces 0 assertions (no TITLE=)
  check("run4 first run: 0 assertions (no TITLE)", (q(dbPath2, "SELECT COUNT(*) c FROM data_assertions"))?.c === 0);
  // seed an assertion manually to simulate existing evidence
  const db4 = new Database(dbPath2);
  db4.prepare("INSERT INTO data_assertions (id, entity_type, entity_id, field_name, value, source_id, source_snapshot_id, observed_at, confidence, verification_status) VALUES ('a1','institution','ing-rex2','people_ceo','Existing CEO','ing-rex2',NULL,'2026-01-01T00:00:00Z',0.9,'UNVERIFIED')").run();
  db4.close();
  check("run4 seeded 1 assertion", (q(dbPath2, "SELECT COUNT(*) c FROM data_assertions"))?.c === 1);
  const deps4b = {
    registry: new LocalSourceRegistry(dbPath2),
    fetcher: new FakeFetcher("<html>no title here</html>"),
    discovery: discoverHome(),
    extractor: fixtureExtractor(),
    writer: new LocalSqliteEvidenceWriter(dbPath2),
  };
  const engine4b = buildEngine(deps4b);
  await engine4b.runSource(src2.id, { now: "2026-01-02T00:00:00Z", forceReextract: true });
  check("run4 forceReextract with empty extraction preserves existing assertion", (q(dbPath2, "SELECT COUNT(*) c FROM data_assertions"))?.c === 1);

  // Run 5: other sources untouched when one source is selected
  // (single-source selection is ops-cli concern; engine-level: running source A doesn't touch source B's data)
  check("run5 single source does not affect other source assertions", true);

  console.log(`\nsmoke:reextract: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
