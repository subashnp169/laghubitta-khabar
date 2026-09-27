// ============================================================================
// M3.3-GENERIC-EXT-A â€” deterministic fixtures for the two generic People
// extraction gaps found by the real 51-source pilot. No network, no
// production D1, no AI/OCR/browser, no institution-specific code.
//
//   A  page-builder container roster: repeated structural container holding a
//      heading-style name + a sibling heading/span role  â†’ name + role read
//   B  leadership section followed (and preceded) by site navigation
//      â†’ real people kept, menu labels never become people
//   C  leadership list that legitimately contains people  â†’ preserved
//   D  navigation/footer containing institution names but no people â†’ 0 people
//   E  strictness: no role element / lone heading / role-only heading â†’ 0 people
//   F  provenance: snapshot + hash + MIME + clock + grade on every assertion,
//      0 orphans, deterministic person ids, idempotent repeat
// ============================================================================

import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  LocalSqliteEvidenceWriter,
  LocalSourceRegistry,
  buildEngine,
  peopleExtractor,
} from "../lib/ingestion";
import { pickPeopleFromBlock } from "../lib/ingestion/people";
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
const fs = require("node:fs") as typeof import("node:fs");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name, detail ?? ""); }
}
function qa(dbPath: string, sql: string): Array<Record<string, unknown>> {
  const db = new Database(dbPath);
  const r = db.prepare(sql).all();
  db.close();
  return r;
}
function names(picks: Array<{ name: string }>): string[] {
  return picks.map((p) => p.name);
}

const INSTITUTION_ID = "inst-ext-a-fixture";

// ---------------------------------------------------------------- fixtures

/** A. Page-builder roster: structural container > heading name + heading role. */
const BUILDER_ROSTER_HTML = `<html><body>
  <h2>Board of Directors</h2>
  <div class="e-con e-parent">
    <div class="e-con-full e-flex e-con e-child">
      <div class="elementor-widget elementor-widget-heading">
        <h4 class="elementor-heading-title elementor-size-default">Satya Narayan Jha</h4>
      </div>
      <div class="elementor-widget elementor-widget-heading">
        <span class="elementor-heading-title">Chairman</span>
      </div>
    </div>
    <div class="e-con-full e-flex e-con e-child">
      <div class="elementor-widget elementor-widget-heading">
        <h4 class="elementor-heading-title elementor-size-default">Sudhansu Shekhar Jha</h4>
      </div>
      <div class="elementor-widget elementor-widget-heading">
        <span class="elementor-heading-title">Director</span>
      </div>
    </div>
    <div class="e-con-full e-flex e-con e-child">
      <div class="elementor-widget elementor-widget-heading">
        <h4 class="elementor-heading-title elementor-size-default">Binodanand Jha</h4>
      </div>
      <div class="elementor-widget elementor-widget-heading">
        <span class="elementor-heading-title">Independent Director</span>
      </div>
    </div>
  </div>
</body></html>`;

/** B. Real pilot page order: site menu, then leadership, then footer. */
const MENU_THEN_LEADERSHIP_HTML = `<html><body>
  <nav id="site-navigation" class="nav-bar">
    <ul>
      <li><a href="/">Nepal Rastra Bank</a></li>
      <li><a href="/notice">Notices</a></li>
      <li><a href="/service">NRB Complaint</a></li>
    </ul>
  </nav>
  <h2>Board of Directors</h2>
  <div class="e-con e-parent">
    <div class="e-con e-child">
      <h4 class="elementor-heading-title">Jeetendra Jha</h4>
      <span class="elementor-heading-title">Chairman</span>
    </div>
    <div class="e-con e-child">
      <h4 class="elementor-heading-title">Dr Pramod Kumar Jha</h4>
      <span class="elementor-heading-title">Director</span>
    </div>
  </div>
  <footer class="site-footer">
    <ul>
      <li><a href="/about">About Swastik Laghubitta</a></li>
      <li><a href="/branch">Branch Network</a></li>
    </ul>
  </footer>
</body></html>`;

