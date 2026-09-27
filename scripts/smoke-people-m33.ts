// ============================================================================
// M3.3 — Deterministic People/Leadership extraction acceptance (fixture-proven,
// no network, no production D1, no AI/OCR/browser). Proves the four source
// shapes + the review/conflict lifecycle + the API read model:
//
//   A  normal HTML people page (list + prose)   → asserted UNVERIFIED
//   B  HTML table board page                    → asserted UNVERIFIED
//   C  HTML card / profile page (NEW)           → one person per card
//   D  JSON / Data-API leadership route (NEW)   → asserted UNVERIFIED
//   E  provenance: source + snapshot + hash linkage on every assertion
//   F  idempotency (same body → UNCHANGED) and history (changed value appends)
//   G  review lifecycle: UNVERIFIED → HUMAN_VERIFIED / REJECTED (audit-logged)
//   H  conflict: two sources disagree → OPEN data_conflicts → CONFLICT person
//   I  API read model: listLeadership / getPersonBySlug / search.people over
//      the SAME evidence via the local repository adapter + PersonDto shapes
//   J  malformed input: junk cards/JSON produce no people assertions
// ============================================================================

import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  DATA_API_PARSER_ID,
  LocalSqliteEvidenceWriter,
  LocalSourceRegistry,
  PEOPLE_JSON_PARSER_ID,
  PEOPLE_PARSER_ID,
  buildEngine,
  extractPeopleJson,
  flagPeopleConflicts,
  listOpenConflicts,
  parseDataApiConfig,
  peopleExtractor,
  peopleValidators,
  peopleRoleFamily,
  resolveConflict,
  reviewAssertion,
  runDataApiPass,
} from "../lib/ingestion";
import { pickPeopleFromBlock } from "../lib/ingestion/people";
import type { DiscoveredTarget, FetchOptions, FetchResult, IngestionSourceSpec } from "../lib/ingestion";
import { localRepository } from "../lib/repository/local";
import { peopleFromAssertionRows, type PersonAssertionRecord } from "../lib/repository/projection";

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
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name, detail ?? ""); }
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

const INSTITUTION_ID = "inst-m33-fixture";
const INSTITUTION_SLUG = "fixture-laghubitta-samuhik";

// ---------------------------------------------------------------- fixtures
const NORMAL_HTML = `<html><body>
  <h1>Fixture Laghubitta Samuhik</h1>
  <h2>Our Team</h2>
  <ul>
    <li><strong>Bimala Rai Paudel</strong> - Chief Executive Officer</li>
    <li><strong>Kiran Thapa Magar</strong> - Head of Operations</li>
  </ul>
  <h2>Contact</h2>
  <p>info@fixture.test | +977-1-5551234</p>
</body></html>`;

const TABLE_HTML = `<html><body>
  <h3>Board of Directors</h3>
  <table>
    <tr><th>Name</th><th>Designation</th></tr>
    <tr><td>Mr. Ram Bahadur Thapa</td><td>Chairman</td></tr>
    <tr><td>Ms. Sita Devi Sharma</td><td>Director</td></tr>
  </table>
</body></html>`;

const CARD_HTML = `<html><body>
  <h2>Leadership</h2>
  <div class="team-grid">
    <div class="team-card">
      <img src="/img/gopal.jpg" alt="">
      <h4>Gopal Krishna Shrestha</h4>
      <span class="designation">Chairman</span>
    </div>
    <div class="team-card">
      <h4>Anita Gurung</h4>
      <span class="designation">Chief Executive Officer</span>
    </div>
    <div class="team-card">
      <h4>Deepak Bahadur Shrestha</h4>
      <span class="designation">Director</span>
    </div>
  </div>
</body></html>`;

const CARD_HTML_CHANGED = CARD_HTML.replace("Chairman", "Acting Chairman");

const PEOPLE_JSON = {
  data: {
    chairman: { name: "Ramesh Gurung", designation: "Chairman" },
    ceo: { name: "Prakash Adhikari", designation: "Chief Executive Officer" },
    board: [
      { name: "Sunita Poudel", designation: "Director" },
      { name: "Mohan Karki", designation: "Independent Director" },
    ],
  },
};

const PEOPLE_JSON_JUNK = { data: { chairman: { name: "info@fixture.test" }, board: [{ name: "+977-1-5551234" }, { name: "www.fixture.test" }] } };

// ---------------------------------------------------------------- harness
function scratchDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lk-people-m33-"));
  const path = join(dir, "fixture.db");
  const schema = fs.readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(path);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  db.prepare(
    `INSERT INTO institutions (id, slug, name_en, short_name, institution_type, status)
     VALUES (?, ?, 'Fixture Laghubitta Samuhik', 'Fixture Mfi', 'PROVINCIAL', 'ACTIVE')`,
  ).run(INSTITUTION_ID, INSTITUTION_SLUG);
  db.close();
  return path;
}

