// ============================================================================
// M3.2 — Data-API ingestion acceptance tests (fixture-proven, no network).
// Proves the config-declared JSON ingestion path end-to-end:
//   C1 strict data_api config parse (absent → null, malformed → loud error)
//   C2 generic extractor: BRANCH/NEWS/CAREER from response-shaped JSON
//   C3 full pass on a scratch DB: run rows, items, snapshots, assertions
//      (UNVERIFIED), outbound document links, validation results
//   C4 idempotency — unchanged content → UNCHANGED item, no new evidence
//   E1 HTTP 404 → FAILED item + HTTP_ERROR recorded, run PARTIAL
//   E2 non-JSON response → snapshot preserved, EXTRACTION_FAILED recorded
// ============================================================================

import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  DATA_API_PARSER_ID,
  DataApiConfigError,
  extractDataApiPayload,
  LocalSqliteEvidenceWriter,
  LocalSourceRegistry,
  parseDataApiConfig,
  runDataApiPass,
} from "../lib/ingestion";
import type { FetchResult } from "../lib/ingestion";
import type { IngestionSourceSpec } from "../lib/ingestion";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string) => {
  prepare(s: string): {
    get(...a: unknown[]): Record<string, unknown> | undefined;
    all(...a: unknown[]): Array<Record<string, unknown>>;
    run(...a: unknown[]): unknown;
  };
  exec(s: string): void;
  close(): void;
};
const fs = require("node:fs") as typeof import("node:fs");
let pass = 0;
let fail = 0;
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

function scratchDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lk-dataapi-"));
  const path = join(dir, "fixture.db");
  const schema = fs.readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(path);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  db.close();
  return path;
}

function sourceIdFor(root: string): IngestionSourceSpec {
  return {
    id: `dapi-${root}`,
    url: `https://${root}.fixture.test/`,
    domain: `${root}.fixture.test`,
    sourceType: "MFB_WEBSITE",
    enabled: true,
    fetchIntervalMinutes: 1440,
    capabilities: [],
  };
}

function seedScratch(dbPath: string, src: IngestionSourceSpec, configJson: Record<string, unknown>): void {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
     VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, 'fixture', 1)`,
  ).run(src.id, src.url, src.domain, `fixture: ${src.id}`);
  db.prepare(
    `INSERT INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
     VALUES (?, ?, ?, ?, NULL, ?, 1, 1440)`,
  ).run(src.id, src.url, src.domain, src.sourceType, JSON.stringify(configJson));
  db.close();
}

const API_BASE = "https://api.fixture.test";
function routeUrl(path: string): string {
  return `${API_BASE}${path}`;
}

type RouteFixture = Record<string, { status: number; contentType: string | null; body: string }>;

function apiFetcher(routes: RouteFixture) {
  return {
    async fetch(url: string): Promise<FetchResult> {
      const hit = routes[url];
      if (!hit) {
        return {
          finalUrl: url, httpStatus: 404, contentType: null, contentHash: "",
          bodyBytes: 0, body: new Uint8Array(), fetchedAt: "2026-01-01T00:00:00Z", redirectCount: 0,
        };
      }
      const bytes = new TextEncoder().encode(hit.body);
      const hash = createHash("sha256").update(hit.body).digest("hex");
      return {
        finalUrl: url, httpStatus: hit.status, contentType: hit.contentType,
        contentHash: hash, bodyBytes: bytes.byteLength, body: bytes,
        fetchedAt: "2026-01-01T00:00:00Z", redirectCount: 0,
      };
    },
  };
}

const VALID_BASE = {
  baseUrl: "https://api.fixture.test",
  hosts: ["api.fixture.test"],
  routes: [{ capability: "BRANCH_DIRECTORY", path: "/branch" }],
};

// ---------------------------------------------------------------- C1 config
function c1ConfigParse(): void {
  check("absent data_api -> null", parseDataApiConfig({ capabilities: [] }) === null);
  check("null config_json -> null", parseDataApiConfig(null) === null);
  const ok = parseDataApiConfig({ data_api: VALID_BASE })!;
  check("valid parse: host derived", ok.host === "api.fixture.test");
  check("valid parse: baseUrl kept", ok.baseUrl === "https://api.fixture.test/");

  const dup = parseDataApiConfig({
    data_api: { ...VALID_BASE, routes: [{ capability: "BRANCH_DIRECTORY", path: "/branch" }, { capability: "NEWS", path: "/branch" }] },
  })!;
  check("duplicate path deduped", dup.routes.length === 1);

  const throws = (name: string, cfg: unknown): void => {
    let threw = false;
    try { parseDataApiConfig(cfg); } catch (e) { threw = e instanceof DataApiConfigError; }
    check(name, threw);
  };
  throws("http baseUrl rejected", { data_api: { ...VALID_BASE, baseUrl: "http://api.fixture.test" } });
  const userinfo = ["user", "pw"].join(":");
  const credUrl = `https://${userinfo}@api.fixture.test`;
  throws("credentials rejected", { data_api: { ...VALID_BASE, baseUrl: credUrl } });
  throws("hosts missing baseUrl hostname", { data_api: { ...VALID_BASE, hosts: ["other.fixture.test"] } });
  throws("hosts entry with protocol rejected", { data_api: { ...VALID_BASE, hosts: ["https://api.fixture.test"] } });
  throws("unknown capability rejected", { data_api: { ...VALID_BASE, routes: [{ capability: "HACK", path: "/x" }] } });
  throws("relative path rejected", { data_api: { ...VALID_BASE, routes: [{ capability: "BRANCH_DIRECTORY", path: "branch" }] } });
  throws("empty routes rejected", { data_api: { ...VALID_BASE, routes: [] } });
  throws("routes not an array rejected", { data_api: { ...VALID_BASE, routes: "x" } });
}

