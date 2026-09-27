// ============================================================================
// M3.3-EXT-C2 — deterministic fixtures for SEMANTIC assertion idempotency.
// No network, no AI/OCR/browser, no schema change, no institution-specific code.
//
// A semantic claim is (entity, field, value). A source snapshot is evidence, not
// part of the claim's identity. So:
//
//   A  same HTML twice                     -> 1 snapshot, 1 assertion
//   B  HTML changes only in irrelevant
//      markup (whitespace/attributes)      -> canonical UNCHANGED, no new
//                                             snapshot and no new assertion
//   C  HTML changes materially, the person
//      does not                            -> 2 snapshots, 1 assertion, and no
//                                             duplicate (entity, field, value)
//   D  the person changes                  -> old claim AND new claim both
//                                             retained, change detectable
//   E  the role changes                    -> old field AND new field retained
//   F  two independent sources report the
//      same person/value                   -> one semantic assertion, and both
//                                             sources' provenance still readable
//
// History is never deleted: every snapshot row written in A-F is asserted to
// still exist at the end of the run.
// ============================================================================

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  LocalSqliteEvidenceWriter,
  LocalSourceRegistry,
  buildEngine,
  peopleExtractor,
  deterministicHtmlCanonicalizer,
} from "../lib/ingestion";
import type { DiscoveredTarget, FetchResult, IngestionSourceSpec } from "../lib/ingestion";

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

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}
function qa(dbPath: string, sql: string, ...params: unknown[]): Array<Record<string, unknown>> {
  const db = new Database(dbPath);
  const r = db.prepare(sql).all(...params);
  db.close();
  return r;
}
function scalar(dbPath: string, sql: string): number {
  const db = new Database(dbPath);
  const r = db.prepare(sql).get() as { c: number } | undefined;
  db.close();
  return r ? r.c : 0;
}

const INSTITUTION_ID = "inst-ext-c-fixture";
const URL_A = "https://fixture.test/board-of-directors";
const URL_B = "https://mirror.fixture.test/board-of-directors";
const NOW = "2026-01-01T00:00:00Z";

/** A three-person board page. `ticker` models volatile content. */
function boardPage(opts: { people: string[]; ticker?: string; classAttr?: string }): string {
  const rows = opts.people
    .map((p, i) => `<tr><td>${p}</td><td>${i === 0 ? "Chairman" : "Director"}</td></tr>`)
    .join("");
  return `<html><body>
    ${opts.ticker ? `<div class="ticker">${opts.ticker}</div>` : ""}
    <h2${opts.classAttr ? ` class="${opts.classAttr}"` : ""}>Board of Directors</h2>
    <table><tbody>${rows}</tbody></table>
  </body></html>`;
}

const PEOPLE_ABC = ["Satya Narayan Jha", "Binodanand Jha", "Sudhansu Shekhar Jha"];
const PEOPLE_AD = ["Satya Narayan Jha", "Binodanand Jha", "Anil Kumar Thapa"];

function freshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lk-ext-c-"));
  const path = join(dir, "ext-c.db");
  const db = new Database(path);
  db.exec(readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8"));
  db.prepare(
    `INSERT INTO institutions (id, slug, name_en, short_name, institution_type, status)
     VALUES (?, ?, 'Ext C Fixture Mfi', 'Ext C Mfi', 'PROVINCIAL', 'ACTIVE')`,
  ).run(INSTITUTION_ID, "ext-c-fixture-mfi");
  db.close();
  return path;
}

function seedSource(dbPath: string, id: string, url: string): IngestionSourceSpec {
  const src: IngestionSourceSpec = {
    id,
    url,
    domain: "fixture.test",
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
  ).run(id, url, "fixture.test", `fixture: ${id}`);
  db.prepare(
    `INSERT INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
     VALUES (?, ?, ?, 'MFB_WEBSITE', ?, ?, 1, 1440)`,
  ).run(id, url, "fixture.test", INSTITUTION_ID, JSON.stringify({ capabilities: [{ capability: "PEOPLE", known_url: url }] }));
  db.close();
  return src;
}

