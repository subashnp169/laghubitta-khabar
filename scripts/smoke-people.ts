// ============================================================================
// Phase R3 — People/Leadership extraction acceptance tests (fixture-proven,
// no real crawling, no production D1). Proves the deterministic people parser
// end-to-end through the GENERIC engine:
//   P1 EN board table   → chair + directors asserted (UNVERIFIED)
//   P2 NE committee     → Devanagari directors asserted (UNVERIFIED)
//   P3 management list  → CEO + board names asserted (UNVERIFIED)
//   P4 no leadership    → zero people assertions, validator PENDING
//   P5 junk block       → emails/phones/addresses → zero people, PENDING
//   P6 prose floor      → paragraph name is evidence-only (0.4 → NO assertion)
//   P7 confidence floor → every persisted people assertion is UNVERIFIED
//   P8 nameLike() guards → address/contact strings rejected
// ============================================================================

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { buildEngine } from "../lib/ingestion";
import { LocalSqliteEvidenceWriter, LocalSourceRegistry, pilotValidators } from "../lib/ingestion";
import { peopleExtractor, peopleValidators, PEOPLE_DIRECTORY_RULE_ID, nameLike } from "../lib/ingestion";
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

function makeSource(id: string): IngestionSourceSpec {
  return {
    id: `people-${id}`,
    url: `https://fixture.test/${id}`,
    domain: "fixture.test",
    sourceType: "MFB_WEBSITE",
    enabled: true,
    fetchIntervalMinutes: 1440,
    capabilities: [
      { kind: "WEBSITE", status: "CANDIDATE", knownUrl: `https://fixture.test/${id}` },
      { kind: "NEWS", status: "CANDIDATE", knownUrl: null },
    ],
  };
}

function scratchDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lk-people-"));
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
  db.prepare(
    `INSERT INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
     VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, 'fixture', 1)`,
  ).run(src.id, src.url, src.domain, `fixture: ${src.id}`);
  db.prepare(
    `INSERT INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
     VALUES (?, ?, ?, ?, NULL, ?, 1, 1440)`,
  ).run(src.id, src.url, src.domain, src.sourceType, JSON.stringify({ capabilities: src.capabilities }));
  for (const rule of [
    ["r-people-directory", "PEOPLE_DIRECTORY", "people directory extraction", "SANITY", "WARN"],
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

async function runPeople(id: string, body: string) {
  const dbPath = scratchDb();
  const src = makeSource(id);
  seedScratch(dbPath, src);
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: htmlFetcher(body),
    discovery: discoverHome("WEBSITE"),
    extractor: peopleExtractor,
    writer: new LocalSqliteEvidenceWriter(dbPath),
    validators: peopleValidators,
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

const EN_BOARD = `<html><body>
<h3>Board of Directors</h3>
<table>
  <tr><th>Name</th><th>Designation</th></tr>
  <tr><td>Mr. Ram Bahadur Thapa</td><td>Chairman</td></tr>
  <tr><td>Ms. Sita Devi Sharma</td><td>Director</td></tr>
  <tr><td>Er. Hari Prasad Koirala</td><td>Independent Director</td></tr>
</table>
</body></html>`;

const NE_COMMITTEE = `<html><body>
<h2>संचालक समिति</h2>
<table>
  <tr><th>नाम</th><th>पद</th></tr>
  <tr><td>श्री प्रेम बहादुर श्रेष्ठ</td><td>अध्यक्ष</td></tr>
  <tr><td>श्रीमती गीता कुमारी लामा</td><td>सञ्चालक</td></tr>
</table>
</body></html>`;

const MGMT_LIST = `<html><body>
<h3>Management Team</h3>
<ul>
  <li><strong>Bimala Rai Paudel</strong> - Chief Executive Officer</li>
  <li><strong>Kiran Thapa Magar</strong> - Head of Operations</li>
</ul>
</body></html>`;

const ABOUT_ONLY = `<html><body>
<h3>About Us</h3>
<p>Established in 2005, the institution serves rural communities across the country.</p>
</body></html>`;

const JUNK_MGMT = `<html><body>
<h3>Management</h3>
<table>
  <tr><td>info@mfb.example</td><td>+977-1-5551234</td></tr>
  <tr><td>Baneshwor, Kathmandu</td><td>www.mfb.example</td></tr>
</table>
</body></html>`;

const PROSE_LEAD = `<html><body>
<h3>Our Team</h3>
<p>Gopal Krishna Shrestha, general manager, leads the daily operations of the office.</p>
</body></html>`;

// ============================================================================
// P1 — English board table: chair + directors become UNVERIFIED assertions
// ============================================================================
async function main(): Promise<void> {
{
  const { out, dbPath } = await runPeople("board-en", EN_BOARD);
  check("P1 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT field_name, value, verification_status, confidence FROM data_assertions");
  check("P1 exactly 3 people assertions", asserts.length === 3);
  check("P1 chairperson asserted (UNVERIFIED)", asserts.some((a) => a.field_name === "people_chair" && a.value === "Mr. Ram Bahadur Thapa"));
  check("P1 directors asserted (UNVERIFIED)", asserts.filter((a) => a.field_name === "people_director").length === 2);
  check("P1 every assertion UNVERIFIED + confidence>=0.5", asserts.every((a) => a.verification_status === "UNVERIFIED" && Number(a.confidence) >= 0.5));
  const val = qa(dbPath, `SELECT status, message, evidence_json FROM validation_results WHERE rule_id='${PEOPLE_DIRECTORY_RULE_ID}'`);
  check("P1 people validator PASS", val.length === 1 && val[0].status === "PASS");
  const ev = JSON.parse(String(val[0].evidence_json)) as { peopleCount: number };
  check("P1 validator evidence peopleCount=3", ev.peopleCount === 3);
}

// ============================================================================
// P2 — Nepali committee table: Devanagari directors asserted (UNVERIFIED)
// ============================================================================
{
  const { out, dbPath } = await runPeople("board-ne", NE_COMMITTEE);
  check("P2 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT field_name, value, confidence FROM data_assertions");
  check("P2 chairperson (Devanagari) asserted", asserts.some((a) => a.field_name === "people_chair" && a.value === "श्री प्रेम बहादुर श्रेष्ठ"));
  check("P2 director (Devanagari) asserted", asserts.some((a) => a.field_name === "people_director" && a.value === "श्रीमती गीता कुमारी लामा"));
  check("P2 all UNVERIFIED", asserts.every((a) => { const row = q(dbPath, `SELECT verification_status FROM data_assertions WHERE value='${a.value}'`); return row?.verification_status === "UNVERIFIED"; }));
}

// ============================================================================
// P3 — management list: CEO + board name asserted; strong inside <li> not
// double-reported
// ============================================================================
{
  const { out, dbPath } = await runPeople("mgmt", MGMT_LIST);
  check("P3 run ok", out.ok === true);
  const asserts = qa(dbPath, "SELECT field_name, value FROM data_assertions");
  check("P3 CEO asserted from list", asserts.some((a) => a.field_name === "people_ceo" && a.value === "Bimala Rai Paudel"));
  check("P3 block-level board name asserted (not duplicated)", asserts.filter((a) => a.field_name === "people_board").length === 1 && asserts.some((a) => a.field_name === "people_board" && a.value === "Kiran Thapa Magar"));
}

// ============================================================================
// P4 — no leadership section → zero people assertions, validator PENDING
// ============================================================================
{
  const { out, dbPath } = await runPeople("about", ABOUT_ONLY);
  check("P4 run ok", out.ok === true);
  check("P4 zero people assertions", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions") as { c: number }).c === 0);
  const val = qa(dbPath, `SELECT status FROM validation_results WHERE rule_id='${PEOPLE_DIRECTORY_RULE_ID}'`);
  check("P4 validator PENDING (no people evidence)", val.length === 1 && val[0].status === "PENDING");
}

// ============================================================================
// P5 — junk block (emails / phones / addresses) → zero people, PENDING
// ============================================================================
{
  const { out, dbPath } = await runPeople("junk", JUNK_MGMT);
  check("P5 run ok", out.ok === true);
  check("P5 zero people assertions from junk", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions") as { c: number }).c === 0);
  const val = qa(dbPath, `SELECT status FROM validation_results WHERE rule_id='${PEOPLE_DIRECTORY_RULE_ID}'`);
  check("P5 validator PENDING (no junk leaked)", val.length === 1 && val[0].status === "PENDING");
  const evidence = qa(dbPath, `SELECT evidence_json FROM validation_results WHERE rule_id='${PEOPLE_DIRECTORY_RULE_ID}'`);
  check("P5 junk never classified FAIL (no malformed values)", val[0].status !== "FAIL" && JSON.parse(String(evidence[0].evidence_json)).peopleCount === 0);
}

// ============================================================================
// P6 — prose floor: paragraph name is EVIDENCE ONLY (0.4) → never an assertion
// ============================================================================
{
  const { out, dbPath } = await runPeople("prose", PROSE_LEAD);
  check("P6 run ok", out.ok === true);
  check("P6 zero people assertions from prose", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions") as { c: number }).c === 0);
  const val = qa(dbPath, `SELECT status, evidence_json FROM validation_results WHERE rule_id='${PEOPLE_DIRECTORY_RULE_ID}'`);
  check("P6 validator PASS (evidence present but unasserted)", val.length === 1 && val[0].status === "PASS");
  check("P6 one evidence-level person recorded", JSON.parse(String(val[0].evidence_json)).peopleCount === 1);
}

// ============================================================================
// P7 — every persisted people assertion is UNVERIFIED (engine contract)
// ============================================================================
{
  const { dbPath } = await runPeople("verify", EN_BOARD);
  const rows = qa(dbPath, "SELECT DISTINCT verification_status FROM data_assertions");
  check("P7 only UNVERIFIED asserted", rows.length === 1 && rows[0].verification_status === "UNVERIFIED");
}

// ============================================================================
// P8 — nameLike() guards: contacts/addresses are never names
// ============================================================================
{
  check("P8 email rejected", nameLike("info@mfb.example") === false);
  check("P8 phone rejected", nameLike("+977-1-5551234") === false);
  check("P8 url rejected", nameLike("www.mfb.example") === false);
  check("P8 address rejected", nameLike("Baneshwor, Kathmandu") === false);
  check("P8 proper name accepted", nameLike("Mr. Ram Bahadur Thapa") === true);
  check("P8 Devanagari name accepted", nameLike("श्री प्रेम बहादुर श्रेष्ठ") === true);
}

console.log(`\nPhase R3 people-extraction results: ${pass} ok / ${fail} fail`);
if (fail > 0) process.exit(1);
console.log("ALL PEOPLE FIXTURE TESTS PASSED (deterministic, assertions UNVERIFIED, no AI).");
}

main().catch((e) => {
  console.error("people fixture run crashed:", e);
  process.exit(1);
});