// ---------------------------------------------------------------- C2 extractor
function c2Extractor(): void {
  const t0 = "2026-01-01T00:00:00Z";
  const branches = extractDataApiPayload(
    [
      { code: "HD-01", name: "Head Office Butwal", district: "Rupandehi", phone: "071-555111", manager: "Mr. A" },
      { code: "KA-02", name: "Kathmandu Province Office", place: "Lalitpur" },
    ],
    "BRANCH_DIRECTORY",
    { sourceUrl: routeUrl("/branch"), extractedAt: t0 },
  );
  const bn = branches.evidence.filter((e) => e.field === "BRANCH_NAME");
  check("branch: 2 BRANCH_NAME fields conf 0.6", bn.length === 2 && bn.every((e) => e.confidence === 0.6));
  check("branch: district/place attrs evidence", branches.evidence.some((e) => e.field === "BRANCH_DISTRICT" && e.text === "Rupandehi") && branches.evidence.some((e) => e.field === "BRANCH_PLACE" && e.text === "Lalitpur"));
  check("branch: no manager fabrication", !branches.evidence.some((e) => e.text === "Mr. A"));

  const news = extractDataApiPayload(
    [
      { _id: "n1", title: "Annual Notice 2081", createdAt: "2026-09-01", fileCon: "/uploads/annual-2081.pdf" },
      { _id: "n2", title: "Closed for Dashain", createdAt: "2026-09-02" },
    ],
    "NEWS",
    { sourceUrl: routeUrl("/news"), extractedAt: t0 },
  );
  check("news: attachment -> DOCUMENT_TITLE + doc link", news.evidence.some((e) => e.field === "DOCUMENT_TITLE" && e.text === "Annual Notice 2081") && news.docs.some((d) => d.targetType === "DOCUMENT" && d.targetUrl === `${API_BASE}/uploads/annual-2081.pdf`));
  check("news: no attachment -> NOTICE_TITLE", news.evidence.some((e) => e.field === "NOTICE_TITLE" && e.text === "Closed for Dashain"));

  const career = extractDataApiPayload(
    { vacancyAvailable: true, portalUrl: "https://jobs.fixture.test/mfi", title: "Branch Manager" },
    "CAREER_PAGE",
    { sourceUrl: routeUrl("/career"), extractedAt: t0 },
  );
  check("career: open -> VACANCY_TITLE + JOB portal link", career.evidence.some((e) => e.field === "VACANCY_TITLE" && e.text === "Branch Manager") && career.docs.some((d) => d.targetType === "JOB"));

  const closed = extractDataApiPayload({ vacancyAvailable: false, portalUrl: "https://jobs.fixture.test/mfi" }, "CAREER_PAGE", { sourceUrl: routeUrl("/career"), extractedAt: t0 });
  check("career: closed -> no vacancy evidence", closed.evidence.length === 0 && closed.docs.length === 0);

  const gated = extractDataApiPayload([{ name: "X" }], "WEBSITE", { sourceUrl: routeUrl("/home"), extractedAt: t0 });
  check("capability gating: WEBSITE -> []", gated.evidence.length === 0 && gated.docs.length === 0);

  const nested = extractDataApiPayload({ data: [{ name: "A Branch" }] }, "BRANCH_DIRECTORY", { sourceUrl: routeUrl("/branch"), extractedAt: t0 });
  check("payload wrapper {data:[…]} honoured", nested.evidence.length === 1 && nested.evidence[0].field === "BRANCH_NAME");
}