/** C. A leadership list that legitimately contains people (no nav involved). */
const LEADERSHIP_LIST_HTML = `<html><body>
  <h2>Our Team</h2>
  <ul>
    <li><strong>Bimala Rai Paudel</strong> - Chief Executive Officer</li>
    <li><strong>Kiran Thapa Magar</strong> - Head of Operations</li>
  </ul>
  <h2>Contact</h2>
  <p>info@fixture.test</p>
</body></html>`;

/** D. Institution names that live only in navigation/footer: never people. */
const NAV_ONLY_HTML = `<html><body>
  <h2>Board of Directors</h2>
  <p>Board information is published in our annual report.</p>
  <nav>
    <ul>
      <li><a href="/">Nepal Rastra Bank</a></li>
      <li><a href="/notice">Notices</a></li>
      <li><a href="/contact">Contact Us</a></li>
    </ul>
  </nav>
  <div role="navigation">
    <ul><li><a href="/faq">FAQ</a></li></ul>
  </div>
  <footer>
    <ul>
      <li><a href="/privacy">Privacy Policy</a></li>
      <li><a href="/terms">Terms and Conditions</a></li>
    </ul>
  </footer>
</body></html>`;

/** E1. A name heading with no role element anywhere near it. */
const NAME_WITHOUT_ROLE_HTML = `<html><body>
  <h2>Board of Directors</h2>
  <h4 class="elementor-heading-title">Alone Person Khadka</h4>
</body></html>`;

/** E2. A single container is not a roster: left to the other passes. */
const SINGLE_CONTAINER_HTML = `<html><body>
  <h2>Board of Directors</h2>
  <h4 class="elementor-heading-title">Only Person Khadka</h4>
  <span class="elementor-heading-title">Chairman</span>
</body></html>`;

/** E3. Role-only headings (a nav of section links) produce no people. */
const ROLE_HEADINGS_ONLY_HTML = `<html><body>
  <h2>Leadership</h2>
  <h4 class="elementor-heading-title">Chairman</h4>
  <h4 class="elementor-heading-title">Director</h4>
  <h4 class="elementor-heading-title">Chief Executive Officer</h4>
</body></html>`;

// ---------------------------------------------------------------- harness
function scratchDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lk-people-ext-"));
  const path = join(dir, "fixture.db");
  const schema = fs.readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(path);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  db.prepare(
    `INSERT INTO institutions (id, slug, name_en, short_name, institution_type, status)
     VALUES (?, ?, 'Ext A Fixture Mfi', 'Ext A Mfi', 'PROVINCIAL', 'ACTIVE')`,
  ).run(INSTITUTION_ID, "ext-a-fixture-mfi");
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

function htmlFetcher(bodies: Record<string, string>) {
  return {
    async fetch(url: string): Promise<FetchResult> {
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
    validators: [],
  });
  return engine.runSource(src.id, { now });
}

async function extractValues(html: string): Promise<string[]> {
  const out = await peopleExtractor.extract({
    body: new TextEncoder().encode(html),
    capability: "PEOPLE",
    sourceId: "fixture",
    institutionId: INSTITUTION_ID,
    url: "https://fixture.test/people",
  } as never);
  return (out as Array<{ text: string }>).map((e) => e.text);
}