function seedSource(dbPath: string, id: string, configJson: Record<string, unknown>, url: string, domain: string): IngestionSourceSpec {
  const src: IngestionSourceSpec = {
    id,
    url,
    domain,
    sourceType: "MFB_WEBSITE",
    institutionId: INSTITUTION_ID,
    enabled: true,
    fetchIntervalMinutes: 1440,
    capabilities: [{ kind: "PEOPLE", status: "CANDIDATE", knownUrl: url }],
  };
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
     VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, 'fixture', 1)`,
  ).run(id, url, domain, `fixture: ${id}`);
  db.prepare(
    `INSERT INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1440)`,
  ).run(id, url, domain, src.sourceType, INSTITUTION_ID, JSON.stringify(configJson));
  db.prepare(
    `INSERT OR IGNORE INTO validation_rules (id, rule_code, name, category, severity, active, params_json)
     VALUES ('r-people-directory', 'PEOPLE_DIRECTORY', 'people directory extraction', 'SANITY', 'WARN', 1, '{}')`,
  ).run();
  db.close();
  return src;
}

function htmlFetcher(bodies: Record<string, string>) {
  return {
    async fetch(url: string, _opts?: FetchOptions): Promise<FetchResult> {
      const body = bodies[url];
      if (body === undefined) {
        return {
          finalUrl: url, httpStatus: 404, contentType: null, contentHash: "",
          bodyBytes: 0, body: new Uint8Array(), fetchedAt: "2026-01-01T00:00:00Z", redirectCount: 0,
        };
      }
      const bytes = new TextEncoder().encode(body);
      return {
        finalUrl: url,
        httpStatus: 200,
        contentType: "text/html; charset=utf-8",
        contentHash: createHash("sha256").update(body).digest("hex"),
        bodyBytes: bytes.byteLength,
        body: bytes,
        fetchedAt: "2026-01-01T00:00:00Z",
        redirectCount: 0,
      };
    },
  };
}

function jsonFetcher(routes: Record<string, string>) {
  return {
    async fetch(url: string): Promise<FetchResult> {
      const body = routes[url];
      if (body === undefined) {
        return {
          finalUrl: url, httpStatus: 404, contentType: null, contentHash: "",
          bodyBytes: 0, body: new Uint8Array(), fetchedAt: "2026-01-01T00:00:00Z", redirectCount: 0,
        };
      }
      const bytes = new TextEncoder().encode(body);
      return {
        finalUrl: url,
        httpStatus: 200,
        contentType: "application/json; charset=utf-8",
        contentHash: createHash("sha256").update(body).digest("hex"),
        bodyBytes: bytes.byteLength,
        body: bytes,
        fetchedAt: "2026-01-01T00:00:00Z",
        redirectCount: 0,
      };
    },
  };
}

function discoverOne(url: string) {
  return {
    async discover(source: IngestionSourceSpec): Promise<DiscoveredTarget[]> {
      return [{
        capability: "PEOPLE" as DiscoveredTarget["capability"],
        url,
        method: "KNOWN",
        parentUrl: url,
        sourceId: source.id,
        institutionId: source.institutionId,
        discoveredAt: "2026-01-01T00:00:00Z",
        title: "fixture people page",
        status: "CANDIDATE" as const,
      }];
    },
  };
}

async function runHtmlSource(dbPath: string, src: IngestionSourceSpec, url: string, body: string, now: string) {
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: htmlFetcher({ [url]: body }),
    discovery: discoverOne(url),
    extractor: peopleExtractor,
    writer: new LocalSqliteEvidenceWriter(dbPath),
    validators: peopleValidators,
  });
  return engine.runSource(src.id, { now });
}

// ============================================================================
async function main(): Promise<void> {
  // ---------------------------------------------------------------- A
  console.log("M3.3 A — normal HTML people page");
  {
    const dbPath = scratchDb();
    const url = "https://fixture.test/team";
    const src = seedSource(dbPath, "m33-a", { capabilities: [{ capability: "PEOPLE", known_url: url }] }, url, "fixture.test");
    const out = await runHtmlSource(dbPath, src, url, NORMAL_HTML, "2026-01-01T00:00:00Z");
    check("A run ok", out.ok === true);
    const rows = qa(dbPath, "SELECT field_name, value, confidence, verification_status FROM data_assertions ORDER BY value");
    check("A 2 people assertions", rows.length === 2);
    check("A CEO mapped from list role", rows.some((r) => r.field_name === "people_ceo" && r.value === "Bimala Rai Paudel"));
    check("A second name mapped to block-level role", rows.some((r) => r.field_name === "people_board" && r.value === "Kiran Thapa Magar"));
    check("A all UNVERIFIED with confidence >= 0.5", rows.every((r) => r.verification_status === "UNVERIFIED" && Number(r.confidence) >= 0.5));
    check("A contact section produced no people", !rows.some((r) => String(r.value).includes("info@fixture.test")));

    // Same person listed twice on one page → one claim, not two rows.
    const dupes = pickPeopleFromBlock(
      `<h3>Our Team</h3><ul><li>Anita Gurung — CEO</li><li>Anita Gurung</li><li>Anita  Gurung, CEO</li></ul>`,
      peopleRoleFamily("Our Team"),
    );
    check("A duplicate names on one page collapse to one claim", dupes.length === 1 && dupes[0].name === "Anita Gurung" && dupes[0].role === "PEOPLE_CEO");
  }

  // ---------------------------------------------------------------- B
  console.log("M3.3 B — HTML table board page");
  {
    const dbPath = scratchDb();
    const url = "https://fixture.test/board";
    const src = seedSource(dbPath, "m33-b", { capabilities: [{ capability: "PEOPLE", known_url: url }] }, url, "fixture.test");
    const out = await runHtmlSource(dbPath, src, url, TABLE_HTML, "2026-01-01T00:00:00Z");
    check("B run ok", out.ok === true);
    const rows = qa(dbPath, "SELECT field_name, value FROM data_assertions ORDER BY value");
    check("B chair from designation cell", rows.some((r) => r.field_name === "people_chair" && r.value === "Mr. Ram Bahadur Thapa"));
    check("B director from designation cell", rows.some((r) => r.field_name === "people_director" && r.value === "Ms. Sita Devi Sharma"));
    check("B header row never asserted", !rows.some((r) => String(r.value) === "Name" || String(r.value) === "Designation"));
  }

  // ---------------------------------------------------------------- C
  console.log("M3.3 C — HTML card / profile page");
  {
    const dbPath = scratchDb();
    const url = "https://fixture.test/leadership";
    const src = seedSource(dbPath, "m33-c", { capabilities: [{ capability: "PEOPLE", known_url: url }] }, url, "fixture.test");
    const out = await runHtmlSource(dbPath, src, url, CARD_HTML, "2026-01-01T00:00:00Z");
    check("C run ok", out.ok === true);
    const rows = qa(dbPath, "SELECT field_name, value, confidence FROM data_assertions ORDER BY value");
    check("C exactly 3 people (one per card)", rows.length === 3);
    check("C card 1 → chair from card designation", rows.some((r) => r.field_name === "people_chair" && r.value === "Gopal Krishna Shrestha"));
    check("C card 2 → CEO", rows.some((r) => r.field_name === "people_ceo" && r.value === "Anita Gurung"));
    check("C card 3 → director", rows.some((r) => r.field_name === "people_director" && r.value === "Deepak Bahadur Shrestha"));
    check("C card confidence 0.55 (structured, asserted)", rows.every((r) => Number(r.confidence) === 0.55));
    check("C image alt/urls never become people", !rows.some((r) => String(r.value).includes("gopal.jpg")));
  }

  // ---------------------------------------------------------------- D
  console.log("M3.3 D — JSON / Data-API leadership route");
  {
    const dbPath = scratchDb();
    const base = "https://api.fixture.test";
    const url = `${base}/leadership`;
    const cfg = { data_api: { baseUrl: base, hosts: ["api.fixture.test"], routes: [{ capability: "PEOPLE", path: "/leadership" }] } };
    const src = seedSource(dbPath, "m33-d", cfg, "https://fixture.test/", "fixture.test");
    const config = parseDataApiConfig(cfg)!;
    const out = await runDataApiPass({
      source: src,
      config,
      deps: {
        registry: new LocalSourceRegistry(dbPath),
        fetcher: jsonFetcher({ [url]: JSON.stringify(PEOPLE_JSON) }),
        writer: new LocalSqliteEvidenceWriter(dbPath),
      },
      now: "2026-01-01T00:00:00Z",
    });
    check("D pass ok (no errors)", out.errors.length === 0 && out.processed === 1);
    const rows = qa(dbPath, "SELECT field_name, value, confidence, verification_status, entity_type, entity_id FROM data_assertions ORDER BY value");
    check("D 4 people assertions from JSON", rows.length === 4);
    check("D role-keyed containers map to role families", rows.some((r) => r.field_name === "people_chair" && r.value === "Ramesh Gurung") && rows.some((r) => r.field_name === "people_ceo" && r.value === "Prakash Adhikari"));
    check("D nested board array members → director", rows.filter((r) => r.field_name === "people_director").length === 2);
    check("D all UNVERIFIED, confidence 0.6", rows.every((r) => r.verification_status === "UNVERIFIED" && Number(r.confidence) === 0.6));
    check("D institution-scoped assertions", rows.every((r) => r.entity_type === "institution" && r.entity_id === INSTITUTION_ID));
    const snap = q(dbPath, "SELECT parser_version, extraction_status FROM source_snapshots");
    check("D snapshot recorded EXTRACTED", snap?.extraction_status === "EXTRACTED");
    const runRow = q(dbPath, "SELECT status, parser_version FROM ingestion_runs WHERE ingestion_source_id = 'm33-d' ORDER BY started_at DESC LIMIT 1");
    check("D run recorded SUCCESS with data-api parser", runRow?.status === "SUCCESS" && runRow?.parser_version === DATA_API_PARSER_ID);
  }

  // unit-level: the same JSON extractor, roles + dedupe
  {
    const ev = extractPeopleJson(PEOPLE_JSON, "https://api.fixture.test/leadership", "2026-01-01T00:00:00Z");
    check("D unit: 4 people evidence rows", ev.length === 4);
    check("D unit: parserId people-json-v1", ev.every((e) => e.parserId === PEOPLE_JSON_PARSER_ID));
    check("D unit: role-keyed container confidence 0.6", ev.every((e) => e.confidence === 0.6));
    const flat = extractPeopleJson([{ name: "Kiran Thapa Magar" }], "https://api.fixture.test/p", "2026-01-01T00:00:00Z");
    check("D unit: flat array without role defaults to board (0.55)", flat.length === 1 && flat[0].field === "PEOPLE_BOARD" && flat[0].confidence === 0.55);
  }

  // ---------------------------------------------------------------- E
  console.log("M3.3 E — provenance linkage");
  {
    const dbPath = scratchDb();
    const url = "https://fixture.test/leadership";
    const src = seedSource(dbPath, "m33-e", { capabilities: [{ capability: "PEOPLE", known_url: url }] }, url, "fixture.test");
    await runHtmlSource(dbPath, src, url, CARD_HTML, "2026-01-01T00:00:00Z");
    const rows = qa(
      dbPath,
      `SELECT a.field_name, a.value, a.source_id, a.source_snapshot_id, a.observed_at,
              ss.content_hash, ss.mime_type, s.source_grade AS grade
         FROM data_assertions a
         JOIN source_snapshots ss ON ss.id = a.source_snapshot_id
         JOIN sources s ON s.id = a.source_id`,
    );
    check("E every assertion links a snapshot", rows.length === 3 && rows.every((r) => String(r.source_snapshot_id ?? "").length > 0));
    check("E every assertion links the source", rows.every((r) => r.source_id === "m33-e"));
    check("E snapshot carries the fetched content hash", rows.every((r) => String(r.content_hash).length === 64 && String(r.mime_type).includes("text/html")));
    check("E source grade A (official site)", rows.every((r) => r.grade === "A"));
    check("E observed_at from run clock", rows.every((r) => r.observed_at === "2026-01-01T00:00:00Z"));
    const snap = q(dbPath, "SELECT parser_version FROM source_snapshots");
    check("E snapshot records the people parser", snap?.parser_version === PEOPLE_PARSER_ID);
  }

  // ---------------------------------------------------------------- F
  console.log("M3.3 F — idempotency + history preservation");
  {
    const dbPath = scratchDb();
    const url = "https://fixture.test/leadership";
    const src = seedSource(dbPath, "m33-f", { capabilities: [{ capability: "PEOPLE", known_url: url }] }, url, "fixture.test");
    await runHtmlSource(dbPath, src, url, CARD_HTML, "2026-01-01T00:00:00Z");
    const firstAsserts = (q(dbPath, "SELECT COUNT(*) c FROM data_assertions") as { c: number }).c;
    const firstSnaps = (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots") as { c: number }).c;
    await runHtmlSource(dbPath, src, url, CARD_HTML, "2026-01-02T00:00:00Z");
    const secondAsserts = (q(dbPath, "SELECT COUNT(*) c FROM data_assertions") as { c: number }).c;
    const secondSnaps = (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots") as { c: number }).c;
    const unchangedItems = (q(dbPath, "SELECT COUNT(*) c FROM ingestion_items WHERE status = 'UNCHANGED'") as { c: number }).c;
    check("F identical body → no new assertion", secondAsserts === firstAsserts);
    check("F identical body → no new snapshot", secondSnaps === firstSnaps);
    check("F identical body → item marked UNCHANGED", unchangedItems === 1);

    // changed content: the page now says "Acting Chairman" for the same person
    await runHtmlSource(dbPath, src, url, CARD_HTML_CHANGED, "2026-01-05T00:00:00Z");
    const afterChange = qa(dbPath, "SELECT field_name, value, source_snapshot_id, observed_at FROM data_assertions ORDER BY value, field_name");
    const thirdSnaps = (q(dbPath, "SELECT COUNT(*) c FROM source_snapshots") as { c: number }).c;
    check("F changed body → new snapshot kept alongside the old", thirdSnaps === firstSnaps + 1);
    check("F changed body → historical assertion preserved", afterChange.some((r) => r.value === "Gopal Krishna Shrestha" && r.field_name === "people_chair"));
    const chairHistory = qa(dbPath, "SELECT DISTINCT source_snapshot_id FROM data_assertions WHERE value = 'Gopal Krishna Shrestha'");
    check("F changed body → two evidence snapshots for the same person", chairHistory.length === 2);
  }

  // ---------------------------------------------------------------- G
  console.log("M3.3 G — review lifecycle (UNVERIFIED → HUMAN_VERIFIED / REJECTED)");
  {
    const dbPath = scratchDb();
    const url = "https://fixture.test/leadership";
    const src = seedSource(dbPath, "m33-g", { capabilities: [{ capability: "PEOPLE", known_url: url }] }, url, "fixture.test");
    await runHtmlSource(dbPath, src, url, CARD_HTML, "2026-01-01T00:00:00Z");
    const target = q(dbPath, "SELECT id, field_name, value FROM data_assertions WHERE value = 'Anita Gurung'") as Record<string, string>;
    const res = reviewAssertion(dbPath, { assertionId: String(target.id), verdict: "HUMAN_VERIFIED", reviewer: "ops@laghubitta", now: "2026-01-06T00:00:00Z" });
    check("G verdict recorded", res.newStatus === "HUMAN_VERIFIED" && res.previousStatus === "UNVERIFIED" && res.changedRows === 1);
    const verified = q(dbPath, `SELECT verification_status, source_id, source_snapshot_id, value FROM data_assertions WHERE value = 'Anita Gurung'`);
    check("G assertion row now HUMAN_VERIFIED", verified?.verification_status === "HUMAN_VERIFIED");
    check("G review never rewrote the evidence", verified?.value === "Anita Gurung" && String(verified?.source_snapshot_id ?? "").length > 0 && String(verified?.source_id) === "m33-g");
    const audit = q(dbPath, "SELECT action, before_json, after_json FROM audit_logs WHERE action = 'PEOPLE_ASSERTION_REVIEWED'");
    check("G review is audit-logged with before/after", audit?.action === "PEOPLE_ASSERTION_REVIEWED" && String(audit.before_json).includes("UNVERIFIED") && String(audit.after_json).includes("HUMAN_VERIFIED"));

    const rejectTarget = q(dbPath, "SELECT id FROM data_assertions WHERE value = 'Deepak Bahadur Shrestha'") as Record<string, string>;
    const rej = reviewAssertion(dbPath, { assertionId: String(rejectTarget.id), verdict: "REJECTED", reviewer: "ops@laghubitta", now: "2026-01-06T00:00:00Z" });
    check("G rejection recorded", rej.newStatus === "REJECTED");
    const rows = qa(dbPath, "SELECT value, verification_status FROM data_assertions ORDER BY value");
    check("G rejected row kept (evidence never deleted)", rows.length === 3 && rows.some((r) => r.value === "Deepak Bahadur Shrestha" && r.verification_status === "REJECTED"));
  }

  // ---------------------------------------------------------------- H
  console.log("M3.3 H — conflict detection (two sources disagree)");
  {
    const dbPath = scratchDb();
    const urlA = "https://fixture.test/leadership";
    const srcA = seedSource(dbPath, "m33-h-a", { capabilities: [{ capability: "PEOPLE", known_url: urlA }] }, urlA, "fixture.test");
    await runHtmlSource(dbPath, srcA, urlA, CARD_HTML, "2026-01-01T00:00:00Z");
    const urlB = "https://api.fixture.test/leadership";
    const cfgB = { data_api: { baseUrl: "https://api.fixture.test", hosts: ["api.fixture.test"], routes: [{ capability: "PEOPLE", path: "/leadership" }] } };
    const srcB = seedSource(dbPath, "m33-h-b", cfgB, "https://fixture.test/api", "fixture.test");
    await runDataApiPass({
      source: srcB,
      config: parseDataApiConfig(cfgB)!,
      deps: {
        registry: new LocalSourceRegistry(dbPath),
        fetcher: jsonFetcher({ [urlB]: JSON.stringify({ data: { chairman: { name: "Gopal Krishna Shrestha", designation: "Chairman" }, ceo: { name: "Anita Gurung", designation: "Chief Executive Officer" }, board: [{ name: "Dipesh Karki", designation: "Director" }] } }) }),
        writer: new LocalSqliteEvidenceWriter(dbPath),
      },
      now: "2026-02-01T00:00:00Z",
    });

    // Single-value people (same name, same role) → no conflict.
    const before = flagPeopleConflicts(dbPath, { now: "2026-02-02T00:00:00Z" });
    const opens = listOpenConflicts(dbPath);
    check("H same value from 2 sources → no conflict", before === 0 && opens.length === 0);
    check("H idempotent detector on clean data", flagPeopleConflicts(dbPath, { now: "2026-02-02T00:00:00Z" }) === 0);

    // A second source that names a DIFFERENT chairman → one OPEN conflict.
    const urlC = "https://mirror.fixture.test/board";
    const srcC = seedSource(dbPath, "m33-h-c", { capabilities: [{ capability: "PEOPLE", known_url: urlC }] }, urlC, "mirror.fixture.test");
    await runHtmlSource(dbPath, srcC, urlC, `<html><body><h3>Board of Directors</h3><table><tr><td>Keshav Raj Paudel</td><td>Chairman</td></tr></table></body></html>`, "2026-02-03T00:00:00Z");
    const created = flagPeopleConflicts(dbPath, { now: "2026-02-04T00:00:00Z" });
    const queue = listOpenConflicts(dbPath);
    check("H disagreeing values → exactly one OPEN conflict", created === 1 && queue.length === 1);
    check("H conflict carries both values + both sources", queue[0].valueA === "Gopal Krishna Shrestha" && queue[0].valueB === "Keshav Raj Paudel" && queue[0].sourceAId === "m33-h-a" && queue[0].sourceBId === "m33-h-c");
    check("H conflict names the role field", queue[0].fieldName === "people_chair" && queue[0].institutionId === INSTITUTION_ID);
    check("H detector is idempotent (re-run creates nothing)", flagPeopleConflicts(dbPath, { now: "2026-02-05T00:00:00Z" }) === 0);
    const audit = q(dbPath, "SELECT COUNT(*) c FROM audit_logs WHERE action = 'PEOPLE_CONFLICT_DETECTED'");
    check("H conflict detection audit-logged", Number(audit?.c) === 1);

    // The conflicted person is surfaced as CONFLICT in the read model.
    const repo = localRepository(dbPath);
    const leadership = await repo.listLeadership(INSTITUTION_ID);
    const conflicted = leadership.data.filter((p) => p.meta.verification_status === "CONFLICT");
    check("H conflicted person surfaces as CONFLICT", conflicted.length === 2 && conflicted.every((p) => p.name !== "Anita Gurung"));
    check("H clean person still UNVERIFIED", leadership.data.some((p) => p.name === "Anita Gurung" && p.meta.verification_status === "UNVERIFIED"));

    const resolved = resolveConflict(dbPath, { conflictId: queue[0].id, status: "RESOLVED", resolvedBy: "ops@laghubitta", note: "official site is authoritative", now: "2026-02-06T00:00:00Z" });
    check("H conflict resolved by a human", resolved.changedRows === 1 && listOpenConflicts(dbPath).length === 0);
    const afterResolve = await repo.listLeadership(INSTITUTION_ID);
    check("H no CONFLICT status after resolution", afterResolve.data.every((p) => p.meta.verification_status !== "CONFLICT"));
    const revived = flagPeopleConflicts(dbPath, { now: "2026-02-04T00:00:00Z" });
    const decided = qa(dbPath, "SELECT resolution_status FROM data_conflicts WHERE value_a = 'Gopal Krishna Shrestha'");
    check("H resolved pair is never resurrected by a re-run", revived === 0 && decided.length === 1 && decided[0].resolution_status === "RESOLVED");
    const row = qa(dbPath, "SELECT resolution_status, resolved_by, resolution_note FROM data_conflicts WHERE value_a = 'Gopal Krishna Shrestha'");
    check("H resolution decision persisted (rows never deleted)", row.length === 1 && row[0].resolution_status === "RESOLVED" && row[0].resolved_by === "ops@laghubitta");

    // Second disagreement mode: the same person with a different ROLE, from a
    // different source (source B called Anita the CEO, source D calls her a
    // director) → one OPEN conflict naming both role families.
    const urlD = "https://mirror.fixture.test/directors";
    const srcD = seedSource(dbPath, "m33-h-d", { capabilities: [{ capability: "PEOPLE", known_url: urlD }] }, urlD, "mirror.fixture.test");
    await runHtmlSource(dbPath, srcD, urlD, `<html><body><h3>Directors</h3><table><tr><td>Anita Gurung</td><td>Director</td></tr></table></body></html>`, "2026-02-07T00:00:00Z");
    const createdRole = flagPeopleConflicts(dbPath, { now: "2026-02-08T00:00:00Z" });
    const roleQueue = listOpenConflicts(dbPath);
    check("H rule 2: same person + different role + 2 sources → 1 conflict", createdRole === 1 && roleQueue.length === 1);
    check("H rule 2 names both role families and both sources", roleQueue[0].fieldName === "people_ceo|people_director" && roleQueue[0].valueA === "Anita Gurung" && roleQueue[0].valueB === "Anita Gurung" && roleQueue[0].sourceAId === "m33-h-a" && roleQueue[0].sourceBId === "m33-h-d", `got ${JSON.stringify(roleQueue[0])}`);
    const conflictedAfter = await localRepository(dbPath).listLeadership(INSTITUTION_ID);
    check("H rule 2 surfaces the person as CONFLICT", conflictedAfter.data.some((p) => p.name === "Anita Gurung" && p.meta.verification_status === "CONFLICT"));

    // Same person with two roles across two pages of the SAME source is a page
    // artifact of that site, not a cross-source disagreement.
    const urlE = "https://fixture.test/directors";
    const srcE = seedSource(dbPath, "m33-h-e", { capabilities: [{ capability: "PEOPLE", known_url: urlE }] }, urlE, "fixture.test");
    await runHtmlSource(dbPath, srcE, urlE, `<html><body><h3>Board of Directors</h3><table><tr><td>Bimala Rai Paudel</td><td>Director</td></tr></table></body></html>`, "2026-02-09T00:00:00Z");
    const urlE2 = "https://fixture.test/committee";
    const srcE2 = { ...srcE, knownUrl: urlE2 };
    await runHtmlSource(dbPath, srcE2, urlE2, `<html><body><h3>Committee</h3><table><tr><td>Bimala Rai Paudel</td><td>Board Member</td></tr></table></body></html>`, "2026-02-10T00:00:00Z");
    const beforeSame = listOpenConflicts(dbPath).length;
    const createdSame = flagPeopleConflicts(dbPath, { now: "2026-02-11T00:00:00Z" });
    check("H same-source double role is not a conflict", createdSame === 0 && listOpenConflicts(dbPath).length === beforeSame);
  }

  // ---------------------------------------------------------------- I
  console.log("M3.3 I — API read model over the same evidence");
  {
    const dbPath = scratchDb();
    const url = "https://fixture.test/leadership";
    const src = seedSource(dbPath, "m33-i", { capabilities: [{ capability: "PEOPLE", known_url: url }] }, url, "fixture.test");
    await runHtmlSource(dbPath, src, url, CARD_HTML, "2026-01-01T00:00:00Z");
    const repo = localRepository(dbPath);
    const paged = await repo.listLeadership(INSTITUTION_ID);
    check("I listLeadership returns all 3 people", paged.pagination.total === 3 && paged.data.length === 3);
    const chair = paged.data.find((p) => p.name === "Gopal Krishna Shrestha")!;
    check("I person slug is deterministic", chair.slug === "fixture-laghubitta-samuhik-gopal-krishna-shrestha");
    check("I person id is deterministic", chair.id === `person-${INSTITUTION_ID}-fixture-laghubitta-samuhik-gopal-krishna-shrestha`);
    check("I position title mapped from role family", chair.positions.length === 1 && chair.positions[0].title === "Chairperson");
    check("I position carries observed-since + current", chair.positions[0].is_current === true && chair.positions[0].since === "2026-01-01T00:00:00Z");
    check("I meta carries source + last observation", chair.meta.source === "m33-i" && chair.meta.last_verified_at === "2026-01-01T00:00:00Z");
    check("I meta honest UNVERIFIED", chair.meta.verification_status === "UNVERIFIED");
    check("I institution slug exposed for routing", chair.institution_slug === INSTITUTION_SLUG);

    const fetched = await repo.getPersonBySlug(chair.slug);
    check("I getPersonBySlug resolves the same person", fetched?.id === chair.id);
    const missing = await repo.getPersonBySlug("no-such-person");
    check("I getPersonBySlug unknown → null", missing === null);

    const groups = await repo.search("Gopal");
    check("I search finds the person by name", groups.people.length === 1 && groups.people[0].id === chair.id);
    const groupsCase = await repo.search("gopal krishna");
    check("I search is case-insensitive substring", groupsCase.people.length === 1);
    const groupsMiss = await repo.search("zzz-no-person");
    check("I search miss → empty people group", groupsMiss.people.length === 0);

    // multi-role person collapses into one person with two positions
    const multiUrl = "https://fixture.test/board2";
    const multi = seedSource(dbPath, "m33-i-2", { capabilities: [{ capability: "PEOPLE", known_url: multiUrl }] }, multiUrl, "fixture.test");
    await runHtmlSource(dbPath, multi, multiUrl, TABLE_HTML, "2026-01-02T00:00:00Z");
    const after = await repo.listLeadership(INSTITUTION_ID);
    const sita = after.data.find((p) => p.name === "Ms. Sita Devi Sharma")!;
    check("I roles from different sources merge into one person", after.pagination.total === 5 && sita.positions.length === 1);
    const ram = after.data.find((p) => p.name === "Mr. Ram Bahadur Thapa")!;
    check("I positions ordered deterministically", ram.positions[0].title === "Chairperson");

    // review decision flows into the read model
    const gopalAssert = q(dbPath, "SELECT id FROM data_assertions WHERE value = 'Gopal Krishna Shrestha'") as Record<string, string>;
    reviewAssertion(dbPath, { assertionId: String(gopalAssert.id), verdict: "HUMAN_VERIFIED", reviewer: "ops@laghubitta", now: "2026-01-07T00:00:00Z" });
    const verifiedPerson = (await repo.listLeadership(INSTITUTION_ID)).data.find((p) => p.name === "Gopal Krishna Shrestha")!;
    check("I HUMAN_VERIFIED surfaces on the DTO", verifiedPerson.meta.verification_status === "HUMAN_VERIFIED");

    // rejected claim disappears from the read model (but stays in the ledger)
    const rejectAssert = q(dbPath, "SELECT id FROM data_assertions WHERE value = 'Anita Gurung'") as Record<string, string>;
    reviewAssertion(dbPath, { assertionId: String(rejectAssert.id), verdict: "REJECTED", reviewer: "ops@laghubitta", now: "2026-01-07T00:00:00Z" });
    const afterReject = await repo.listLeadership(INSTITUTION_ID);
    check("I REJECTED person leaves the read model", afterReject.pagination.total === 4 && afterReject.data.every((p) => p.name !== "Anita Gurung"));
    check("I rejected claim still in the evidence ledger", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions WHERE value = 'Anita Gurung'") as { c: number }).c === 1);

    // pure projection is usable directly (the static API path uses it)
    const raw = qa(
      dbPath,
      `SELECT i.id AS institution_id, i.slug AS institution_slug, i.name_en AS institution_name,
              a.field_name, a.value, a.source_id, a.observed_at, a.verification_status, a.confidence
         FROM data_assertions a JOIN institutions i ON i.id = a.entity_id
        WHERE a.entity_type = 'institution' AND a.field_name LIKE 'people_%'`,
    ) as unknown as PersonAssertionRecord[];
    const projected = peopleFromAssertionRows(raw);
    check("I pure projection matches repository total", projected.length === afterReject.pagination.total);
    check("I projection sorted deterministically", projected.every((p, i) => i === 0 || projected[i - 1].institution_slug <= p.institution_slug));
  }

  // ---------------------------------------------------------------- J
  console.log("M3.3 J — malformed input");
  {
    const dbPath = scratchDb();
    const url = "https://fixture.test/junk";
    const src = seedSource(dbPath, "m33-j", { capabilities: [{ capability: "PEOPLE", known_url: url }] }, url, "fixture.test");
    const junkHtml = `<html><body><h2>Leadership</h2>
      <div class="profile-card"><h4>info@fixture.test</h4><span>+977-1-5551234</span></div>
      <div class="profile-card"><h4>www.fixture.test</h4><span>Kathmandu</span></div>
      <div class="profile-card"><h4>+977-98-11223344</h4><span>Chairman</span></div>
    </body></html>`;
    const out = await runHtmlSource(dbPath, src, url, junkHtml, "2026-01-01T00:00:00Z");
    check("J junk cards → run ok, no crash", out.ok === true);
    check("J junk cards → zero people assertions", (q(dbPath, "SELECT COUNT(*) c FROM data_assertions") as { c: number }).c === 0);
    const ev = extractPeopleJson(PEOPLE_JSON_JUNK, "https://api.fixture.test/x", "2026-01-01T00:00:00Z");
    check("J junk JSON → zero people evidence", ev.length === 0);
    const badJson = qa(dbPath, "SELECT COUNT(*) c FROM data_assertions");
    check("J junk JSON never persisted", Number(badJson[0].c) === 0);
    const nulls = extractPeopleJson({ data: null, board: [null, 42, { name: "" }, { name: "Kiran Thapa Magar" }] }, "https://api.fixture.test/y", "2026-01-01T00:00:00Z");
    check("J null/primitive/empty entries skipped", nulls.length === 1 && nulls[0].text === "Kiran Thapa Magar");
    const empty = extractPeopleJson(null, "https://api.fixture.test/z", "2026-01-01T00:00:00Z");
    check("J null payload → no crash, no evidence", empty.length === 0);
  }

  console.log(`\nM3.3 people results: ${pass} ok / ${fail} fail`);
  if (fail > 0) process.exit(1);
  console.log("ALL M3.3 PEOPLE FIXTURES PASSED (deterministic, UNVERIFIED by default, no AI/OCR/browser).");
}

main().catch((e) => {
  console.error("M3.3 people fixture run crashed:", e);
  process.exit(1);
});
