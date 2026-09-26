// ============================================================================
// Phase R4 — Branch / Vacancy / Financial-metadata extraction acceptance
// tests (fixture-proven, no real crawling, no production D1). Proves the
// deterministic parsers end-to-end through the GENERIC engine:
//   B1 branch table w/ header  → branch_name asserted per row (UNVERIFIED)
//   B2 branch capability, no table → zero assertions, validator PENDING
//   B3 no-header branch rows   → names + district/phone evidence
//   V1 career list w/ deadline → vacancy_title asserted, deadlines evidence
//   V2 junk career page        → zero vacancy assertions, PENDING
//   F1 reports page            → document_title asserted, period evidence
//   F2 reports page, no finance hints → zero assertions, PENDING
//   G1 capability gating       → extractor self-limits off-capability
//   U  unit checks             → period normalization, direct gating
// ============================================================================

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { buildEngine } from "../lib/ingestion";
import { LocalSqliteEvidenceWriter, LocalSourceRegistry } from "../lib/ingestion";
import {
  branchDirectoryExtractor,
  branchDirectoryValidator,
  BRANCH_DIRECTORY_RULE_ID,
  composeExtractors,
  financialMetadataExtractor,
  financialMetadataValidator,
  FINANCIAL_METADATA_RULE_ID,
  nrbListingExtractor,
  nrbListingValidator,
  NRB_LISTING_RULE_ID,
  nrbStructuredValidators,
  structuredValidators,
  vacancyExtractor,
  vacancyValidator,
  VACANCY_RULE_ID,
} from "../lib/ingestion";
import type { DiscoveredTarget, ExtractedEvidence, FetchOptions, FetchResult, IngestionSourceSpec } from "../lib/ingestion";

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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("node:fs") as typeof import("node:fs");

function htmlFetcher(body: string) {
  return {
    async fetch(url: string, opts?: FetchOptions): Promise<FetchResult> {
      const bytes = new TextEncoder().encode(body);
      const hash = `${url}#${bytes.length}`.padEnd(64, "0");
      return {
        finalUrl: url,
        httpStatus: 200,
        contentType: "text/html; charset=utf-8",
        contentHash: hash,
        bodyBytes: bytes.byteLength,
        body: bytes,
        fetchedAt: "2026-01-01T00:00:00Z",
        redirectCount: 0,
      };
    },
  };
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
        title: "fixture page",
        status: "CANDIDATE",
      }];
    },
  };
}

function makeSource(id: string, sourceType: IngestionSourceSpec["sourceType"] = "MFB_WEBSITE", capability: DiscoveredTarget["capability"] = "WEBSITE"): IngestionSourceSpec {
  return {
    id: `r4-${id}`,
    url: `https://fixture.test/${id}`,
    domain: "fixture.test",
    sourceType,
    enabled: true,
    fetchIntervalMinutes: 1440,
    capabilities: [
      { kind: capability, status: "CANDIDATE", knownUrl: `https://fixture.test/${id}` },
    ],
  };
}

function scratchDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lk-structured-"));
  const path = join(dir, "fixture.db");
  const schema = fs.readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(path);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  db.close();
  return path;
}

function seedScratch(dbPath: string, src: IngestionSourceSpec): void {
  const db = new Database(dbPath);
  const isNrb = src.sourceType === "NRB";
  db.prepare(
    `INSERT INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
     VALUES (?, ?, ?, 'A', ?, ?, ?, 'fixture', 1)`,
  ).run(src.id, isNrb ? "NRB" : "MFB_WEBSITE", isNrb ? "NRB" : "INSTITUTION", src.url, src.domain, `fixture: ${src.id}`);
  db.prepare(
    `INSERT INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
     VALUES (?, ?, ?, ?, NULL, ?, 1, 1440)`,
  ).run(src.id, src.url, src.domain, src.sourceType, JSON.stringify({ capabilities: src.capabilities }));
  for (const rule of [
    [BRANCH_DIRECTORY_RULE_ID, "BRANCH_DIRECTORY", "branch directory extraction", "SANITY", "WARN"],
    [VACANCY_RULE_ID, "VACANCIES", "career vacancy extraction", "SANITY", "WARN"],
    [FINANCIAL_METADATA_RULE_ID, "FINANCIAL_METADATA", "financial document metadata extraction", "SANITY", "WARN"],
    [NRB_LISTING_RULE_ID, "NRB_LISTING", "nrb listing extraction", "SANITY", "WARN"],
    ["r-pilot-title", "PILOT_TITLE", "pilot title present", "SANITY", "WARN"],
    ["r-pilot-email", "PILOT_EMAIL", "pilot email field sanity", "SANITY", "WARN"],
  ]) {
    db.prepare(
      `INSERT INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
       VALUES (?, ?, ?, ?, ?, 1, '{}') ON CONFLICT(id) DO NOTHING`,
    ).run(rule[0], rule[1], rule[2], rule[3], rule[4]);
  }
  db.close();
}