// ------------------------------------------------------------------ C3 pass
async function c3Pass(): Promise<void> {
  const src = sourceIdFor("pass");
  const cfg = {
    data_api: {
      baseUrl: API_BASE,
      hosts: ["api.fixture.test"],
      routes: [
        { capability: "BRANCH_DIRECTORY", path: "/branch" },
        { capability: "NEWS", path: "/news" },
        { capability: "CAREER_PAGE", path: "/career" },
      ],
    },
  };
  const dbPath = scratchDb();
  seedScratch(dbPath, src, cfg);
  const config = parseDataApiConfig(cfg)!;
  const routes: RouteFixture = {
    [routeUrl("/branch")]: { status: 200, contentType: "application/json", body: JSON.stringify([{ code: "HD-01", name: "Head Office Butwal", phone: "071-555111" }, { code: "KA-02", name: "Kathmandu Province Office" }]) },
    [routeUrl("/news")]: { status: 200, contentType: "application/json", body: JSON.stringify([{ title: "Annual Notice 2081", fileCon: "/uploads/annual-2081.pdf" }]) },
    [routeUrl("/career")]: { status: 200, contentType: "application/json", body: JSON.stringify({ vacancyAvailable: true, title: "Loan Officer", portalUrl: "https://jobs.fixture.test/mfi" }) },
  };
  const out = await runDataApiPass({
    source: src,
    config,
    deps: {
      registry: new LocalSourceRegistry(dbPath),
      fetcher: apiFetcher(routes),
      writer: new LocalSqliteEvidenceWriter(dbPath),
    },
    now: "2026-01-01T00:00:00Z",
  });
  check("pass: no errors", out.errors.length === 0);
  check("pass: 3 routes processed", out.processed === 3);

  const runRow = q(dbPath, `SELECT status, parser_version FROM ingestion_runs WHERE ingestion_source_id = '${src.id}' ORDER BY started_at DESC LIMIT 1`);
  check("pass: run recorded SUCCESS + parser", runRow?.status === "SUCCESS" && runRow?.parser_version === DATA_API_PARSER_ID);

  const assertions = qa(dbPath, "SELECT field_name, value, confidence, verification_status FROM data_assertions");
  const branchNames = assertions.filter((a) => a.field_name === "branch_name");
  check("pass: branch_name asserted per API entry (UNVERIFIED 0.6)", branchNames.length === 2 && branchNames.every((a) => a.verification_status === "UNVERIFIED" && a.confidence === 0.6));
  check("pass: document_title asserted from news attachment", assertions.some((a) => a.field_name === "document_title" && a.value === "Annual Notice 2081"));
  check("pass: vacancy_title asserted", assertions.some((a) => a.field_name === "vacancy_title" && a.value === "Loan Officer"));
  check("pass: attrs never asserted (0.45 floor)", !assertions.some((a) => a.field_name === "branch_phone"));

  const snapshots = qa(dbPath, "SELECT extraction_status FROM source_snapshots");
  check("pass: one EXTRACTED snapshot per route", snapshots.length === 3 && snapshots.every((s) => s.extraction_status === "EXTRACTED"));

  const items = qa(dbPath, "SELECT item_type, status FROM ingestion_items");
  check("pass: items CHANGED with route capability", items.length === 3 && items.every((i) => i.status === "CHANGED"));

  const links = qa(dbPath, "SELECT target_type, target_url FROM outbound_links");
  check("pass: DOCUMENT link from news attachment", links.some((l) => l.target_type === "DOCUMENT" && l.target_url === `${API_BASE}/uploads/annual-2081.pdf`));
  check("pass: JOB portal link from career", links.some((l) => l.target_type === "JOB"));

  const audits = qa(dbPath, "SELECT action FROM audit_logs WHERE action LIKE 'DATA_API_%'");
  check("pass: DATA_API audit trail present", audits.length >= 2);

  // C4 idempotency: identical second run → unchanged, no new evidence.
  const out2 = await runDataApiPass({
    source: src,
    config,
    deps: {
      registry: new LocalSourceRegistry(dbPath),
      fetcher: apiFetcher(routes),
      writer: new LocalSqliteEvidenceWriter(dbPath),
    },
    now: "2026-01-02T00:00:00Z",
  });
  check("idempotency: second run clean", out2.errors.length === 0);
  const items2 = qa(dbPath, "SELECT status, run_id FROM ingestion_items");
  const unchangedItems = items2.filter((i) => i.status === "UNCHANGED").length;
  check(`idempotency: second run -> ${unchangedItems} UNCHANGED items`, unchangedItems === 3);
  const snaps2 = qa(dbPath, "SELECT id FROM source_snapshots");
  const asserts2 = qa(dbPath, "SELECT id FROM data_assertions");
  check("idempotency: no duplicate evidence", snaps2.length === 3 && asserts2.length === assertions.length);
}

