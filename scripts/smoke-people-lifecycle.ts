// ============================================================================
// M3.6B - THE PEOPLE LIFECYCLE, EXERCISED THROUGH THE REAL INGESTION ENGINE.
//
// M3.6A built the source-owned People lifecycle (lib/ingestion/people-evidence.ts)
// and proved it with 110 checks that call planPeopleEvidence / applyPeopleEvidence
// directly. It was, however, reachable from nowhere: the only production path
// that writes people_* assertions is the generic engine (lib/ingestion/engine.ts),
// which asserted every extracted People claim with a bare saveAssertion and so
// never superseded, never revived and never disagreed.
//
// This file closes that gap's proof. It drives GenericIngestionEngine.runSource
// with a fake fetcher and the real writers, and asserts that the lifecycle is
// what the real ingestion path now does. Every check is about behaviour observed
// in the database, never about which function was called.
//
//   E1  the engine still writes people claims; a repeat run adds nothing
//   E2  a source changing a role supersedes ONLY its own row      (lifecycle live)
//   E3  a value that comes back is revived, not duplicated        (lifecycle live)
//   E4  a second source disagreeing records one conflict          (lifecycle live)
//   E5  a slot the run is SILENT about is never retired            (no false loss)
//   E6  a roster split across pages does not retire itself         (aggregation)
//   E7  each claim is anchored to the page that carried it         (provenance)
//   E8  non-people fields keep the untouched write path           (no collateral)
//   E9  real peopleExtractor HTML reaches the lifecycle           (end to end)
//   E10 the source-scoped lookup answers "what does B say now?"    (mandatory)
//   E11 nothing is ever promoted above UNVERIFIED                  (governance)
//
// Deterministic, offline, no AI/OCR/browser, no network.
//
//   npm run smoke:people-lifecycle
// ============================================================================

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  DEFAULT_POLICY,
  GenericIngestionEngine,
  LocalSourceRegistry,
  LocalSqliteEvidenceWriter,
  assertUrlAllowed,
  currentPeopleClaimsForSource,
  peopleExtractor,
} from "../lib/ingestion";
import type {
  DiscoveredTarget,
  EngineDeps,
  ExtractedEvidence,
  FetchOptions,
  FetchResult,
  IngestionSourceSpec,
} from "../lib/ingestion";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string, o?: unknown) => {
  prepare(s: string): {
    get(...a: unknown[]): Record<string, unknown> | undefined;
    all(...a: unknown[]): Record<string, unknown>[];
    run(...a: unknown[]): unknown;
  };
  exec(s: string): void;
  close(): void;
};

const INSTITUTION_ID = "mfi-people-lifecycle";
const SRC_A = "ing-people-a";
const SRC_B = "ing-people-b";
const CHAIR = "people_chair";
const CEO = "people_ceo";
const DIRECTOR = "people_director";