type AnyExtractor = { parserId: string; extract(ctx: { sourceId: string; institutionId?: string; sourceType?: string; capability: string; url: string; parserId: string; contentHash: string; body: Uint8Array }): Promise<ExtractedEvidence[]> };

async function runFixture(id: string, body: string, capability: DiscoveredTarget["capability"], extractor: AnyExtractor, validators: unknown, sourceType: IngestionSourceSpec["sourceType"] = "MFB_WEBSITE") {
  const dbPath = scratchDb();
  const src = makeSource(id, sourceType, capability);
  seedScratch(dbPath, src);
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: htmlFetcher(body),
    discovery: discoverHome(capability),
    extractor: extractor as never,
    writer: new LocalSqliteEvidenceWriter(dbPath),
    validators: validators as never,
  });
  const out = await engine.runSource(src.id, { now: "2026-01-01T00:00:00Z" });
  return { out, dbPath };
}

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

const BRANCH_TABLE = `<html><body>
<h3>Branch Network</h3>
<table>
  <tr><th>Name</th><th>District</th><th>Phone</th></tr>
  <tr><td>Head Office Butwal</td><td>Rupandehi</td><td>+977-71-555111</td></tr>
  <tr><td>Kathmandu Province Office</td><td>Kathmandu</td><td>+977-1-555222</td></tr>
  <tr><td>Bhairahawa Branch</td><td>Rupandehi</td><td>+977-71-555333</td></tr>
  <tr><td>Pokhara Branch</td><td>Kaski</td><td>+977-61-555444</td></tr>
</table>
</body></html>`;

const CONTACT_PAGE = `<html><body>
<h3>Contact Us</h3>
<p>Head Office: Butwal, Rupandehi. Phone +977-71-555111. Email info@fixture.test.</p>
</body></html>`;

const BRANCH_NOHDR = `<html><body>
<h3>शाखा कार्यालयहरू</h3>
<table>
  <tr><td>Head Office Butwal</td><td>Rupandehi</td><td>+977-71-555111</td></tr>
  <tr><td>Kathmandu Province Office</td><td>Kathmandu</td><td>+977-1-555222</td></tr>
</table>
</body></html>`;

const CAREER_LIST = `<html><body>
<h3>Career Opportunities</h3>
<ul>
  <li>Branch Manager — Last Date of Submission: 2026-02-15</li>
  <li>Loan Officer — Deadline: 2026-03-01</li>
</ul>
</body></html>`;

const CAREER_JUNK = `<html><body>
<h3>Contact</h3>
<ul>
  <li>+977-1-5551234</li>
  <li>apply@fixture.test</li>
  <li>www.jobs.fixture.test</li>
</ul>
</body></html>`;

const REPORTS_PAGE = `<html><body>
<h3>Financial Reports</h3>
<ul>
  <li><a href="/report/annual-2080.pdf">Annual Report FY 2080/81</a></li>
  <li><a href="/report/q2-2080.pdf">Quarterly Financial Report Q1 FY 2080/81</a></li>
</ul>
</body></html>`;

const REPORTS_PLAIN = `<html><body>
<h3>Downloads</h3>
<ul>
  <li><a href="/memo-1.pdf">Office Memo January</a></li>
  <li><a href="/photo.jpg">Community Photo</a></li>
</ul>
</body></html>`;

