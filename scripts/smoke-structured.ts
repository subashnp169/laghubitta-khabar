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
import { analyzeBranchPage, isAssertableBranchAttribute, isAssertableBranchName, selectBranchRows } from "../lib/ingestion/structured";
import { classifyCoverage } from "../lib/ingestion/shape-signals";
import { branchIdentityKey, groupBranchIdentities } from "../lib/ingestion/branch-records";
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

/** The branch validator's evidence attributes, as { field, text } pairs. */
function branchAttrs(dbPath: string): Array<{ field: string; text: string }> {
  const rows = qa(dbPath, `SELECT evidence_json FROM validation_results WHERE rule_id='${BRANCH_DIRECTORY_RULE_ID}'`);
  if (rows.length === 0) return [];
  const ev = JSON.parse(String(rows[0].evidence_json)) as { attrs?: Array<{ field: string; text: string }> };
  return ev.attrs ?? [];
}

/** Asserted branch names, in the order the engine wrote them. */
function assertedNames(dbPath: string): string[] {
  return qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='branch_name' ORDER BY id").map((r) => String(r.value));
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

// M3.4 shape A: a branch-named heading owning a small label->value block.
const BRANCH_CARDS = `<html><body>
<h3>Branches</h3>
<div class="row">
  <div class="col-sm-4">
    <h4>Mahuli Branch</h4>
    <table class="table">
      <tr><td><i class="fa fa-map-marker"></i></td><td>Agnisair Krishana Sawaran Rural Municipality-6, Mahuli, Saptari</td></tr>
      <tr><td><i class="fa fa-phone"></i></td><td>031-411009</td></tr>
      <tr><td><i class="fa fa-user"></i></td><td>Branch Manager : Mr. Dilip Kumar Chaudhary</td></tr>
    </table>
  </div>
  <div class="col-sm-4">
    <h4>Topa Branch</h4>
    <table class="table">
      <tr><td><i class="fa fa-map-marker"></i></td><td>Kankalini Municipality-7, Hanumannagar, Saptari</td></tr>
      <tr><td><i class="fa fa-phone"></i></td><td>031-580094</td></tr>
    </table>
  </div>
</div>
</body></html>`;

// M3.4 shape B: several records inside one cell, separated by <br>.
const BRANCH_CELLS = `<html><body>
<h1>Our Branches</h1>
<table><tbody>
<tr>
  <td><strong>Area Office</strong><br /><strong>Birtamod, Jhapa</strong><br />Pradeep Kumar<br />Contact: 023-534952 / 9768996603<br />Email: a@example.test</td>
  <td><strong>Branch Office</strong><br /><strong>Baniyani, Jhapa</strong><br />Shiv Kumar Sah<br />Contact: 9768996604<br />Email: b@example.test</td>
  <td><strong>Sub Branch Office</strong><br /><strong>Budhabare, Jhapa</strong><br />Ramesh Pradhan<br />Contact: 025-566330</td>
  <td><strong>Branch</strong><br />Office Hours: 10:00 - 15:00<br />Closed on Saturday</td>
</tr>
</tbody></table>
</body></html>`;

// M3.4 value gate: every name below was measured being asserted from a real page.
const BRANCH_GATE_TRAPS = `<html><body>
<table>
  <tr><td>Branch Manager</td><td>Rupandehi</td><td>+977-71-555111</td></tr>
  <tr><td>Branch Manager</td><td>Kaski</td><td>+977-61-555444</td></tr>
  <tr><td>Branch Manager</td><td>Jhapa</td><td>+977-23-555777</td></tr>
</table>
<p>Total No. of Branch offices: 24 &nbsp; Number of Branch Office: 24 &nbsp; Morang &nbsp; Regional Office</p>
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
// B4 — card grid, no record table (M3.4 shape A, measured on a real target):
//   a branch-named <h4> owning a bounded 2-column label->value block
// ============================================================================
{
  const { out, dbPath } = await runFixture("b4", BRANCH_CARDS, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B4 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='branch_name'");
  check("B4 both card names asserted", asserts.length === 2 && asserts.some((a) => a.value === "Mahuli Branch") && asserts.some((a) => a.value === "Topa Branch"));
  const val = qa(dbPath, `SELECT status FROM validation_results WHERE rule_id='${BRANCH_DIRECTORY_RULE_ID}'`);
  check("B4 validator PASS", val.length === 1 && val[0].status === "PASS");
}

// ============================================================================
// B5 — many records per cell, <br>-separated (M3.4 shape B, measured on a real
//   target): one <td> holding office-type / place / contact / email blocks
// ============================================================================
{
  const { out, dbPath } = await runFixture("b5", BRANCH_CELLS, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B5 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='branch_name'");
  check("B5 three cell records asserted", asserts.length === 3);
  check("B5 office type + place composed into name", asserts.some((a) => a.value === "Branch Office Baniyani, Jhapa"));
  check("B5 sub-branch composed into name", asserts.some((a) => a.value === "Sub Branch Office Budhabare, Jhapa"));
  check("B5 bare 'Branch' line never opens a record", !asserts.some((a) => /Office Hours/.test(String(a.value))));
}

// ============================================================================
// B6 — value gate (M3.4). These three values were measured being asserted from
//   real pages; all must be refused while the row's evidence is still kept.
// ============================================================================
{
  const { out, dbPath } = await runFixture("b6", BRANCH_GATE_TRAPS, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B6 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT value FROM data_assertions WHERE field_name='branch_name'");
  check("B6 zero assertions from header/district/generic values", asserts.length === 0);
  // The gate refuses the NAME, it must not throw away the row's evidence, so
  // exercise the extractor directly rather than the validator's zero-row shape.
  const ev = await branchDirectoryExtractor.extract({
    sourceId: "b6",
    sourceType: "MFB_WEBSITE",
    capability: "BRANCH_DIRECTORY",
    url: "https://fixture.test/branches",
    parserId: "smoke",
    contentHash: "fixture",
    body: new TextEncoder().encode(BRANCH_GATE_TRAPS),
  });
  const names = ev.filter((e) => e.field === "BRANCH_NAME");
  const phones = ev.filter((e) => e.field === "BRANCH_PHONE");
  check("B6 extractor refuses every trapped name", names.length === 0);
  check("B6 'Branch Manager' heading never emitted", !names.some((n) => String(n.text) === "Branch Manager"));
  check("B6 'Regional Office' generic never emitted", !names.some((n) => String(n.text) === "Regional Office"));
  check("B6 'Total No. of Branch offices:' label never emitted", !names.some((n) => String(n.text).startsWith("Total No.")));
  check("B6 bare district never emitted as a name", !names.some((n) => String(n.text) === "Morang"));
  check("B6 generic 'Branch Office' never emitted alone", !names.some((n) => String(n.text).trim() === "Branch Office"));
  check("B6 row evidence retained despite refused names", phones.length > 0);
}

// ============================================================================
// B7 — value-plausibility battery (M3.4 Phase 3). Every MUST_REJECT value here
//   was measured asserting on a real committed target before the generic
//   vocabulary rules were added; every MUST_ACCEPT value is a real name from a
//   committed target. Institution-agnostic: the rules are phrase classes, not
//   per-MFB lists.
// ============================================================================
{
  const MUST_REJECT = [
    "Branch", "Branch Office", "Branch Manager", "Regional Office", "Head Office",
    "Corporate Office", "Sub Branch Office", "Main Branch Office", "Contact Us",
    "Office Hours", "Opening Hours", "Location", "Our Branches", "Branch Network",
    "All Branches", "View All Branches", "Branch List", "Morang", "Jhapa", "Kathmandu",
    "Bagmati Province", "Province 1", "Koshi Province", "Branch Finance Department",
    "Branch Training Department", "Branch Officer", "Branch In Charge",
    "Regional Manager", "Branch Annual Meeting Notice", "Branch Recruitment Notice",
    "Branch Press Release", "Branch Training Workshop", "Branch Annual General Meeting",
    "Home", "About Us", "News", "Contact", "Privacy Policy", "Copyright 2026",
    "Branch No. 2", "Branch 1", "Total No. of Branch offices: 24",
    "Number of Branch Office: 24", "023-534952", "+977-71-555111",
    "info@example.com", "admin@branch.com",
    "Branch Manager : Mr. Rajesh Kumar Chaudhary", "S.No.",
  ];
  const MUST_ACCEPT = [
    "Mahuli Branch", "Birtamod Branch", "Branch Office Baniyani, Jhapa",
    "Area Office Birtamod, Jhapa", "Tikathali Branch, Lalitpur",
    "Regional Office Kathmandu, Kathmandu", "Butwal Branch",
    "Narayan Na.Pa. Branch, Dailekh", "Head Office Butwal",
  ];
  const leaks = MUST_REJECT.filter((v) => isAssertableBranchName(v));
  check(`B7 zero leaks across 48 generic-value classes (leaked: ${leaks.join(" | ") || "none"})`, leaks.length === 0);
  const lost = MUST_ACCEPT.filter((v) => !isAssertableBranchName(v));
  check(`B7 zero recall loss across 9 real names (lost: ${lost.join(" | ") || "none"})`, lost.length === 0);

  // Values that measured as asserting on real targets before Phase 3.
  check("B7 rejects sampada person-attribution value", !isAssertableBranchName("SIRJANA ARYAL (Branch manager)"));
  check("B7 rejects mero UI string", !isAssertableBranchName("No branches match your filters."));
  check("B7 rejects supportmicrofinance section label", !isAssertableBranchName("Branch Network"));
  check("B7 rejects nerudemirmire aggregate", !isAssertableBranchName("Total Branches: 225"));
  check("B7 rejects meromorphic GPS UI copy", !isAssertableBranchName("Branches with GPS coordinates are shown on the map. Click any marker for details."));

  // Attribute gate (Phase 3 / 15): valid values, and stable reason codes.
  const attr = (f: string, v: string): string => {
    const r = isAssertableBranchAttribute(f, v);
    return r.ok ? "ok" : r.reason;
  };
  check("B7 district accepts a known district", attr("BRANCH_DISTRICT", "Jhapa") === "ok");
  check("B7 district rejects a non-district", attr("BRANCH_DISTRICT", "Head Office") === "NOT_A_DISTRICT");
  check("B7 phone accepts a landline", attr("BRANCH_PHONE", "031-411009") === "ok");
  check("B7 phone accepts an intl mobile", attr("BRANCH_PHONE", "+977-9768996603") === "ok");
  check("B7 phone rejects letters", attr("BRANCH_PHONE", "Call 031-411009") === "CONTAINS_LETTERS");
  check("B7 phone rejects a date", attr("BRANCH_PHONE", "2026-09-27") === "DATE_LIKE");
  check("B7 phone rejects too few digits", attr("BRANCH_PHONE", "12345") === "CONTAINS_LETTERS");
  check("B7 phone rejects a repeated-digit run", attr("BRANCH_PHONE", "0000000000") === "REPEATED_DIGITS");
  check("B7 place accepts an address", attr("BRANCH_PLACE", "Mahuli, Saptari") === "ok");
  check("B7 place rejects a bare generic label", attr("BRANCH_PLACE", "office") === "GENERIC_LABEL");
  check("B7 email accepts a normal address", attr("BRANCH_EMAIL", "info@example.com") === "ok");
  check("B7 email rejects a missing tld", attr("BRANCH_EMAIL", "info@example") === "EMAIL_FORMAT");
  check("B7 map accepts https maps provider", attr("BRANCH_MAP_URL", "https://www.google.com/maps/place/Test") === "ok");
  check("B7 map rejects http scheme", attr("BRANCH_MAP_URL", "http://maps.google.com/?q=1") === "MAP_SCHEME");
  check("B7 map rejects an unknown host", attr("BRANCH_MAP_URL", "https://evil.example.com/x") === "MAP_HOST");
  check("B7 unknown attribute field is refused", attr("BRANCH_FAX", "+977-71-555111") === "UNKNOWN_FIELD");
  // Phase 6 additions: mobile, address, manager.
  check("B7 mobile accepts a national mobile", attr("BRANCH_MOBILE", "9802887103") === "ok");
  check("B7 mobile accepts +977 form", attr("BRANCH_MOBILE", "+977-9802887103") === "ok");
  check("B7 mobile rejects a landline", attr("BRANCH_MOBILE", "061-434412") === "DIGIT_COUNT");
  check("B7 mobile rejects an office number", attr("BRANCH_MOBILE", "0614344") === "DIGIT_COUNT");
  check("B7 address accepts a ward/address line", attr("BRANCH_ADDRESS", "Ghorahi-8, Rukum West") === "ok");
  check("B7 address rejects a company name", attr("BRANCH_ADDRESS", "Aatmanirbhar Laghubitta Sanstha Ltd.") === "GENERIC_LABEL");
  check("B7 manager accepts a person name", attr("BRANCH_MANAGER", "Tirshana Chaudhary") === "ok");
  check("B7 manager rejects a role label", attr("BRANCH_MANAGER", "Branch Manager") === "GENERIC_LABEL");
  check("B7 manager rejects an email", attr("BRANCH_MANAGER", "ghorahi@example.com") === "CONTAINS_URL");
  check("B7 manager rejects all-caps slogan", attr("BRANCH_MANAGER", "BRANCH MANAGER") === "GENERIC_LABEL");
}

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

// ============================================================================
// Phase 5/6 — reusable branch grammars and contact attributes.
// Each fixture is minimal and shape-generic: no class name, id, URL or
// institution name is used, so a pass proves the grammar, not the page.
// ============================================================================

// --- B8: heading + email is enough. Phone and district are NOT required. ----
const B8_EMAIL_ONLY = `<html><body>
<div class="title">Branch Directory</div>
<div class="card"><h4>Butwal Branch</h4><a href="mailto:butwal.branch@example.com">butwal.branch@example.com</a></div>
</body></html>`;
{
  const { out, dbPath } = await runFixture("b8", B8_EMAIL_ONLY, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B8 run ok", out.ok === true);
  const names = assertedNames(dbPath);
  check("B8 email-only card asserts exactly one branch", names.length === 1 && names[0] === "Butwal Branch");
  const attrs = branchAttrs(dbPath);
  check("B8 branch email extracted", attrs.some((a) => a.field === "BRANCH_EMAIL" && a.text === "butwal.branch@example.com"));
  check("B8 no phone invented", attrs.every((a) => a.field !== "BRANCH_PHONE"));
  check("B8 no district invented", attrs.every((a) => a.field !== "BRANCH_DISTRICT"));
  check("B8 district is not mined out of the mailbox name", selectBranchRows(B8_EMAIL_ONLY).rows.every((r) => r.district === null));
  const a = analyzeBranchPage(B8_EMAIL_ONLY);
  check("B8 email card is not a weak candidate", a.weakCardCandidates === 0);
  check("B8 analysis reports 1 valid name", a.validNames === 1);
}

// --- B9: the same card plus a printed address. ----------------------------
const B9_EMAIL_ADDRESS = `<html><body>
<div class="title">Branch Directory</div>
<div class="card"><h4>Pokhara Branch</h4><p>Kaski-4, Lakeside, Pokhara</p><a href="mailto:pokhara.branch@example.com">pokhara.branch@example.com</a></div>
</body></html>`;
{
  const { out, dbPath } = await runFixture("b9", B9_EMAIL_ADDRESS, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B9 run ok", out.ok === true);
  check("B9 name asserted", assertedNames(dbPath).length === 1);
  const attrs = branchAttrs(dbPath);
  check("B9 unlabelled address line extracted as place", attrs.some((a) => (a.field === "BRANCH_PLACE" || a.field === "BRANCH_ADDRESS") && a.text === "Kaski-4, Lakeside, Pokhara"));
  check("B9 email extracted", attrs.some((a) => a.field === "BRANCH_EMAIL" && a.text === "pokhara.branch@example.com"));
  check("B9 email+address is strong evidence", analyzeBranchPage(B9_EMAIL_ADDRESS).weakCardCandidates === 0);
}

// --- B10: the same card plus a phone. --------------------------------------
const B10_EMAIL_PHONE = `<html><body>
<div class="title">Branch Directory</div>
<div class="card"><h4>Bharatpur Branch</h4><p>Phone: 061-465111</p><a href="mailto:bharatpur.branch@example.com">bharatpur.branch@example.com</a></div>
</body></html>`;
{
  const { out, dbPath } = await runFixture("b10", B10_EMAIL_PHONE, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B10 run ok", out.ok === true);
  check("B10 name asserted", assertedNames(dbPath).length === 1);
  const attrs = branchAttrs(dbPath);
  check("B10 labelled phone extracted", attrs.some((a) => a.field === "BRANCH_PHONE" && a.text === "061-465111"));
  check("B10 email extracted", attrs.some((a) => a.field === "BRANCH_EMAIL" && a.text === "bharatpur.branch@example.com"));
  check("B10 phone line is not harvested as an address", attrs.every((a) => a.text !== "Phone: 061-465111"));
}

// --- B11: a generic contact block is not a branch. -------------------------
const B11_GENERIC_CONTACT = `<html><body>
<h3>Contact Us</h3>
<p>Email: <a href="mailto:info@example.com">info@example.com</a></p>
<p>Phone: 061-111222</p>
</body></html>`;
{
  const { out, dbPath } = await runFixture("b11", B11_GENERIC_CONTACT, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B11 run ok", out.ok === true);
  check("B11 generic contact asserts no branch", assertedNames(dbPath).length === 0);
  check("B11 generic contact is reported as a rejected candidate", analyzeBranchPage(B11_GENERIC_CONTACT).refusedCardCandidates.includes("Contact Us"));
  check("B11 isPersonOrRoleHeading does not treat Contact Us as a place", !isAssertableBranchName("Contact Us"));
}

// --- B12: a department heading is not a branch. ----------------------------
const B12_DEPARTMENT = `<html><body>
<h3>Credit Department</h3>
<p>Call 061-111333 for loan enquiries.</p>
<h3>Branch Office</h3>
<p>Head Office, Kathmandu</p>
<h3>Training Department</h3>
<p>Phone: 061-111444</p>
</body></html>`;
{
  const { out, dbPath } = await runFixture("b12", B12_DEPARTMENT, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B12 run ok", out.ok === true);
  check("B12 department headings assert no branch", assertedNames(dbPath).length === 0);
  for (const label of ["Credit Department", "Branch Office", "Training Department"]) {
    check(`B12 "${label}" refused as a name`, !isAssertableBranchName(label));
  }
}

// --- B13: a footer block is not a branch, and does not steal a real one. ----
const B13_FOOTER = `<html><body>
<div class="card"><h4>Gorkha Branch</h4><a href="mailto:gorkha.branch@example.com">gorkha.branch@example.com</a></div>
<footer><h5>Head Office</h5><p>info@example.com</p></footer>
</body></html>`;
{
  const { out, dbPath } = await runFixture("b13", B13_FOOTER, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B13 run ok", out.ok === true);
  const names = assertedNames(dbPath);
  check("B13 footer does not become a branch", names.length === 1 && names[0] === "Gorkha Branch");
  check("B13 Head Office refused as a name", !isAssertableBranchName("Head Office"));
}

// --- B14: a run of >= 3 structurally identical peers is accepted. ---------
const B14_PEERS = `<html><body>
<div class="title">Branch Directory</div>
<div class="card"><h4>Jhapa Branch</h4><a href="mailto:jhapa.branch@example.com">jhapa.branch@example.com</a></div>
<div class="card"><h4>Morang Branch</h4><a href="mailto:morang.branch@example.com">morang.branch@example.com</a></div>
<div class="card"><h4>Sunsari Branch</h4><a href="mailto:sunsari.branch@example.com">sunsari.branch@example.com</a></div>
<div class="card"><h4>Udayapur Branch</h4><a href="mailto:udayapur.branch@example.com">udayapur.branch@example.com</a></div>
</body></html>`;
{
  const { out, dbPath } = await runFixture("b14", B14_PEERS, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B14 run ok", out.ok === true);
  const names = assertedNames(dbPath);
  check("B14 all four peer branches asserted", names.length === 4);
  check("B14 peer names are distinct", new Set(names).size === 4);
  const status = qa(dbPath, `SELECT status FROM validation_results WHERE rule_id='${BRANCH_DIRECTORY_RULE_ID}'`);
  check("B14 distinct names pass the repeated-heading backstop", status[0].status === "PASS");
  check("B14 every peer keeps its own email", branchAttrs(dbPath).filter((a) => a.field === "BRANCH_EMAIL").length === 4);
}

// --- B15: a heading without branch semantics is not a record. --------------
const B15_NO_SEMANTICS = `<html><body>
<div class="title">Our Network</div>
<div class="card"><h4>Branch Network</h4><p>Welcome to our website</p></div>
</body></html>`;
const B15_HEADING_ONLY = `<html><body>
<div class="title">Our Branches</div>
<div class="card"><h4>Gorkha Branch</h4></div>
</body></html>`;
{
  const { out, dbPath } = await runFixture("b15", B15_NO_SEMANTICS, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B15 run ok", out.ok === true);
  check("B15 semantics-free heading asserts no branch", assertedNames(dbPath).length === 0);
  check("B15 'Branch Network' refused as a name", !isAssertableBranchName("Branch Network"));

  // A name that passes the value gate but carries no evidence at all stays a
  // candidate: reported as weak, never asserted. This is the rule that stops a
  // lone heading from becoming a branch.
  const a = analyzeBranchPage(B15_HEADING_ONLY);
  check("B15 heading-only card is weak, not assertable", a.weakCardCandidates === 1);
  check("B15 heading-only card asserts nothing", a.validNames === 0);
  const weak = await runFixture("b15b", B15_HEADING_ONLY, "BRANCH_DIRECTORY", branchDirectoryExtractor, structuredValidators);
  check("B15 heading-only card writes no assertion", assertedNames(weak.dbPath).length === 0);
  check("B15 heading-only run ok", weak.out.ok === true);
}

// --- B16: identity is institution + name + geography, never the contacts. --
{
  const before = { name: "Waling Branch", district: "Rupandehi", place: "Waling" };
  // Same branch, republished with a new serial code and different contacts.
  const after = { name: "Waling Branch (003)", district: "Rupandehi", place: "Waling", email: "waling.new@example.com", phone: "+977-1-555999" };
  const k1 = branchIdentityKey("inst-laghubitta", before.name, before);
  const k2 = branchIdentityKey("inst-laghubitta", after.name, after);
  check("B16 same branch with new contacts keeps one identity", k1 === k2);
  check("B16 identity does not embed the email", !k1.includes("example.com"));
  check("B16 identity does not embed the phone", !k1.includes("555999"));
  check("B16 identity is stable across repeated calls", k1 === branchIdentityKey("inst-laghubitta", before.name, before));

  const groups = groupBranchIdentities("inst-laghubitta", [before, after]);
  check("B16 two rows collapse to one identity", groups.length === 1 && groups[0].keys.length === 1);
  check("B16 the collapsed name is not ambiguous", groups[0].ambiguous === false);

  // The geographic discriminator keeps genuinely different branches apart.
  const ambiguous = groupBranchIdentities("inst-laghubitta", [
    { name: "Butwal Branch", district: "Rupandehi" },
    { name: "Butwal Branch", district: "Kapilvastu" },
  ]);
  check("B16 same name in two districts is flagged ambiguous", ambiguous.length === 1 && ambiguous[0].ambiguous === true);
  check("B16 same name in two districts yields two identities", ambiguous[0].keys.length === 2);
  check("B16 the two identities differ", ambiguous[0].keys[0] !== ambiguous[0].keys[1]);

  // Two institutions may both have a "Main Branch": identity must not merge them.
  check(
    "B16 the same name in two institutions is two identities",
    branchIdentityKey("inst-a", "Main Branch", { district: "Kathmandu" }) !== branchIdentityKey("inst-b", "Main Branch", { district: "Kathmandu" }),
  );

  // Determinism of the whole parse, not just the key helper.
  check("B16 parse is deterministic across runs", JSON.stringify(analyzeBranchPage(B14_PEERS)) === JSON.stringify(analyzeBranchPage(B14_PEERS)));
  check("B16 path selection is stable", selectBranchRows(B14_PEERS).path === selectBranchRows(B14_PEERS).path);

  // --- B17: a bare place name is a branch only under a column that says so. ---
  // Real source shape: one 143-row table headed
  // "S.No. | Branch Name | Province | Province District | Local Bodies | Ward | Address",
  // where the first 60+ values are bare local-body names. Under "Branch Name"
  // they are branch names; under a bare "Name" header they are not.
  const bareRow = (header: string): string =>
    `<table><tr><th>S.No.</th><th>${header}</th><th>Province</th><th>Province District</th><th>Ward</th></tr>`
    + `<tr><td>1</td><td>Ghorahi</td><td>Koshi</td><td>Sunbarshi</td><td>4</td></tr>`
    + `<tr><td>2</td><td>Amardaha</td><td>Koshi</td><td>Dhankuta</td><td>2</td></tr></table>`;

  const declared = selectBranchRows(bareRow("Branch Name"));
  check("B17 a declared branch column yields the table path", declared.path === "table");
  check("B17 a declared branch column keeps every row", declared.rows.length === 2);
  check(
    "B17 a bare place name asserts under a declared branch column",
    declared.rows.every((r) => isAssertableBranchName(r.name) || r.nameFromDeclaredBranchColumn === true),
  );
  check("B17 the bare place names are the ones asserted", declared.rows.map((r) => r.name).join(",") === "Ghorahi,Amardaha");

  // Path choice must use the SAME predicate the extractor asserts with, otherwise a
  // name that qualifies only by its column is returned by the table and then dropped.
  const declaredAnalysis = analyzeBranchPage(bareRow("Branch Name"));
  check("B17 the analysis accepts the declared-column names", declaredAnalysis.validNames === 2);
  check("B17 the analysis reports the table path", declaredAnalysis.path === "table");
  check("B17 a declared-column table refuses nothing", declaredAnalysis.rejectedNames === 0);

  // A generic "Name" column with no branch semantics is still refused: the fix is
  // the declared column, not bare place names in general.
  const generic = selectBranchRows(bareRow("Name"));
  check("B17 a generic Name column marks no row as a declared branch", generic.rows.every((r) => r.nameFromDeclaredBranchColumn !== true));
  const genericAnalysis = analyzeBranchPage(bareRow("Name"));
  check("B17 a generic Name column asserts nothing", genericAnalysis.validNames === 0);
  check("B17 a generic Name column refuses the bare place names", genericAnalysis.rejectedNames === 2);

  // A "Name" column sitting beside a "Branch" column is a people column, not a
  // branch column: the branch name is the Branch cell and the Name is a manager.
  const managerTable =
    `<table><tr><th>S.N.</th><th>Name</th><th>Position</th><th>Branch</th><th>Branch Address</th><th>Ward No.</th><th>Email Address</th><th>Contact No.</th></tr>`
    + `<tr><td>1</td><td>Kalpana Khanal</td><td>Manager</td><td>Birtamod</td><td>Birtamod, Jhapa</td><td>3</td><td>k@example.org</td><td>9812000000</td></tr>`
    + `<tr><td>2</td><td>Suresh Rana</td><td>Manager</td><td>Dhulabari</td><td>Dhulabari, Jhapa</td><td>2</td><td>s@example.org</td><td>9812000001</td></tr></table>`;
  const managerRows = selectBranchRows(managerTable);
  check("B17 a manager Name column is not read as the branch", managerRows.rows.every((r) => !r.name.includes("Khanal") && !r.name.includes("Rana")));
  check("B17 the Branch cell supplies the branch name", managerRows.rows.map((r) => r.name).includes("Birtamod"));
  check("B17 a prose row before the header does not become a record", selectBranchRows(
    `<p>Some preamble about branches</p>${managerTable}`,
  ).rows.length === 2);

  // --- B18: one place's contact details is a single location, not a directory. ---
  // Real source shape: a static page whose header/footer link to the branch page.
  // The word "branch" appears from navigation, the page gives one office's details,
  // and no record structure exists. This must not be recorded as branch intent we
  // failed to read, and must never yield a branch assertion.
  const contactVerdict = classifyCoverage({
    structural: {
      tableCount: 0, recordTableCount: 0, branchRowCount: 0, headingCount: 0,
      branchHeadingCount: 0, containerCount: 0, phoneBlocks: 0, brGroupCount: 0,
      mapLinkCount: 0, emailCount: 1, phoneCount: 0, addressCount: 0,
      visibleTextLength: 250, scriptCount: 0, noscriptCount: 0, jsRenderedIndicators: 0,
      title: "Contact Us",
    },
    densities: {} as never,
    validNames: 0, candidateRecords: 0, rejectedNames: 0,
    branchVocabHits: 2, roleBearingPeople: 0, httpStatus: 200, bodyBytes: 32000,
  });
  check("B18 one contact location is a single location, not unread", contactVerdict.coverage === "SINGLE_LOCATION_CONTACT");
  check("B18 a single location asserts no structural records", contactVerdict.structuralRecords === 0);

  // The same signals with directory-scale branch talk must stay a "needs work"
  // class: slbsl has 99 branch mentions and no readable records.
  const directoryTalk = classifyCoverage({
    structural: {
      tableCount: 0, recordTableCount: 0, branchRowCount: 0, headingCount: 1,
      branchHeadingCount: 0, containerCount: 0, phoneBlocks: 1, brGroupCount: 0,
      mapLinkCount: 0, emailCount: 48, phoneCount: 2, addressCount: 0,
      visibleTextLength: 7803, scriptCount: 0, noscriptCount: 0, jsRenderedIndicators: 0,
      title: "Branches",
    },
    densities: {} as never,
    validNames: 0, candidateRecords: 0, rejectedNames: 0,
    branchVocabHits: 99, roleBearingPeople: 0, httpStatus: 200, bodyBytes: 57507,
  });
  check("B18 directory-scale branch talk is not softened to a single location", directoryTalk.coverage === "BRANCH_INTENT_NO_STRUCTURE");
}

console.log(`\nPhase R4 structured-metadata results: ${pass} ok / ${fail} fail`);
if (fail > 0) process.exit(1);
console.log("ALL STRUCTURED FIXTURE TESTS PASSED (deterministic, assertions UNVERIFIED, no AI).");
}

main().catch((e) => {
  console.error("structured fixture run crashed:", e);
  process.exit(1);
});