// One host, distinct paths. assertUrlAllowed permits the exact host, so the two
// sources are separated by path rather than by subdomain.
const BASE_A = "https://fixture.test/a";
const BASE_B = "https://fixture.test/b";
const A_BOARD = `${BASE_A}/board`;
const A_ABOUT = `${BASE_A}/about`;
const A_ONLY_BOARD = `${BASE_A}/board-only`;
const A_REAL = `${BASE_A}/real-board`;
const B_BOARD = `${BASE_B}/board`;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: unknown, detail?: unknown): void {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? "" : `  (${JSON.stringify(detail)})`}`);
  }
}

function eq(name: string, got: unknown, want: unknown): void {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  check(name, a === b, a === b ? undefined : { got, want });
}

// --- fixture plumbing -------------------------------------------------------

function scratchDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lk-people-lifecycle-"));
  const path = join(dir, "people-lifecycle.db");
  const db = new Database(path);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8"));
  db.close();
  return path;
}

function fakeHash(body: Uint8Array): string {
  let h = 2166136261 >>> 0;
  for (const b of body) {
    h ^= b;
    h = Math.imul(h, 16777619);
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8).padStart(64, "0");
}

class FakeFetcher {
  private readonly rules: Record<string, { status: number; body: string; contentType: string }>;
  constructor(rules: Record<string, { status: number; body: string; contentType: string }>) {
    this.rules = rules;
  }
  fetch(url: string, _opts?: FetchOptions): Promise<FetchResult> {
    assertUrlAllowed(url, { ...DEFAULT_POLICY, allowedHosts: ["fixture.test"] }, 0);
    const rule = this.rules[url];
    if (!rule) return Promise.reject(new Error(`no fixture rule for ${url}`));
    const bytes = new TextEncoder().encode(rule.body);
    return Promise.resolve({
      finalUrl: url,
      httpStatus: rule.status,
      contentType: rule.contentType,
      contentHash: fakeHash(bytes),
      bodyBytes: bytes.byteLength,
      body: bytes,
      fetchedAt: "2026-10-02T00:00:00.000Z",
      redirectCount: 0,
    });
  }
}

type PageClaims = Record<string, Array<{ field: string; name: string }>>;

/** Wall clock for the fixture: a fixed instant that advances one minute per run. */
const T0 = Date.UTC(2026, 9, 2, 0, 0, 0);
let tick = 0;

/**
 * A People stub extractor emitting exactly the FIELD shape peopleExtractor emits.
 * The extractor itself is already covered by smoke:people-m33 and
 * smoke:people-generic-ext; what is under test here is what the ENGINE does with
 * the claims, so the stub keeps the engine's behaviour observable exactly.
 */
function peopleStub(claimsByPage: PageClaims) {
  return {
    parserId: "people-lifecycle-stub-v1",
    async extract(ctx: { url: string }): Promise<ExtractedEvidence[]> {
      return (claimsByPage[ctx.url] ?? []).map((c) => ({
        kind: "FIELD",
        capability: "PEOPLE",
        field: c.field.toUpperCase(),
        sourceUrl: ctx.url,
        text: c.name,
        confidence: 0.8,
        parserId: "people-lifecycle-stub-v1",
        extractedAt: "2026-10-02T00:00:00.000Z",
      }));
    },
  };
}

function seed(dbPath: string): void {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO institutions (id, slug, name_en, short_name, institution_type, status)
     VALUES (?, 'fixture-people-lifecycle', 'Fixture People Lifecycle', 'Fixture PL', 'PROVINCIAL', 'ACTIVE')`,
  ).run(INSTITUTION_ID);
  const capJson = '{"capabilities":[]}';
  for (const [id, base] of [[SRC_A, BASE_A], [SRC_B, BASE_B]] as Array<[string, string]>) {
    db.prepare(
      `INSERT INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
       VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, 'fixture.test', 'fixture', 'fixture', 1)`,
    ).run(id, `${base}/`);
    db.prepare(
      `INSERT INTO ingestion_sources (id, url, domain, source_type, institution_id, config_json, enabled, fetch_interval_minutes)
       VALUES (?, ?, 'fixture.test', 'MFB_WEBSITE', ?, ?, 1, 1440)`,
    ).run(id, `${base}/`, INSTITUTION_ID, capJson);
  }
  db.close();
}

function makeEngine(
  dbPath: string,
  pages: string[],
  claimsByPage: PageClaims,
  opts: { bodies?: Record<string, string>; extractor?: unknown } = {},
): GenericIngestionEngine {
  // The fixture body embeds the claims as well as the URL, so a CHANGED roster
  // produces a CHANGED content hash. Without this the engine's unchanged-page
  // short-circuit would skip extraction entirely and the scenario would silently
  // assert nothing — a fixture that cannot fail.
  const bodies =
    opts.bodies ??
    Object.fromEntries(
      pages.map((p) => [p, `<html><body>${p}|${JSON.stringify(claimsByPage[p] ?? [])}</body></html>`]),
    );
  const deps: EngineDeps = {
    registry: new LocalSourceRegistry(dbPath),
    fetcher: new FakeFetcher(
      Object.fromEntries(Object.entries(bodies).map(([p, b]) => [p, { status: 200, body: b, contentType: "text/html" }])),
    ),
    extractor: (opts.extractor ?? peopleStub(claimsByPage)) as never,
    canonicalizer: { hash: async (_c: string | null, body: Uint8Array) => fakeHash(body) },
    writer: new LocalSqliteEvidenceWriter(dbPath),
    discovery: {
      async discover(s: IngestionSourceSpec): Promise<DiscoveredTarget[]> {
        return pages.map((p) => ({
          capability: "PEOPLE",
          url: p,
          method: "KNOWN",
          parentUrl: s.url,
          sourceId: s.id,
          institutionId: s.institutionId,
          discoveredAt: "2026-10-02T00:00:00.000Z",
          title: "fixture people page",
          status: "CANDIDATE",
        }));
      },
    },
    validators: [],
    // The clock ADVANCES on every run, exactly as it does in production.
    //
    // This matters more than it looks: the engine derives its runId from `now`,
    // and ingestion_items is UNIQUE(run_id, url). A frozen clock therefore makes
    // every run share one run_id, so saveItem's INSERT OR IGNORE silently drops
    // each later item — including its content_hash — the engine keeps comparing
    // against the FIRST run's hash and declares itself UNCHANGED forever. That is
    // a property of a frozen clock, not of the lifecycle, and a fixture that
    // freezes it cannot observe supersession or revival at all.
    now: () => new Date(T0 + tick++ * 60_000).toISOString(),
  };
  return new GenericIngestionEngine(deps);
}