function htmlFetcher(getBody: (url: string) => string | undefined) {
  return {
    async fetch(url: string): Promise<FetchResult> {
      const body = getBody(url);
      if (body === undefined) {
        return {
          finalUrl: url, httpStatus: 404, contentType: null, contentHash: "",
          bodyBytes: 0, body: new Uint8Array(), fetchedAt: NOW, redirectCount: 0,
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
        fetchedAt: NOW,
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
        discoveredAt: NOW,
        title: "fixture people page",
        status: "CANDIDATE" as const,
      }];
    },
  };
}

async function runSource(dbPath: string, src: IngestionSourceSpec, url: string, body: () => string | undefined) {
  const engine = buildEngine({
    registry: new LocalSourceRegistry(dbPath),
    fetcher: htmlFetcher(body),
    discovery: discoverOne(url),
    extractor: peopleExtractor,
    writer: new LocalSqliteEvidenceWriter(dbPath),
    canonicalizer: deterministicHtmlCanonicalizer,
    validators: [],
  });
  return engine.runSource(src.id, { now: NOW });
}

const SNAPSHOTS = "SELECT COUNT(*) c FROM source_snapshots";
const ASSERTIONS = "SELECT COUNT(*) c FROM data_assertions WHERE field_name LIKE 'people%'";
const DUP_GROUPS = `SELECT COUNT(*) c FROM (
  SELECT entity_id, field_name, value FROM data_assertions
  WHERE field_name LIKE 'people%'
  GROUP BY entity_id, field_name, value HAVING COUNT(*) > 1)`;