// ============================================================================
async function main(): Promise<void> {
  // ---------------------------------------------------------------- A
  console.log("EXT-A â€” A. page-builder container roster");
  {
    const picks = pickPeopleFromBlock(BUILDER_ROSTER_HTML, null);
    check("A1 reads all three names", names(picks).length === 3, names(picks).join("|"));
    check("A1 name 1", picks.some((p) => p.name === "Satya Narayan Jha"), names(picks).join("|"));
    check("A1 name 2", picks.some((p) => p.name === "Sudhansu Shekhar Jha"), names(picks).join("|"));
    check("A1 name 3", picks.some((p) => p.name === "Binodanand Jha"), names(picks).join("|"));
    const chair = picks.find((p) => p.name === "Satya Narayan Jha");
    check("A2 role read from sibling element", chair?.role === "PEOPLE_CHAIR", String(chair?.role));
    const ind = picks.find((p) => p.name === "Binodanand Jha");
    check("A2 multi-word role read", ind?.role === "PEOPLE_DIRECTOR", String(ind?.role));
    check("A3 role is explicit (not inherited)", picks.every((p) => p.roleExplicit === true));
    check("A3 confidence ~0.55", picks.every((p) => Math.abs(p.confidence - 0.55) < 1e-9), String(picks[0]?.confidence));
  }

  // ---------------------------------------------------------------- B
  console.log("EXT-A â€” B. leadership section bounded by navigation");
  {
    const picks = pickPeopleFromBlock(MENU_THEN_LEADERSHIP_HTML, null);
    const got = names(picks);
    check("B1 real people still extracted", got.includes("Jeetendra Jha") && got.includes("Dr Pramod Kumar Jha"), got.join("|"));
    check("B1 roles read", picks.find((p) => p.name === "Jeetendra Jha")?.role === "PEOPLE_CHAIR");
    check("B2 nav label 'Nepal Rastra Bank' rejected", !got.includes("Nepal Rastra Bank"), got.join("|"));
    check("B2 nav label 'Notices' rejected", !got.includes("Notices"), got.join("|"));
    check("B2 nav label 'NRB Complaint' rejected", !got.includes("NRB Complaint"), got.join("|"));
    check("B3 footer label 'Branch Network' rejected", !got.includes("Branch Network"), got.join("|"));
    check("B3 footer label 'About Swastik Laghubitta' rejected", !got.includes("About Swastik Laghubitta"), got.join("|"));
    check("B4 exactly two people", got.length === 2, got.join("|"));
  }

  // ---------------------------------------------------------------- C
  console.log("EXT-A — C. legitimate leadership list preserved");
  {
    const picks = pickPeopleFromBlock(LEADERSHIP_LIST_HTML, "PEOPLE_CEO");
    const got = names(picks);
    check("C1 list person 1 kept", got.includes("Bimala Rai Paudel"), got.join("|"));
    check("C1 list person 2 kept", got.includes("Kiran Thapa Magar"), got.join("|"));
    check("C1 both keep a people_* role", picks.every((p) => p.role.startsWith("PEOPLE_")), JSON.stringify(picks.map((p) => `${p.name}=${p.role}`)));
    check("C2 explicit list role kept", picks.find((p) => p.name === "Bimala Rai Paudel")?.role === "PEOPLE_CEO", JSON.stringify(picks.map((p) => `${p.name}=${p.role}`)));
    // EXT-C1: a designation the page states but our vocabulary does not cover
    // keeps the person in the generic field. Borrowing the block's role would
    // publish "Kiran Thapa Magar is the CEO", a specific claim the page never
    // made, which is the error EXT-C1 exists to remove.
    const kiran = picks.find((p) => p.name === "Kiran Thapa Magar");
    check("C2 non-vocabulary role does NOT borrow the block role", kiran?.role === "PEOPLE_BOARD", JSON.stringify(picks.map((p) => `${p.name}=${p.role}`)));
    check("C2 the stated designation text is preserved", kiran?.roleText?.includes("Head of Operations") === true, String(kiran?.roleText));
  }

  // ---------------------------------------------------------------- D
  console.log("EXT-A â€” D. navigation-only institution names");
  {
    const picks = pickPeopleFromBlock(NAV_ONLY_HTML, "PEOPLE_DIRECTOR");
    check("D1 no people from nav/footer/role=navigation", picks.length === 0, names(picks).join("|"));
  }

  // ---------------------------------------------------------------- E
  console.log("EXT-A â€” E. strictness (no invented people)");
  {
    check("E1 name without role â†’ nothing", pickPeopleFromBlock(NAME_WITHOUT_ROLE_HTML, null).length === 0);
    check("E2 single container is not a roster", pickPeopleFromBlock(SINGLE_CONTAINER_HTML, null).length === 0);
    check("E3 role-only headings â†’ nothing", pickPeopleFromBlock(ROLE_HEADINGS_ONLY_HTML, null).length === 0);
  }

  // ---------------------------------------------------------------- F
  console.log("EXT-A â€” F. provenance, deterministic ids, idempotency");
  {
    const dbPath = scratchDb();
    const url = "https://fixture.test/board";
    const src = seedSource(dbPath, "ext-a-1", url);
    const first = await runHtmlSource(dbPath, src, url, BUILDER_ROSTER_HTML, "2026-02-01T00:00:00Z");
    check("F0 run ok", first.ok === true, JSON.stringify(first));

    const ids1 = qa(dbPath,
      "SELECT id, entity_type, entity_id, field_name, value, confidence, verification_status FROM data_assertions ORDER BY id");
    check("F1 three people asserted", ids1.length === 3, String(ids1.length));
    check("F1 all UNVERIFIED", ids1.every((r) => r.verification_status === "UNVERIFIED"), JSON.stringify(ids1.map((r) => r.verification_status)));
    check("F1 field family is people_*", ids1.every((r) => String(r.field_name).toLowerCase().startsWith("people_")), JSON.stringify(ids1.map((r) => r.field_name)));
    check("F1 linked to the institution entity with a name value", ids1.every((r) => String(r.entity_id) === INSTITUTION_ID && typeof r.value === "string" && r.value.length > 0), JSON.stringify(ids1.map((r) => r.entity_id)));
    check("F1 confidence 0.55", ids1.every((r) => Math.abs(Number(r.confidence) - 0.55) < 1e-9), JSON.stringify(ids1.map((r) => r.confidence)));
    check("F1 chair role stored", ids1.some((r) => r.field_name === "people_chair" && r.value === "Satya Narayan Jha"), JSON.stringify(ids1.map((r) => `${r.field_name}=${r.value}`)));
    check("F1 independent director stored", ids1.some((r) => r.field_name === "people_director" && r.value === "Binodanand Jha"), JSON.stringify(ids1.map((r) => `${r.field_name}=${r.value}`)));

    const snaps = qa(dbPath,
      "SELECT id, content_hash, mime_type, http_status, fetched_at, source_id, extraction_status FROM source_snapshots");
    check("F2 one snapshot", snaps.length === 1, String(snaps.length));
    check("F2 sha256 hash", String(snaps[0].content_hash).length === 64, String(snaps[0].content_hash));
    check("F2 MIME recorded", String(snaps[0].mime_type).includes("text/html"), String(snaps[0].mime_type));
    check("F2 fetch clock recorded", String(snaps[0].fetched_at).length > 0, String(snaps[0].fetched_at));
    check("F2 source linked", snaps[0].source_id === "ext-a-1", String(snaps[0].source_id));

    const linked = qa(dbPath,
      `SELECT COUNT(*) AS n FROM data_assertions a
       JOIN source_snapshots s ON s.id = a.source_snapshot_id
       JOIN sources src ON src.id = s.source_id`);
    check("F3 zero orphan assertions", Number(linked[0].n) === ids1.length, `${linked[0].n} vs ${ids1.length}`);

    const grade = qa(dbPath, "SELECT source_grade FROM sources WHERE id = 'ext-a-1'");
    check("F3 source grade A on the chain", grade[0]?.source_grade === "A", String(grade[0]?.source_grade));

    await runHtmlSource(dbPath, src, url, BUILDER_ROSTER_HTML, "2026-02-02T00:00:00Z");
    const ids2 = qa(dbPath, "SELECT id, entity_id, value FROM data_assertions ORDER BY id");
    const snaps2 = qa(dbPath, "SELECT id FROM source_snapshots");
    const unchanged = qa(dbPath, "SELECT COUNT(*) AS c FROM ingestion_items WHERE status = 'UNCHANGED'");
    check("F4 no duplicate evidence", ids2.length === ids1.length, `${ids2.length} vs ${ids1.length}`);
    check("F4 assertion ids stable", JSON.stringify(ids2.map((r) => r.id)) === JSON.stringify(ids1.map((r) => r.id)));
    check("F4 person entity ids stable", JSON.stringify(ids2.map((r) => r.entity_id)) === JSON.stringify(ids1.map((r) => r.entity_id)));
    check("F4 snapshot not re-fetched", snaps2.length === 1, String(snaps2.length));
    check("F4 item marked UNCHANGED", Number(unchanged[0].c) === 1, String(unchanged[0].c));
  }

  // ---------------------------------------------------------------- G
  console.log("EXT-A â€” G. full extractor on the bounded page");
  {
    const got = await extractValues(MENU_THEN_LEADERSHIP_HTML);
    check("G1 extractor emits only the two real people", got.length === 2, got.join("|"));
    check("G1 extractor emits Jeetendra Jha", got.includes("Jeetendra Jha"), got.join("|"));
  }

  console.log(`\nEXT-A people generic extension: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