interface Claim {
  field_name: string;
  source_id: string;
  value: string;
  valid_to: string | null;
  verification_status: string;
  source_snapshot_id: string;
}

function rows(dbPath: string, sql: string, ...args: unknown[]): Record<string, unknown>[] {
  const db = new Database(dbPath, { readonly: true });
  const out = db.prepare(sql).all(...args);
  db.close();
  return out;
}

function count(dbPath: string, sql: string, ...args: unknown[]): number {
  return Number(rows(dbPath, sql, ...args)[0]?.n ?? -1);
}

/** Runs the engine and fails loudly if the run itself did not succeed. */
async function runOk(
  label: string,
  engine: GenericIngestionEngine,
  sourceId: string,
): Promise<void> {
  const res = await engine.runSource(sourceId);
  check(`${label} the run completed with no item errors`, res.ok && res.errors.length === 0, res.errors);
  check(
    `${label} every target was extracted`,
    res.items.length > 0 && res.items.every((i) => i.lifecycle === "EXTRACTED" || i.lifecycle === "UNCHANGED"),
    res.items.map((i) => `${i.url}:${i.lifecycle}`),
  );
}

// --- the run ----------------------------------------------------------------

async function main(): Promise<void> {
  const dbPath = scratchDb();
  seed(dbPath);

  const claims = (field: string): Claim[] =>
    rows(
      dbPath,
      `SELECT field_name, source_id, value, valid_to, verification_status, source_snapshot_id
         FROM data_assertions
        WHERE entity_type = 'institution' AND entity_id = ? AND field_name = ?
        ORDER BY value, source_id`,
      INSTITUTION_ID,
      field,
    ) as unknown as Claim[];
  const current = (field: string): Claim[] => claims(field).filter((r) => r.valid_to === null);

  console.log("\nM3.6B people lifecycle through the real ingestion engine\n");

  // ---- E1: the additive path still works, and re-running adds nothing -------
  console.log("E1  the engine still writes people claims, and a repeat run adds nothing");
  await runOk(
    "E1.1",
    makeEngine(dbPath, [A_BOARD, A_ABOUT], {
      [A_BOARD]: [{ field: CHAIR, name: "Anita Gurung" }, { field: DIRECTOR, name: "Bimala Rai Paudel" }],
      [A_ABOUT]: [{ field: CEO, name: "Keshav Raj Paudel" }],
    }),
    SRC_A,
  );
  eq("E1.2 the chair reached the ledger from the engine", current(CHAIR).map((r) => r.value), ["Anita Gurung"]);
  eq("E1.3 the director did too", current(DIRECTOR).map((r) => r.value), ["Bimala Rai Paudel"]);
  eq("E1.4 the CEO from the SECOND page too", current(CEO).map((r) => r.value), ["Keshav Raj Paudel"]);

  // The engine short-circuits an unchanged page by content hash, so a repeat run
  // re-observes nothing. Either way the ledger must not move.
  await runOk(
    "E1.5",
    makeEngine(dbPath, [A_BOARD, A_ABOUT], {
      [A_BOARD]: [{ field: CHAIR, name: "Anita Gurung" }, { field: DIRECTOR, name: "Bimala Rai Paudel" }],
      [A_ABOUT]: [{ field: CEO, name: "Keshav Raj Paudel" }],
    }),
    SRC_A,
  );
  eq("E1.6 a repeat run adds no row", claims(CHAIR).length, 1);
  eq("E1.7 and retires nothing", claims(CHAIR).filter((r) => r.valid_to !== null).length, 0);

  // ---- E2: a source changing its mind supersedes ONLY its own row -----------
  console.log("\nE2  a source that changes a role supersedes its own row, and nobody else's");
  await runOk(
    "E2.1",
    makeEngine(dbPath, [A_BOARD, A_ABOUT], {
      [A_BOARD]: [{ field: CHAIR, name: "Sunita Poudel" }, { field: DIRECTOR, name: "Bimala Rai Paudel" }],
      [A_ABOUT]: [{ field: CEO, name: "Keshav Raj Paudel" }],
    }),
    SRC_A,
  );
  const chairRetired = claims(CHAIR).filter((r) => r.valid_to !== null);
  eq("E2.2 the old chair is retired, not deleted", chairRetired.map((r) => r.value), ["Anita Gurung"]);
  check("E2.3 a retired claim keeps its value and its owning source", chairRetired.every((r) => r.source_id === SRC_A));
  eq("E2.4 retirement is marked STALE", chairRetired.map((r) => r.verification_status), ["STALE"]);
  eq("E2.5 the new chair is current", current(CHAIR).map((r) => r.value), ["Sunita Poudel"]);
  eq("E2.6 the untouched director is still current", current(DIRECTOR).map((r) => r.value), ["Bimala Rai Paudel"]);
  eq("E2.7 the untouched CEO is still current", current(CEO).map((r) => r.value), ["Keshav Raj Paudel"]);

  // ---- E3: a value that comes back is revived, not duplicated ---------------
  console.log("\nE3  a value that comes back is revived, never duplicated");
  await runOk(
    "E3.1",
    makeEngine(dbPath, [A_BOARD, A_ABOUT], {
      [A_BOARD]: [{ field: CHAIR, name: "Anita Gurung" }, { field: DIRECTOR, name: "Bimala Rai Paudel" }],
      [A_ABOUT]: [{ field: CEO, name: "Keshav Raj Paudel" }],
    }),
    SRC_A,
  );
  const anita = claims(CHAIR).find((r) => r.value === "Anita Gurung");
  check("E3.2 the retired row is current again", anita?.valid_to === null, anita);
  eq("E3.3 no second row was created for the same claim", claims(CHAIR).filter((r) => r.value === "Anita Gurung").length, 1);
  eq("E3.4 the interim chair is the retired one now", claims(CHAIR).filter((r) => r.valid_to !== null).map((r) => r.value), ["Sunita Poudel"]);
  eq("E3.5 and the chair slot has exactly one current holder", current(CHAIR).length, 1);

  // ---- E4: a second source disagreeing records a conflict -------------------
  console.log("\nE4  cross-source disagreement is recorded once, with both owners named");
  await runOk("E4.1", makeEngine(dbPath, [B_BOARD], { [B_BOARD]: [{ field: CHAIR, name: "Dipesh Karki" }] }), SRC_B);
  eq(
    "E4.2 both sources keep their own current chair",
    current(CHAIR).map((r) => `${r.source_id}:${r.value}`).sort(),
    [`${SRC_A}:Anita Gurung`, `${SRC_B}:Dipesh Karki`],
  );
  const conflicts = rows(
    dbPath,
    "SELECT source_a_id, source_b_id, value_a, value_b, resolution_status FROM data_conflicts WHERE entity_id = ? ORDER BY id",
    INSTITUTION_ID,
  );
  check("E4.3 exactly one dispute", conflicts.length === 1, conflicts);
  eq("E4.4 it names the two different owners", [conflicts[0]?.source_a_id, conflicts[0]?.source_b_id].sort(), [SRC_A, SRC_B].sort());
  eq("E4.5 it carries both disputed values", [conflicts[0]?.value_a, conflicts[0]?.value_b].sort(), ["Anita Gurung", "Dipesh Karki"]);
  eq("E4.6 and it is open for review", conflicts[0]?.resolution_status, "OPEN");
  eq("E4.7 neither side was retired by the disagreement", current(CHAIR).length, 2);

  // A third run of the same disagreement must not grow the review queue.
  await runOk("E4.8", makeEngine(dbPath, [B_BOARD], { [B_BOARD]: [{ field: CHAIR, name: "Dipesh Karki" }] }), SRC_B);
  eq("E4.9 a repeated disagreement adds no second conflict row", count(dbPath, "SELECT COUNT(*) n FROM data_conflicts WHERE entity_id = ?", INSTITUTION_ID), 1);

  // ---- E5: silence never retires -------------------------------------------
  console.log("\nE5  a slot the run is silent about is never retired");
  // A different page URL, so the content hash differs and the page is genuinely
  // re-read. This run says nothing about the director or the CEO.
  await runOk(
    "E5.1",
    makeEngine(dbPath, [A_ONLY_BOARD], { [A_ONLY_BOARD]: [{ field: CHAIR, name: "Anita Gurung" }] }),
    SRC_A,
  );
  eq("E5.2 the director the run no longer read is still current", current(DIRECTOR).map((r) => r.value), ["Bimala Rai Paudel"]);
  eq("E5.3 the CEO the run no longer read is still current", current(CEO).map((r) => r.value), ["Keshav Raj Paudel"]);
  check(
    "E5.4 nothing at all was retired by silence",
    [...claims(DIRECTOR), ...claims(CEO)].every((r) => r.valid_to === null),
  );

  // ---- E6: a roster split across pages must not shred itself ----------------
  console.log("\nE6  a roster split across pages is aggregated, not shredded");
  // One run whose chair lives on /board and whose CEO lives on /about, plus the
  // director from a page this run never opened. A per-page observation would read
  // "/about has no chair" as a withdrawal and retire the chair (and vice versa),
  // and would retire the unobserved director. All three must survive.
  const mine = (field: string): Claim[] => current(field).filter((r) => r.source_id === SRC_A);
  await runOk(
    "E6.1",
    makeEngine(dbPath, [A_BOARD, A_ABOUT], {
      [A_BOARD]: [{ field: CHAIR, name: "Anita Gurung" }],
      [A_ABOUT]: [{ field: CEO, name: "Keshav Raj Paudel" }],
    }),
    SRC_A,
  );
  eq("E6.2 the chair survived, though only one page carried it", mine(CHAIR).map((r) => r.value), ["Anita Gurung"]);
  eq("E6.3 the CEO survived, though only the other page carried it", mine(CEO).map((r) => r.value), ["Keshav Raj Paudel"]);
  eq("E6.4 the director this run never opened is untouched", mine(DIRECTOR).map((r) => r.value), ["Bimala Rai Paudel"]);
  eq("E6.5 and no shredding: exactly one current chair for this source", mine(CHAIR).length, 1);
  eq("E6.6 the other source's chair is still its own", current(CHAIR).filter((r) => r.source_id === SRC_B).map((r) => r.value), ["Dipesh Karki"]);

  // ---- E7: provenance ------------------------------------------------------
  console.log("\nE7  each claim is anchored to the snapshot that carried it");
  const chairSnap = current(CHAIR).find((r) => r.source_id === SRC_A)!;
  const ceoSnap = current(CEO).find((r) => r.source_id === SRC_A)!;
  const snapshots = rows(dbPath, "SELECT id FROM source_snapshots").map((s) => s.id as string);
  check(
    "E7.1 every people claim is anchored to a stored snapshot",
    [...claims(CHAIR), ...claims(DIRECTOR), ...claims(CEO)].every((r) => snapshots.includes(r.source_snapshot_id)),
    [...claims(CHAIR), ...claims(DIRECTOR), ...claims(CEO)].map((r) => r.source_snapshot_id),
  );
  check(
    "E7.2 the chair and the CEO come from DIFFERENT pages' snapshots",
    chairSnap.source_snapshot_id !== ceoSnap.source_snapshot_id,
    { chair: chairSnap.source_snapshot_id, ceo: ceoSnap.source_snapshot_id },
  );

  // ---- E8: no collateral damage --------------------------------------------
  console.log("\nE8  fields outside the people vocabulary are untouched by this change");
  eq(
    "E8.1 no non-people assertion was invented by a people-only run",
    count(dbPath, "SELECT COUNT(*) n FROM data_assertions WHERE field_name NOT LIKE 'people_%'"),
    0,
  );
  eq(
    "E8.2 nothing was verified by the engine",
    count(dbPath, "SELECT COUNT(*) n FROM data_assertions WHERE verification_status NOT IN ('UNVERIFIED','STALE')"),
    0,
  );
  // Chair: A's Anita (current) + A's Sunita (retired) + B's Dipesh = 3.
  // Director: 1. CEO: 1. Five rows in total, and none of them deleted.
  eq("E8.3 every row is still stored, including the retired one", count(dbPath, "SELECT COUNT(*) n FROM data_assertions"), 5);

  // ---- E9: the REAL extractor, end to end ----------------------------------
  console.log("\nE9  real peopleExtractor HTML reaches the lifecycle end to end");
  const db2 = scratchDb();
  seed(db2);
  const realBody = [
    "<html><body>",
    "<h1>Board of Directors</h1>",
    '<div class="member"><span class="name">Anita Gurung</span><span class="designation">Chairperson</span></div>',
    '<div class="member"><span class="name">Bimala Rai Paudel</span><span class="designation">Director</span></div>',
    '<div class="member"><span class="name">Keshav Raj Paudel</span><span class="designation">Director</span></div>',
    '<div class="member"><span class="name">Sunita Poudel</span><span class="designation">Director</span></div>',
    "</body></html>",
  ].join("");
  await runOk(
    "E9.1",
    makeEngine(db2, [A_REAL], {}, { bodies: { [A_REAL]: realBody }, extractor: peopleExtractor }),
    SRC_A,
  );
  const realClaims = rows(
    db2,
    "SELECT field_name, value, verification_status, source_snapshot_id FROM data_assertions WHERE entity_type = 'institution' AND entity_id = ? AND field_name LIKE 'people_%' AND valid_to IS NULL ORDER BY field_name, value",
    INSTITUTION_ID,
  );
  check("E9.2 the real extractor produced people claims through the engine", realClaims.length > 0, realClaims);
  check(
    "E9.3 they carry the M3.3 role vocabulary",
    realClaims.every((r) => String(r.field_name).startsWith("people_")),
    realClaims.map((r) => r.field_name),
  );
  check("E9.4 the chairperson was recognised", realClaims.some((r) => r.field_name === CHAIR), realClaims.map((r) => `${r.field_name}=${r.value}`));
  check(
    "E9.5 every one is UNVERIFIED and snapshot-anchored",
    realClaims.every((r) => r.verification_status === "UNVERIFIED" && Boolean(r.source_snapshot_id)),
  );

  // ---- E10/E11: mandatory query and governance floor ------------------------
  console.log("\nE10 the source-scoped lookup answers 'what does this source say now?'");
  const writer = new LocalSqliteEvidenceWriter(dbPath);
  const aSays = await currentPeopleClaimsForSource(writer, { institutionId: INSTITUTION_ID, fieldName: CHAIR, sourceId: SRC_A });
  const bSays = await currentPeopleClaimsForSource(writer, { institutionId: INSTITUTION_ID, fieldName: CHAIR, sourceId: SRC_B });
  eq("E10.1 source A's current chair", aSays.map((r) => r.value), ["Anita Gurung"]);
  eq("E10.2 source B answers differently, and is not merged into A's", bSays.map((r) => r.value), ["Dipesh Karki"]);
  check("E10.3 a retired claim is absent from the current answer", !aSays.some((r) => r.value === "Sunita Poudel"), aSays.map((r) => r.value));
  eq("E10.4 but it is still stored and answerable as history", count(dbPath, "SELECT COUNT(*) n FROM data_assertions WHERE value = 'Sunita Poudel'"), 1);

  console.log("\nE11 nothing anywhere was promoted above UNVERIFIED");
  eq(
    "E11.1 zero promoted rows",
    count(dbPath, "SELECT COUNT(*) n FROM data_assertions WHERE verification_status IN ('HUMAN_VERIFIED','AUTO_VERIFIED')"),
    0,
  );
  // A run whose pages were all unchanged writes nothing and therefore audits
  // nothing, so this counts the runs that actually applied a plan, not the runs.
  const applied = count(dbPath, "SELECT COUNT(*) n FROM audit_logs WHERE action = 'PEOPLE_EVIDENCE_APPLIED'");
  check("E11.2 the lifecycle audited each application it performed", applied >= 3, applied);
  eq(
    "E11.3 and the audit trail names the source and the snapshot",
    count(
      dbPath,
      "SELECT COUNT(*) n FROM audit_logs WHERE action = 'PEOPLE_EVIDENCE_APPLIED' AND after_json LIKE '%source_id%' AND after_json LIKE '%source_snapshot_id%'",
    ),
    count(dbPath, "SELECT COUNT(*) n FROM audit_logs WHERE action = 'PEOPLE_EVIDENCE_APPLIED'"),
  );

  console.log(`\nM3.6B people lifecycle via the real engine: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log(`failed: ${failures.join(" | ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