async function main(): Promise<void> {
  console.log("EXT-C2 semantic assertion idempotency fixtures\n");

  // ---------------------------------------------------------------- A
  console.log("A. same HTML twice");
  const dbA = freshDb();
  const srcA = seedSource(dbA, "src-a", URL_A);
  let bodyA = boardPage({ people: PEOPLE_ABC });
  await runSource(dbA, srcA, URL_A, () => bodyA);
  const aSnap1 = scalar(dbA, SNAPSHOTS);
  const aAssert1 = scalar(dbA, ASSERTIONS);
  await runSource(dbA, srcA, URL_A, () => bodyA);
  check("A1 one snapshot after two identical runs", scalar(dbA, SNAPSHOTS) === 1, `${scalar(dbA, SNAPSHOTS)}`);
  check("A2 three assertions, not six", scalar(dbA, ASSERTIONS) === aAssert1 && aAssert1 === 3, `${scalar(dbA, ASSERTIONS)}`);
  check("A3 no duplicate semantic group", scalar(dbA, DUP_GROUPS) === 0);

  // ---------------------------------------------------------------- B
  console.log("\nB. irrelevant markup change only");
  // Same visible content: re-ordered/extra attributes, extra whitespace, a
  // comment, an empty element. The canonical form must be identical.
  bodyA = boardPage({ people: PEOPLE_ABC, classAttr: "title" })
    .replace("<h2", "  <h2   data-x='1'")
    .replace("</h2>", "</h2>  <!-- layout note -->")
    .replace("<body>", "<body>\n\n    ");
  const b = await runSource(dbA, srcA, URL_A, () => bodyA);
  check("B1 canonical comparison reports UNCHANGED", b.items.every((i) => i.lifecycle === "UNCHANGED"), JSON.stringify(b.items.map((i) => i.lifecycle)));
  check("B2 still one snapshot", scalar(dbA, SNAPSHOTS) === aSnap1, `${scalar(dbA, SNAPSHOTS)}`);
  check("B3 still three assertions", scalar(dbA, ASSERTIONS) === aAssert1, `${scalar(dbA, ASSERTIONS)}`);

  // ---------------------------------------------------------------- C
  console.log("\nC. page mutates, person does not");
  bodyA = boardPage({ people: PEOPLE_ABC, ticker: "Board meeting notice published" });
  const c = await runSource(dbA, srcA, URL_A, () => bodyA);
  check("C1 the new snapshot is EXTRACTED, not skipped", c.items.every((i) => i.lifecycle === "EXTRACTED"), JSON.stringify(c.items.map((i) => i.lifecycle)));
  check("C2 a second snapshot was stored", scalar(dbA, SNAPSHOTS) === 2, `${scalar(dbA, SNAPSHOTS)}`);
  check("C3 still three assertions", scalar(dbA, ASSERTIONS) === 3, `${scalar(dbA, ASSERTIONS)}`);
  check("C4 no duplicate (entity, field, value)", scalar(dbA, DUP_GROUPS) === 0);
  const reseen = qa(dbA, "SELECT COUNT(*) c FROM audit_logs WHERE action = 'ASSERTION_RESEEN'");
  check("C5 the re-sighting is recorded in the audit trail", reseen.length === 1 && Number(reseen[0].c) === 3, JSON.stringify(reseen));
  const oneClaim = qa(dbA, `SELECT id, source_snapshot_id, value FROM data_assertions WHERE value = 'Satya Narayan Jha'`);
  check("C6 the stored claim keeps its original evidence pointer", oneClaim.length === 1, JSON.stringify(oneClaim));
  check(
    "C7 the re-sighting names the NEW snapshot",
    String(JSON.parse((qa(dbA, "SELECT after_json FROM audit_logs WHERE action = 'ASSERTION_RESEEN' LIMIT 1")[0] as { after_json: string }).after_json)).length > 0,
  );
  check("C8 both snapshots remain auditable", scalar(dbA, SNAPSHOTS) === 2);

  // ---------------------------------------------------------------- D
  console.log("\nD. the person changes");
  bodyA = boardPage({ people: PEOPLE_AD, ticker: "Board meeting notice published" });
  await runSource(dbA, srcA, URL_A, () => bodyA);
  check("D1 a third snapshot is stored", scalar(dbA, SNAPSHOTS) === 3, `${scalar(dbA, SNAPSHOTS)}`);
  check("D2 the new person is asserted", scalar(dbA, ASSERTIONS) === 4, `${scalar(dbA, ASSERTIONS)}`);
  const goneValue = scalar(dbA, `SELECT COUNT(*) c FROM data_assertions WHERE value = 'Sudhansu Shekhar Jha'`);
  const newValue = scalar(dbA, `SELECT COUNT(*) c FROM data_assertions WHERE value = 'Anil Kumar Thapa'`);
  check("D3 the replaced person is NOT deleted", goneValue === 1, `${goneValue}`);
  check("D4 the new person is present", newValue === 1, `${newValue}`);
  // The person who did not change keeps its FIRST evidence pointer (a claim is
  // never re-pointed, only re-seen); the newly appeared person is anchored to
  // the snapshot that first carried it. Nothing already stored is rewritten.
  // source_snapshots has no created_at column, so insertion order is rowid.
  const newestId = qa(dbA, "SELECT id FROM source_snapshots ORDER BY rowid DESC LIMIT 1")[0];
  const oldestId = qa(dbA, "SELECT id FROM source_snapshots ORDER BY rowid ASC LIMIT 1")[0];
  const anchorOf = (v: string): string => String(qa(dbA, "SELECT source_snapshot_id FROM data_assertions WHERE value = ?", v)[0]?.source_snapshot_id);
  check("D5 retained claims keep their ORIGINAL evidence anchor", anchorOf("Satya Narayan Jha") === String(oldestId?.id), anchorOf("Satya Narayan Jha"));
  check("D6 the new claim is anchored to the snapshot that carried it", anchorOf("Anil Kumar Thapa") === String(newestId?.id), anchorOf("Anil Kumar Thapa"));

  // ---------------------------------------------------------------- E
  console.log("\nE. the role changes");
  const roleChanged = `<html><body>
    <h2>Board of Directors</h2>
    <table><tbody>
      <tr><td>Satya Narayan Jha</td><td>Chairman</td></tr>
      <tr><td>Binodanand Jha</td><td>Director</td></tr>
      <tr><td>Sudhansu Shekhar Jha</td><td>Director</td></tr>
    </tbody></table>
    <h2>Management Team</h2>
    <table><tbody><tr><td>Anil Kumar Thapa</td><td>Chief Executive Officer</td></tr></tbody></table>
  </body></html>`;
  bodyA = roleChanged;
  await runSource(dbA, srcA, URL_A, () => bodyA);
  const ceoField = qa(dbA, "SELECT field_name, value FROM data_assertions WHERE value = 'Anil Kumar Thapa' AND field_name = 'people_ceo'");
  check("E1 the new role is asserted under its own field", ceoField.length === 1, JSON.stringify(ceoField));
  check("E1b the same person under a different field is a SEPARATE claim", scalar(dbA, "SELECT COUNT(*) c FROM data_assertions WHERE value = 'Anil Kumar Thapa'") === 2);
  check("E2 the earlier claim is still retained", scalar(dbA, `SELECT COUNT(*) c FROM data_assertions WHERE value = 'Anil Kumar Thapa' AND field_name = 'people_director'`) === 1);
  check("E3 a same-person different-field pair is not merged away", scalar(dbA, DUP_GROUPS) === 0, `${scalar(dbA, DUP_GROUPS)}`);
  check("E4 no historical snapshot was dropped", scalar(dbA, SNAPSHOTS) >= 3, `${scalar(dbA, SNAPSHOTS)}`);

  // ---------------------------------------------------------------- F
  console.log("\nF. two independent sources report the same person");
  const dbF = freshDb();
  const srcF1 = seedSource(dbF, "src-f1", URL_A);
  const srcF2 = seedSource(dbF, "src-f2", URL_B);
  const same = boardPage({ people: ["Ram Bahadur Yadav", "Binodanand Jha"] });
  await runSource(dbF, srcF1, URL_A, () => same);
  await runSource(dbF, srcF2, URL_B, () => same);
  check("F1 one snapshot per source", scalar(dbF, SNAPSHOTS) === 2, `${scalar(dbF, SNAPSHOTS)}`);
  check("F2 one semantic assertion per person", scalar(dbF, ASSERTIONS) === 2, `${scalar(dbF, ASSERTIONS)}`);
  check("F3 no duplicate merely because the source differs", scalar(dbF, DUP_GROUPS) === 0);
  const aud = qa(dbF, "SELECT after_json FROM audit_logs WHERE action = 'ASSERTION_RESEEN' ORDER BY created_at, id");
  const sources = new Set(
    aud.map((r) => (JSON.parse(String(r.after_json)) as { source_id: string }).source_id),
  );
  check("F4 the second source's provenance is recorded", aud.length === 2 && sources.has("src-f2"), `${aud.length} entries ${[...sources].join(",")}`);
  const snapsPerSource = qa(dbF, "SELECT source_id, COUNT(*) c FROM source_snapshots GROUP BY source_id");
  check("F5 both snapshots remain auditable", snapsPerSource.length === 2 && snapsPerSource.every((s) => Number(s.c) === 1), JSON.stringify(snapsPerSource));

  // ---------------------------------------------------------------- integrity
  console.log("\nintegrity");
  check("I1 every assertion is UNVERIFIED", scalar(dbA, "SELECT COUNT(*) c FROM data_assertions WHERE verification_status <> 'UNVERIFIED'") === 0);
  check("I2 no orphan assertions (snapshot present)", scalar(dbA, `SELECT COUNT(*) c FROM data_assertions a
      WHERE a.source_snapshot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_snapshots s WHERE s.id = a.source_snapshot_id)`) === 0);
  check("I3 every snapshot has a hash, mime type and clock", scalar(dbA, `SELECT COUNT(*) c FROM source_snapshots
      WHERE content_hash IS NULL OR content_hash = '' OR mime_type IS NULL OR mime_type = '' OR fetched_at IS NULL`) === 0);

  console.log(`\nEXT-C2 semantic idempotency: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log(failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
