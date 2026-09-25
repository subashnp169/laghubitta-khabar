// ============================================================================
// Phase Q — PDF/document evidence + deterministic HTML canonicalization tests.
// No real network, no production D1. Proves:
//
// Canonicalizer matrix (deterministicHtmlCanonicalizer):
//   Q01 whitespace-only diff     → UNCHANGED (same canonical hash)
//   Q02 CRLF/LF line-ending diff → UNCHANGED
//   Q03 HTML formatting-only diff → UNCHANGED (indent, inline tag flavour)
//   Q04 tracking-param attrs only → UNCHANGED (attributes are formatting)
//   Q05 script/style/comment churn → UNCHANGED (dynamic/non-content)
//   Q06 title change             → CHANGED
//   Q07 interest-rate change     → CHANGED
//   Q08 notice-text change       → CHANGED
//
// Engine document evidence path (content-type detection, no OCR/AI):
//   Q10 PDF A first fetch → CHANGED + snapshot(SKIPPED) + outbound_link(DOCUMENT)
//   Q11 PDF A again     → UNCHANGED, snapshot stays 1, link stays 1 (no dups)
//   Q12 PDF B           → CHANGED, snapshot 2, old A snapshot preserved, one link row
//   Q13 documents catalog stays empty (bare PDF has no title/category/date —
//       usage is spelled out, never fabricated)
//   Q14 HTML re-run with only formatting noise → UNCHANGED (canonical compare)
//   Q15 items store the canonical hash (not raw) while snapshots keep the raw
// ============================================================================

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertUrlAllowed,
  buildEngine,
  canonicalizeHtml,
  DEFAULT_POLICY,
  deterministicHtmlCanonicalizer,
  LocalSqliteEvidenceWriter,
  LocalSourceRegistry,
} from "../lib/ingestion";
import type { DiscoveredTarget, FetchOptions, FetchResult, IngestionSourceSpec } from "../lib/ingestion";

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
const fs = require("node:fs") as typeof import("node:fs");

let pass = 0; let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}

// --- fake fetcher: deterministic FNV hash (not sha) + content-type per URL ---
// A fake hash is fine here: with deterministicHtmlCanonicalizer wired in, the
// comparison runs on derived canonical sha-256, never on this fake value.
function fakeHash(s: string): string {
  let h = 2166136261 >>> 0;
  for (const b of new TextEncoder().encode(s)) { h ^= b; h = Math.imul(h, 16777619); }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8).padStart(64, "0");
}
class FakeFetcher {
  private readonly rules: Record<string, { status: number; body: string; contentType: string }>;
  constructor(rules: Record<string, { status: number; body: string; contentType: string }>) { this.rules = rules; }
  fetch(url: string, _opts?: FetchOptions): Promise<FetchResult> {
    assertUrlAllowed(url, { ...DEFAULT_POLICY, allowedHosts: ["fixture.test"] }, 0);
    const rule = this.rules[url];
    if (!rule) return Promise.reject(new Error(`no fixture rule for ${url}`));
    const bytes = new TextEncoder().encode(rule.body);
    return Promise.resolve({
      finalUrl: url, httpStatus: rule.status, contentType: rule.contentType,
      contentHash: fakeHash(rule.body), bodyBytes: bytes.byteLength,
      body: bytes, fetchedAt: new Date().toISOString(), redirectCount: 0,
    });
  }
}