// Live NRB arrowed-list row shape (nrb.org.np category pages): a
// `.text-primary` title anchor, then `.font-size-xs` with a `.text-muted` date
// and a `.text-muted.text-uppercase` size. Some rows nest pointer anchors
// (`<a href="">pdf</a>` / real `.pdf` "pdf") inside the title element — those
// must never pollute the extracted title.
const NRB_LISTING = `<html><body>
<h3>Quarterly Situation of MFIs</h3>
<ul class="arrowed-list arrowed-list--border">
  <li>
    <span class="text-primary"><a href="https://www.nrb.org.np/mfd/quarterly-situation-of-microfinance-institutions-2026-09/" target="_blank">Quarterly Situation of Microfinance Institutions 2026</a></span>
    <div class="font-size-xs"><span class="mr-3 text-muted">September 22, 2026</span><span class="text-muted text-uppercase">416.86 kb</span></div>
  </li>
  <li>
    <span class="text-primary"><a href="https://www.nrb.org.np/mfd/quarterly-situation-of-microfinance-institutions-2026-06/" target="_blank">Quarterly Situation of Microfinance Institutions 2026 (Q3)</a></span>
    <div class="font-size-xs"><span class="mr-3 text-muted">June 30, 2026</span><span class="text-muted text-uppercase">1.23 mb</span></div>
  </li>
  <li>
    <span class="text-primary"><a href="https://www.nrb.org.np/mfd/quarterly-situation-of-microfinance-institutions-2026-03/" target="_blank">Quarterly Situation of Microfinance Institutions 2026 (Q2) (<a href="">pdf</a> / <a href="https://www.nrb.org.np/contents/uploads/2026/03/q2.pdf">pdf</a>)</a></span>
    <div class="font-size-xs"><span class="mr-3 text-muted">March 31, 2026</span><span class="text-muted text-uppercase">900 kb</span></div>
  </li>
</ul>
<ul class="arrowed-list widget_archive">
  <li><a href="https://www.nrb.org.np/category/key-financial-indicators/">Archives (Quarterly Financial Highlights)</a></li>
  <li><a href="https://www.nrb.org.np/category/annual-reports/">Financial Statements</a></li>
  <li><a href="https://www.nrb.org.np/category/notice/">NRB Quarterly news</a></li>
</ul>
</body></html>`;

// Same page without the nested pointer anchors (used for the composed N4 case
// so every extractor reads identical titles).
const NRB_LISTING_CLEAN = `<html><body>
<h3>Quarterly Situation of MFIs</h3>
<ul class="arrowed-list arrowed-list--border">
  <li>
    <span class="text-primary"><a href="https://www.nrb.org.np/mfd/quarterly-situation-of-microfinance-institutions-2026-09/" target="_blank">Quarterly Situation of Microfinance Institutions 2026</a></span>
    <div class="font-size-xs"><span class="mr-3 text-muted">September 22, 2026</span><span class="text-muted text-uppercase">416.86 kb</span></div>
  </li>
  <li>
    <span class="text-primary"><a href="https://www.nrb.org.np/mfd/quarterly-situation-of-microfinance-institutions-2026-06/" target="_blank">Quarterly Situation of Microfinance Institutions 2026 (Q3)</a></span>
    <div class="font-size-xs"><span class="mr-3 text-muted">June 30, 2026</span><span class="text-muted text-uppercase">1.23 mb</span></div>
  </li>
  <li>
    <span class="text-primary"><a href="https://www.nrb.org.np/mfd/quarterly-situation-of-microfinance-institutions-2026-03/" target="_blank">Quarterly Situation of Microfinance Institutions 2026 (Q2)</a></span>
    <div class="font-size-xs"><span class="mr-3 text-muted">March 31, 2026</span><span class="text-muted text-uppercase">900 kb</span></div>
  </li>
</ul>
<ul class="arrowed-list widget_archive">
  <li><a href="https://www.nrb.org.np/category/key-financial-indicators/">Archives (Quarterly Financial Highlights)</a></li>
  <li><a href="https://www.nrb.org.np/category/annual-reports/">Financial Statements</a></li>
  <li><a href="https://www.nrb.org.np/category/notice/">NRB Quarterly news</a></li>
</ul>
</body></html>`;