// ------------------------------------------------------------------ E1/E2
async function c5Errors(): Promise<void> {
  const src = sourceIdFor("errors");
  const cfg = {
    data_api: {
      baseUrl: API_BASE,
      hosts: ["api.fixture.test"],
      routes: [{ capability: "BRANCH_DIRECTORY", path: "/branch" }, { capability: "NEWS", path: "/news" }],
    },
  };
  const dbPath = scratchDb();
  seedScratch(dbPath, src, cfg);
  const config = parseDataApiConfig(cfg)!;
  const routes: RouteFixture = {
    [routeUrl("/branch")]: { status: 404, contentType: null, body: "" },
    [routeUrl("/news")]: { status: 200, contentType: "text/html", body: "<html>not json</html>" },
  };
  const out = await runDataApiPass({
    source: src,
    config,
    deps: {
      registry: new LocalSourceRegistry(dbPath),
      fetcher: apiFetcher(routes),
      writer: new LocalSqliteEvidenceWriter(dbPath),
    },
    now: "2026-01-01T00:00:00Z",
  });
  check("errors: run PARTIAL with 2 failures", out.processed === 0 && out.errors.length === 2);
  const errs = qa(dbPath, "SELECT error_type FROM ingestion_errors");
  check("errors: HTTP_ERROR + EXTRACTION_FAILED recorded", errs.some((e) => e.error_type === "HTTP_ERROR") && errs.some((e) => e.error_type === "EXTRACTION_FAILED"));
  const itemStatuses = qa(dbPath, "SELECT url, status FROM ingestion_items ORDER BY url");
  check("errors: 404 item FAILED, html item CHANGED (extraction failed, evidence kept)", itemStatuses.some((i) => i.url === routeUrl("/branch") && i.status === "FAILED") && itemStatuses.some((i) => i.url === routeUrl("/news") && i.status === "CHANGED"));
  const snaps = qa(dbPath, "SELECT extraction_status FROM source_snapshots");
  check("errors: non-JSON snapshot preserved (SKIPPED)", snaps.length === 1 && snaps[0].extraction_status === "SKIPPED");
  const runRow = q(dbPath, `SELECT status FROM ingestion_runs WHERE ingestion_source_id = '${src.id}' ORDER BY started_at DESC LIMIT 1`);
  check("errors: run status PARTIAL", runRow?.status === "PARTIAL");
}

async function main(): Promise<void> {
  console.log("data-api ingestion smoke:");
  c1ConfigParse();
  c2Extractor();
  await c3Pass();
  await c5Errors();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();