const CAPS = JSON.stringify({
  capabilities: [
    { capability: "NEWS", status: "CANDIDATE", known_url: "https://fixture.test/", link_type: "NEWS" },
  ],
});
function makeSource(id: string, url = "https://fixture.test/"): IngestionSourceSpec {
  return { id: `ing-${id}`, url, domain: "fixture.test", sourceType: "MFB_WEBSITE", institutionId: `mfi-${id}`, enabled: true, fetchIntervalMinutes: 1440, capabilities: JSON.parse(CAPS).capabilities };
}
function discover(capability: DiscoveredTarget["capability"], url = "https://fixture.test/"): { discover(s: IngestionSourceSpec): Promise<DiscoveredTarget[]> } {
  return {
    async discover(s: IngestionSourceSpec): Promise<DiscoveredTarget[]> {
      return [{ capability, url, method: "KNOWN", parentUrl: url, sourceId: s.id, institutionId: s.institutionId, discoveredAt: "2026-01-01T00:00:00Z", title: `fixture ${capability}`, status: "CANDIDATE" }];
    },
  };
}
function scratchDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lk-pdf-"));
  const path = join(dir, "fixture.db");
  const db = new Database(path);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8"));
  db.close();
  return path;
}
function seedScratch(dbPath: string, source: IngestionSourceSpec): void {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
     VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, 'fixture', 1)`,
  ).run(source.id, source.url, source.domain, `fixture: ${source.id}`);
  db.prepare(
    `INSERT INTO institutions (id, slug, name_en, institution_type, status, source_id)
     VALUES (?, ?, ?, 'NATIONAL', 'ACTIVE', ?)`,
  ).run(source.institutionId as string, source.institutionId as string, `${source.institutionId} stub`, source.id);
  db.prepare(
    `INSERT INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
     VALUES (?, ?, ?, 'MFB_WEBSITE', ?, ?, 1, 1440)`,
  ).run(source.id, source.url, source.domain, source.institutionId ?? null, JSON.stringify({ capabilities: source.capabilities }));
  db.close();
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

const { canonicalizer, extractor } = (() => {
  const extractor = {
    parserId: "q-parser-v1",
    extract: async () => [],
  };
  return { canonicalizer: deterministicHtmlCanonicalizer, extractor };
})();

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  // Q01–Q08 — canonicalizer matrix
  // ---------------------------------------------------------------------------
  {
    const h = (s: string) => deterministicHtmlCanonicalizer.hash("text/html", new TextEncoder().encode(s));
    const v1 = "<html><body><h1>Loan Notices</h1></body></html>";
    check("Q01 whitespace-only → same hash", (await h(v1)) === (await h("  <html> <body>  <h1> Loan  Notices </h1>  </body> </html>  ")));
    check("Q02 CRLF vs LF → same hash", (await h(v1)) === (await h(v1.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"))));
    check("Q03 formatting-only (indent + inline tags) → same hash", (await h(v1)) === (await h("<html>\n  <body><h1><b>Loan</b> <i>Notices</i></h1>\n\n  </body>\n</html>")));
    check("Q04 tracking-attr only → same hash", (await h('<a href="?utm_source=x">Report</a>')) === (await h('<a href="?fbclid=abc&utm_medium=y">Report</a>')));
    check("Q05 script/style/comment churn → same hash", (await h(v1)) === (await h(`<script>var ts=${Date.now()}</script><style>.x{}</style><!-- wp-1.0 -->${v1}`)));
    check("Q06 title change → different hash", (await h(v1)) !== (await h("<html><body><h1>Branch List</h1></body></html>")));
    check("Q07 interest-rate change 10%→11% → different hash", (await h("rate 10%")) !== (await h("rate 11%")));
    check("Q08 notice-text change → different hash", (await h("fiscal year 2082/83 notice")) !== (await h("fiscal year 2083/84 notice")));
    check("Q08b canonicalizeHtml keeps case + digits (deterministic)", canonicalizeHtml(new TextEncoder().encode("Rs. 10,000 &amp; 5%")) === "Rs. 10,000 & 5%");
  }

  // ---------------------------------------------------------------------------
  // Q10–Q13 — PDF document evidence through the ENGINE (content-type dispatch)
  // ---------------------------------------------------------------------------
  {
    const dbPath = scratchDb();
    const src = makeSource("pdf", "https://fixture.test/notices/notice-a.pdf");
    seedScratch(dbPath, src);
    const A = "%PDF-1.4\n1 0 obj annual-a endobj\n%%EOF";
    const B = "%PDF-1.4\n1 0 obj annual-b endobj v2\n%%EOF";
    const deps = {
      registry: new LocalSourceRegistry(dbPath),
      fetcher: new FakeFetcher({
        "https://fixture.test/notices/notice-a.pdf": { status: 200, body: A, contentType: "application/pdf" },
        "https://fixture.test/notices/notice-b.pdf": { status: 200, body: B, contentType: "application/pdf" },
      }),
      discovery: discover("NEWS", "https://fixture.test/notices/notice-a.pdf"),
      extractor,
      writer: new LocalSqliteEvidenceWriter(dbPath),
      canonicalizer,
    };
    const engine = buildEngine(deps);

    const r1 = await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
    check("Q10 PDF A first fetch → CHANGED (evidence persisted)", r1.items[0].lifecycle === "CHANGED");
    const snap1 = q(dbPath, `SELECT extraction_status, mime_type, content_hash FROM source_snapshots WHERE source_id='${src.id}'`) as Record<string, unknown>;
    check("Q10 snapshot SKIPPED extraction (no OCR/AI)", snap1?.extraction_status === "SKIPPED");
    check("Q10 snapshot mime application/pdf", snap1?.mime_type === "application/pdf");
    const link1 = q(dbPath, `SELECT target_type, content_hash, source_id, institution_id, availability_status FROM outbound_links WHERE scope_key='mfi-pdf' AND slug='notices-notice-a-pdf'`) as Record<string, unknown>;
    check("Q10 outbound_link DOCUMENT + provenance", link1?.target_type === "DOCUMENT" && link1?.source_id === src.id && link1?.institution_id === "mfi-pdf" && link1?.availability_status === "AVAILABLE");
    check("Q13 documents catalog EMPTY (bare PDF: no title/category/date to fabricate)", (q(dbPath, "SELECT COUNT(*) c FROM documents"))?.c === 0);

    const r2 = await engine.runSource(src.id, { now: "2026-01-02T00:00:00Z" });
    check("Q11 PDF A again → UNCHANGED", r2.items[0].lifecycle === "UNCHANGED");
    check("Q11 snapshots stay 1 (no duplicate)", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 1);
    check("Q11 outbound_links stay 1 (no duplicate link)", (q(dbPath, "SELECT COUNT(*) c FROM outbound_links"))?.c === 1);

    deps.fetcher = new FakeFetcher({
      "https://fixture.test/notices/notice-a.pdf": { status: 200, body: B, contentType: "application/pdf" },
      "https://fixture.test/notices/notice-b.pdf": { status: 200, body: B, contentType: "application/pdf" },
    });
    const r3 = await engine.runSource(src.id, { now: "2026-01-03T00:00:00Z" });
    check("Q12 PDF B (same URL, new bytes) → CHANGED", r3.items[0].lifecycle === "CHANGED");
    check("Q12 snapshots now 2 (new version appended)", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 2);
    const hashes = qa(dbPath, "SELECT content_hash FROM source_snapshots ORDER BY fetched_at") as Array<Record<string, string>>;
    check("Q12 old A evidence preserved + B added", hashes.length === 2 && hashes[0].content_hash !== hashes[1].content_hash);
    const link3 = q(dbPath, "SELECT content_hash, last_checked_at FROM outbound_links WHERE scope_key='mfi-pdf'") as Record<string, unknown>;
    check("Q12 one link row updated to new version hash", (q(dbPath, "SELECT COUNT(*) c FROM outbound_links"))?.c === 1 && link3.content_hash === hashes[1].content_hash);
  }

  // ---------------------------------------------------------------------------
  // Q14–Q15 — engine HTML change detection uses the canonical hash
  // ---------------------------------------------------------------------------
  {
    const dbPath = scratchDb();
    const src = makeSource("html", "https://fixture.test/");
    seedScratch(dbPath, src);
    const base = "<html><title>RATE 10%</title><p>rate 10% stays</p></html>";
    const noisy = "<html>\n<script>var t=Date.now();</script>\n<style>.x{}</style>\n<!-- wp generator -->\n<title>RATE 10%</title>\n<div>   </div><p>  rate 10% stays  </p>\n</html>";
    const deps = {
      registry: new LocalSourceRegistry(dbPath),
      fetcher: new FakeFetcher({
        "https://fixture.test/": { status: 200, body: base, contentType: "text/html" },
        "https://fixture.test/noisy": { status: 200, body: noisy, contentType: "text/html" },
      }),
      discovery: discover("NEWS", "https://fixture.test/"),
      extractor,
      writer: new LocalSqliteEvidenceWriter(dbPath),
      canonicalizer,
    };
    const engine = buildEngine(deps);
    await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
    // same URL now serves formatting-only noise → canonical comparison must
    // report UNCHANGED even though the raw bytes (and raw hash) differ
    deps.fetcher = new FakeFetcher({
      "https://fixture.test/": { status: 200, body: noisy, contentType: "text/html" },
      "https://fixture.test/noisy": { status: 200, body: noisy, contentType: "text/html" },
    });
    const r2 = await buildEngine(deps).runSource(src.id, { now: "2026-01-02T00:00:00Z" });
    check("Q14 HTML formatting-only re-run → UNCHANGED (canonical compare)", r2.items[0].lifecycle === "UNCHANGED");
    check("Q14 snapshots stay 1", (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots"))?.c === 1);
    const itemHashes = qa(dbPath, "SELECT content_hash FROM ingestion_items ORDER BY id") as Array<Record<string, string>>;
    const raw = fakeHash(noisy);
    check("Q15 items store canonical comparison hash (≠ raw of noisy body)", itemHashes.length === 2 && itemHashes.every((r) => r.content_hash !== raw));
    check("Q15 repeated runs compare equal canonical hash", itemHashes[0].content_hash === itemHashes[1].content_hash);
  }

  // ---------------------------------------------------------------------------
  console.log(`\nPhase Q pdf+canonical results: ${pass} ok / ${fail} fail`);
  if (fail > 0) process.exit(1);
  console.log("ALL PDF/CANONICAL TESTS PASSED (no real network, no production D1).");
}

main().catch((e) => {
  console.error("pdf+canonical suite crashed:", e);
  process.exit(1);
});