// ============================================================================
// B1 — branch table with header: one UNVERIFIED assertion per branch, full
// attributes in validator evidence, volatile fields never asserted
// ============================================================================
async function main(): Promise<void> {
{
  const { out, dbPath } = await runFixture("b1", BRANCH_TABLE, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B1 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT field_name, value, verification_status, confidence FROM data_assertions");
  check("B1 exactly 4 branch_name assertions", asserts.length === 4 && asserts.every((a) => a.field_name === "branch_name"));
  check("B1 head office asserted", asserts.some((a) => a.value === "Head Office Butwal"));
  check("B1 per-row assertions UNVERIFIED", asserts.every((a) => a.verification_status === "UNVERIFIED" && Number(a.confidence) >= 0.5));
  const val = qa(dbPath, `SELECT status, message, evidence_json FROM validation_results WHERE rule_id='${BRANCH_DIRECTORY_RULE_ID}'`);
  check("B1 branch validator PASS", val.length === 1 && val[0].status === "PASS");
  const ev = JSON.parse(String(val[0].evidence_json)) as { count: number; attrs: Array<{ field: string; text: string }> };
  check("B1 validator evidence count=4", ev.count === 4);
  check("B1 district evidence present (volatile, unasserted)", ev.attrs.some((a) => a.field === "BRANCH_DISTRICT" && a.text === "Rupandehi"));
  check("B1 phone evidence present (volatile, unasserted)", ev.attrs.some((a) => a.field === "BRANCH_PHONE" && a.text === "+977-71-555111"));
}

// ============================================================================
// B2 — BRANCH_DIRECTORY capability but an ordinary contact page: nothing leaks
// ============================================================================
{
  const { out, dbPath } = await runFixture("b2", CONTACT_PAGE, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B2 run ok", out.ok === true);
  check("B2 zero branch assertions", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions") as { c: number }).c === 0);
  const val = qa(dbPath, `SELECT status FROM validation_results WHERE rule_id='${BRANCH_DIRECTORY_RULE_ID}'`);
  check("B2 validator PENDING (not a defect)", val.length === 1 && val[0].status === "PENDING");
}

// ============================================================================
// B3 — no-header branch table: names + district/phone evidence still correct
// ============================================================================
{
  const { out, dbPath } = await runFixture("b3", BRANCH_NOHDR, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B3 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='branch_name'");
  check("B3 two branch names asserted (no header)", asserts.length === 2 && asserts.some((a) => a.value === "Head Office Butwal"));
  const val = qa(dbPath, `SELECT evidence_json FROM validation_results WHERE rule_id='${BRANCH_DIRECTORY_RULE_ID}'`);
  const ev = JSON.parse(String(val[0].evidence_json)) as { attrs: Array<{ field: string; text: string }> };
  check("B3 district Rupandehi from clues", ev.attrs.some((a) => a.field === "BRANCH_DISTRICT" && a.text === "Rupandehi"));
  check("B3 phone from clues", ev.attrs.some((a) => a.field === "BRANCH_PHONE" && a.text === "+977-71-555111"));
}

// ============================================================================
// V1 — career list: titles asserted (UNVERIFIED), deadlines evidence-only
// ============================================================================
{
  const { out, dbPath } = await runFixture("v1", CAREER_LIST, "CAREER_PAGE", vacancyExtractor, structuredValidators);
  check("V1 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT field_name, value FROM data_assertions");
  check("V1 exactly 2 vacancy_title assertions", asserts.length === 2 && asserts.every((a) => a.field_name === "vacancy_title"));
  check("V1 Branch Manager title asserted", asserts.some((a) => a.value === "Branch Manager"));
  check("V1 Loan Officer title asserted", asserts.some((a) => a.value === "Loan Officer"));
  const val = qa(dbPath, `SELECT status, evidence_json FROM validation_results WHERE rule_id='${VACANCY_RULE_ID}'`);
  check("V1 vacancy validator PASS", val.length === 1 && val[0].status === "PASS");
  const ev = JSON.parse(String(val[0].evidence_json)) as { count: number; attrs: Array<{ field: string; text: string }> };
  check("V1 count=2", ev.count === 2);
  check("V1 deadline evidence present (volatile, unasserted)", ev.attrs.some((a) => a.field === "VACANCY_DEADLINE" && a.text === "2026-03-01"));
  const deadlines = qa(dbPath, "SELECT COUNT(*) c FROM data_assertions WHERE field_name='vacancy_deadline'");
  check("V1 deadlines never asserted", (deadlines[0].c as number) === 0);
}

// ============================================================================
// V2 — junk career page (contact info only): zero titles, PENDING
// ============================================================================
{
  const { out, dbPath } = await runFixture("v2", CAREER_JUNK, "CAREER_PAGE", vacancyExtractor, structuredValidators);
  check("V2 run ok", out.ok === true);
  check("V2 zero vacancy assertions", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions") as { c: number }).c === 0);
  const val = qa(dbPath, `SELECT status FROM validation_results WHERE rule_id='${VACANCY_RULE_ID}'`);
  check("V2 validator PENDING (no junk leaked)", val.length === 1 && val[0].status === "PENDING");
}

// ============================================================================
// F1 — reports page: titles asserted, fiscal period normalized in evidence
// ============================================================================
{
  const { out, dbPath } = await runFixture("f1", REPORTS_PAGE, "REPORTS", financialMetadataExtractor, structuredValidators);
  check("F1 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='document_title'");
  check("F1 two document_title assertions", asserts.length === 2);
  check("F1 Annual Report title asserted", asserts.some((a) => a.value === "Annual Report FY 2080/81"));
  check("F1 Quarter-bearing title asserted", asserts.some((a) => a.value === "Quarterly Financial Report Q1 FY 2080/81"));
  const val = qa(dbPath, `SELECT status, evidence_json FROM validation_results WHERE rule_id='${FINANCIAL_METADATA_RULE_ID}'`);
  check("F1 finance validator PASS", val.length === 1 && val[0].status === "PASS");
  const ev = JSON.parse(String(val[0].evidence_json)) as { count: number; attrs: Array<{ field: string; text: string }> };
  check("F1 period evidence 2080/2081 normalized", ev.attrs.some((a) => a.field === "DOCUMENT_PERIOD" && a.text === "2080/2081"));
  const periods = qa(dbPath, "SELECT COUNT(*) c FROM data_assertions WHERE field_name='document_period'");
  check("F1 period never asserted", (periods[0].c as number) === 0);
}

// ============================================================================
// F2 — reports page without financial-document language: nothing, PENDING
// ============================================================================
{
  const { out, dbPath } = await runFixture("f2", REPORTS_PLAIN, "REPORTS", financialMetadataExtractor, structuredValidators);
  check("F2 run ok", out.ok === true);
  check("F2 zero financial assertions", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions") as { c: number }).c === 0);
  const val = qa(dbPath, `SELECT status FROM validation_results WHERE rule_id='${FINANCIAL_METADATA_RULE_ID}'`);
  check("F2 validator PENDING", val.length === 1 && val[0].status === "PENDING");
}

// ============================================================================
// G1 — capability gating: each extractor self-limits off its capability
// ============================================================================
{
  const body = CAREER_LIST;
  const branchCap = await branchDirectoryExtractor.extract({
    sourceId: "g1", capability: "WEBSITE", url: "https://fixture.test/g1",
    parserId: "g1", contentHash: "h", body: new TextEncoder().encode(body),
  });
  check("G1 branch extractor silent on WEBSITE", branchCap.length === 0);
  const vacancyCap = await vacancyExtractor.extract({
    sourceId: "g1b", capability: "NEWS", url: "https://fixture.test/g1b",
    parserId: "g1b", contentHash: "h", body: new TextEncoder().encode(body),
  });
  check("G1 vacancy extractor silent on NEWS", vacancyCap.length === 0);
  const finCap = await financialMetadataExtractor.extract({
    sourceId: "g1c", capability: "CAREER_PAGE", url: "https://fixture.test/g1c",
    parserId: "g1c", contentHash: "h", body: new TextEncoder().encode(REPORTS_PAGE),
  });
  check("G1 finance extractor silent on CAREER_PAGE", finCap.length === 0);
  const finActive = await financialMetadataExtractor.extract({
    sourceId: "g1d", capability: "DOCUMENT_ARCHIVE", url: "https://fixture.test/g1d",
    parserId: "g1d", contentHash: "h", body: new TextEncoder().encode(REPORTS_PAGE),
  });
  check("G1 finance extractor active on DOCUMENT_ARCHIVE (2 titles)", finActive.filter((e) => e.field === "DOCUMENT_TITLE").length === 2);
}

// ============================================================================
// U — unit behavior: single-year fiscal period normalizes to a full FY span
// ============================================================================
{
  const finDirect = await financialMetadataExtractor.extract({
    sourceId: "u1", capability: "REPORTS", url: "https://fixture.test/u1",
    parserId: "u1", contentHash: "h", body: new TextEncoder().encode(
      `<h3>Reports</h3><p><a>Annual Report 2080</a></p><p><a>वार्षिक प्रतिवेदन 2079</a></p>`,
    ),
  });
  const period = finDirect.filter((e) => e.field === "DOCUMENT_PERIOD").map((e) => e.text);
  check("U1 single-year EN period → 2080/2081", period.includes("2080/2081"));
  check("U1 single-year NE period → 2079/2080", period.includes("2079/2080"));
}

// ============================================================================
// B4 — real-site pollution regression (10→20 finding): a contact-person column
// and an S.No. sequence column must not leak into branch_name
// ============================================================================
{
  const { out, dbPath } = await runFixture("b4", `<html><body>
<h3>Branch Network</h3>
<table>
  <tr><th>S.No.</th><th>Branch Name</th><th>Contact Person</th><th>Phone</th></tr>
  <tr><td>1</td><td>Head Office Butwal</td><td>Kalpana Khanal</td><td>+977-71-555111</td></tr>
  <tr><td>2</td><td>Bhairahawa Branch</td><td>Ram Bahadur Thapa</td><td>+977-71-555333</td></tr>
</table>
</body></html>`, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B4 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='branch_name'");
  check("B4 exactly 2 branch_name (S.No. + person columns ignored)", asserts.length === 2);
  check("B4 office-marked names only", asserts.every((a) => a.value === "Head Office Butwal" || a.value === "Bhairahawa Branch"));
  check("B4 persons never leaked", asserts.every((a) => a.value !== "Kalpana Khanal" && a.value !== "Ram Bahadur Thapa"));
}

// ============================================================================
// V3 — real-site pollution regression (10→20 finding): global nav items are not
// vacancies; only job-signal or deadline-bearing entries are
// ============================================================================
{
  const { out, dbPath } = await runFixture("v3", `<html><body>
<h3>Career</h3>
<ul>
  <li><a href="/">Home</a></li>
  <li><a href="/mission">Mission</a></li>
  <li><a href="/contact">Contact Us</a></li>
  <li><a href="/career">Career</a></li>
  <li><a href="/training">Staff Training</a></li>
  <li>Relationship Officer — Deadline: 2026-04-10</li>
  <li>Branch Manager — Last Date: 2026-05-01</li>
</ul>
</body></html>`, "CAREER_PAGE", vacancyExtractor, structuredValidators);
  check("V3 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='vacancy_title'");
  check("V3 exactly 2 vacancy_title (nav/role-less labels dropped)", asserts.length === 2);
  check("V3 nav items never asserted", asserts.every((a) => a.value !== "Home" && a.value !== "Mission" && a.value !== "Contact Us" && a.value !== "Career" && a.value !== "Staff Training"));
  check("V3 officer/manager titles kept", asserts.some((a) => a.value === "Relationship Officer") && asserts.some((a) => a.value === "Branch Manager"));
}

// ============================================================================
// F3 — real-site pollution regression (10→20 finding): archive index headings
// ("Annual Reports") are not documents; year-bearing titles are
// ============================================================================
{
  const { out, dbPath } = await runFixture("f3", `<html><body>
<h3>Financial Reports</h3>
<ul>
  <li><a href="/ar">Annual Reports</a></li>
  <li><a href="/qr">Quarterly Reports</a></li>
  <li><a href="/r">Report</a></li>
  <li><a href="/ar2">Annual Report</a></li>
  <li><a href="/ar-2079">Annual Report 2079/80</a></li>
</ul>
</body></html>`, "REPORTS", financialMetadataExtractor, structuredValidators);
  check("F3 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='document_title'");
  check("F3 only the year-bearing title asserted", asserts.length === 1 && asserts[0].value === "Annual Report 2079/80");
  const val = qa(dbPath, `SELECT evidence_json FROM validation_results WHERE rule_id='${FINANCIAL_METADATA_RULE_ID}'`);
  const ev = JSON.parse(String(val[0].evidence_json)) as { attrs: Array<{ field: string; text: string }> };
  check("F3 headings rejected, period 2079/2080 kept", ev.attrs.some((a) => a.field === "DOCUMENT_PERIOD" && a.text === "2079/2080"));
}

// ============================================================================
// B5 — real-site pollution regression (20→30 finding): a "Branch Manager : Name"
// person-attribution row must not leak into branch_name
// ============================================================================
{
  const { out, dbPath } = await runFixture("b5", `<html><body>
<h3>Branch Network</h3>
<table>
  <tr><th>SN</th><th>Branch</th><th>Manager</th><th>Phone</th></tr>
  <tr><td>1</td><td>Parsa Branch</td><td>Dev Raj Sah</td><td>+977-55-520000</td></tr>
  <tr><td>2</td><td>Janakpur Branch</td><td>Mr. Shyam Kumar Yadav</td><td>+977-41-523030</td></tr>
  <tr><td>3</td><td>Branch Manager : Mr. Ashok Kumar Sah</td><td>&mdash;</td><td>+977-55-520111</td></tr>
  <tr><td>4</td><td>Branch Manager : Mr.Bibek Niraula</td><td>&mdash;</td><td>+977-55-520222</td></tr>
  <tr><td>5</td><td>Branch Office</td><td>&mdash;</td><td>+977-55-520333</td></tr>
</table>
</body></html>`, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B5 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='branch_name'");
  check("B5 exactly 2 branch_name (person/generic rows dropped)", asserts.length === 2);
  check("B5 office-marked names only", asserts.every((a) => a.value === "Parsa Branch" || a.value === "Janakpur Branch"));
  check("B5 manager rows never leaked", asserts.every((a) => !String(a.value).includes("Manager :") && !String(a.value).includes("Mr.")));
}

// ============================================================================
// F4 — real-site pollution regression (20→30 + 30→40 findings): bare collection
// headings ("Quarterly", "Annual Audit Reports", "Quarterly Financial Report",
// "वार्षिक प्रतिवेदन") are not documents; period-bearing titles are.
{
  const { out, dbPath } = await runFixture("f4", `<html><body>
<h3>Reports</h3>
<ul>
  <li><a href="/q">Quarterly</a></li>
  <li><a href="/aar">Annual Audit Reports</a></li>
  <li><a href="/ar">Annual Report</a></li>
  <li><a href="/qfr">Quarterly Financial Report</a></li>
  <li><a href="/bare-ne">वार्षिक प्रतिवेदन</a></li>
  <li><a href="/f-2072">Annual Report FY 2072-73</a></li>
  <li><a href="/ne-2078">वार्षिक प्रतिवेदन आ.ब. २०७८/७९</a></li>
</ul>
</body></html>`, "REPORTS", financialMetadataExtractor, structuredValidators);
  check("F4 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='document_title'");
  check("F4 exactly 2 document_title (bare headings dropped)", asserts.length === 2);
  check(
    "F4 specific period-bearing titles only",
    asserts.every(
      (a) =>
        a.value === "Annual Report FY 2072-73" ||
        a.value === "वार्षिक प्रतिवेदन आ.ब. २०७८/७९",
    ),
  );
}

// ============================================================================
// N1 — NRB arrowed-list page (institution-less, sourceType NRB): every anchored
// entry becomes an outbound document link + one DOCUMENT_TITLE assertion,
// entity falls back to the source, nested pdf pointers never pollute titles,
// date/size stay evidence-only, all assertions UNVERIFIED
// ============================================================================
{
  const { out, dbPath } = await runFixture("n1", NRB_LISTING, "DOCUMENT_ARCHIVE", nrbListingExtractor, [nrbListingValidator], "NRB");
  check("N1 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT field_name, value, verification_status, confidence, entity_type, entity_id FROM data_assertions");
  check("N1 exactly 3 document_title assertions", asserts.length === 3 && asserts.every((a) => a.field_name === "document_title"));
  check("N1 nested-pdf title cleaned (no pointer junk)", asserts.some((a) => a.value === "Quarterly Situation of Microfinance Institutions 2026 (Q2)"));
  check("N1 sidebar/category links never become documents", asserts.every((a) => a.value !== "Financial Statements" && a.value !== "NRB Quarterly news" && a.value !== "Archives (Quarterly Financial Highlights)"));
  check("N1 per-entry assertions UNVERIFIED + confidence>=0.5", asserts.every((a) => a.verification_status === "UNVERIFIED" && Number(a.confidence) >= 0.5));
  check("N1 assertions attach to the source (no institution)", asserts.every((a) => a.entity_type === "source" && a.entity_id === "r4-n1"));
  check("N1 date/size never asserted", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions WHERE field_name IN ('document_date','document_size')") as { c: number }).c === 0);
  const links = qa(dbPath, "SELECT target_type, availability_status, target_url, label, description FROM outbound_links");
  check("N1 exactly 3 outbound document links", links.length === 3 && links.every((l) => l.target_type === "DOCUMENT"));
  check("N1 outbound links UNKNOWN (not yet depth-checked)", links.every((l) => l.availability_status === "UNKNOWN"));
  check("N1 outbound target_urls are the /mfd/ entries", links.every((l) => String(l.target_url).startsWith("https://www.nrb.org.np/mfd/")));
  check("N1 outbound labels are the entry titles", links.some((l) => l.label === "Quarterly Situation of Microfinance Institutions 2026"));
  check("N1 link metadata carries publishedAt + size for the ledger", links.some((l) => l.description === JSON.stringify({ publishedAt: "2026-09-22", size: "416.86 kb" })));
  check("N1 every listing row's link carries metadata", links.every((l) => { try { const m = JSON.parse(String(l.description)); return m.publishedAt && m.size; } catch { return false; } }));
  const val = qa(dbPath, `SELECT status, evidence_json FROM validation_results WHERE rule_id='${NRB_LISTING_RULE_ID}'`);
  check("N1 nrb-listing validator PASS", val.length === 1 && val[0].status === "PASS");
  const ev = JSON.parse(String(val[0].evidence_json)) as { count: number; attrs: Array<{ field: string; text: string }> };
  check("N1 validator evidence count=3", ev.count === 3);
  check("N1 date evidence present (volatile, unasserted)", ev.attrs.some((a) => a.field === "DOCUMENT_DATE" && a.text === "2026-09-22"));
  check("N1 size evidence present (volatile, unasserted)", ev.attrs.some((a) => a.field === "DOCUMENT_SIZE" && a.text === "416.86 kb"));
}

// ============================================================================
// N2 — same listing HTML under a non-NRB (MFB_WEBSITE) source: the NRB parser
// stays silent; zero assertions, validator PENDING
// ============================================================================
{
  const { out, dbPath } = await runFixture("n2", NRB_LISTING, "DOCUMENT_ARCHIVE", nrbListingExtractor, [nrbListingValidator]);
  check("N2 run ok", out.ok === true);
  check("N2 zero NRB assertions outside NRB scope", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions") as { c: number }).c === 0);
  const val = qa(dbPath, `SELECT status FROM validation_results WHERE rule_id='${NRB_LISTING_RULE_ID}'`);
  check("N2 validator PENDING (not a defect)", val.length === 1 && val[0].status === "PENDING");
}

// ============================================================================
// N3 — direct extraction gating: sourceType NRB + DOCUMENT_ARCHIVE/REPORTS is
// the only combination that fires; non-listing bodies are ignored
// ============================================================================
{
  const offCapability = await nrbListingExtractor.extract({
    sourceId: "n3a", sourceType: "NRB", capability: "WEBSITE", url: "https://fixture.test/n3a",
    parserId: "n3a", contentHash: "h", body: new TextEncoder().encode(NRB_LISTING),
  });
  check("N3 silent on WEBSITE capability", offCapability.length === 0);
  const offScope = await nrbListingExtractor.extract({
    sourceId: "n3b", capability: "DOCUMENT_ARCHIVE", url: "https://fixture.test/n3b",
    parserId: "n3b", contentHash: "h", body: new TextEncoder().encode(NRB_LISTING),
  });
  check("N3 silent without sourceType NRB", offScope.length === 0);
  const active = await nrbListingExtractor.extract({
    sourceId: "n3c", sourceType: "NRB", capability: "REPORTS", url: "https://fixture.test/n3c",
    parserId: "n3c", contentHash: "h", body: new TextEncoder().encode(NRB_LISTING),
  });
  check("N3 active on NRB REPORTS (3 links + 3 titles)", active.filter((e) => e.kind === "LINK").length === 3 && active.filter((e) => e.kind === "FIELD" && e.field === "DOCUMENT_TITLE").length === 3);
  const nonListing = await nrbListingExtractor.extract({
    sourceId: "n3d", sourceType: "NRB", capability: "DOCUMENT_ARCHIVE", url: "https://fixture.test/n3d",
    parserId: "n3d", contentHash: "h", body: new TextEncoder().encode(CONTACT_PAGE),
  });
  check("N3 silent on non-listing NRB body", nonListing.length === 0);
}

// ============================================================================
// N4 — production composition (nrb-listing-v1 + finmeta-html-v1) on the same
// NRB page: overlapping DOCUMENT_TITLE evidence is deduped to one per title
// ============================================================================
{
  const { out, dbPath } = await runFixture("n4", NRB_LISTING_CLEAN, "DOCUMENT_ARCHIVE", composeExtractors(nrbListingExtractor, financialMetadataExtractor), nrbStructuredValidators, "NRB");
  check("N4 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='document_title'");
  check("N4 exactly 3 document_title (overlap deduped across extractors)", asserts.length === 3);
  check("N4 unique Q2 title present once", asserts.filter((a) => a.value === "Quarterly Situation of Microfinance Institutions 2026 (Q2)").length === 1);
  check("N4 finmeta does not pollute NRB sidebar into documents", asserts.every((a) => a.value !== "Financial Statements" && a.value !== "Archives (Quarterly Financial Highlights)"));
  const links = qa(dbPath, "SELECT COUNT(*) c FROM outbound_links");
  check("N4 outbound links still 3 in composition", (links[0].c as number) === 3);
}

console.log(`\nPhase R4 structured-metadata results: ${pass} ok / ${fail} fail`);
if (fail > 0) process.exit(1);
console.log("ALL STRUCTURED FIXTURE TESTS PASSED (deterministic, assertions UNVERIFIED, no AI).");
}

main().catch((e) => {
  console.error("structured fixture run crashed:", e);
  process.exit(1);
});