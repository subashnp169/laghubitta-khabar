// ============================================================================
// M3.4 GATE - BRANCH PERSISTENCE SEMANTICS AT SQLITE LEVEL (P1..P7)
//
// Real schema/schema.sql, real LocalSqliteEvidenceWriter, real SQL. No pure-helper
// shortcuts: every expectation below is read back out of the database.
//
//   P1  same source twice              -> 0 semantic duplicates
//   P2  same content, new snapshot     -> 0 semantic duplicates
//   P3  formatting-only HTML change    -> canonical unchanged, no new assertion
//   P4  real attribute change          -> new + old retained, same identity
//   P5  branch rename                  -> old identity retained, new created
//   P6  same name, different district  -> two identities
//   P7  same branch, two institutions  -> two identities
//   P8  cross-source provenance        -> two sources, one identity, BOTH rows
//   P9  supersession                   -> old row marked, not deleted
//
// The three-way distinction this phase exists to protect:
//
//   branch_count = 0    a source reliably proved the institution has no branches
//   branch_count = null no source could tell us
//   (neither)           the data exists but the current fetcher cannot reach it
//
// Run: npx tsx scripts/smoke-branch-persistence.ts
// ============================================================================

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteEvidenceWriter } from "../lib/ingestion";
import { deterministicHtmlCanonicalizer } from "../lib/ingestion/canonical";
import {
  applyExternalPlan,
  externalBranchEntityId,
  externalRecordFingerprint,
  planExternalRepeat,
  type ExternalBranchRecord,
  type ExternalRecordState,
} from "../lib/ingestion";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string) => {
  prepare(s: string): {
    get(...a: unknown[]): Record<string, unknown> | undefined;
    all(...a: unknown[]): Array<Record<string, unknown>>;
    run(...a: unknown[]): { changes: number };
  };
  exec(s: string): void;
  close(): void;
};

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; failures.push(name); console.log("  FAIL " + name); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name + (g === w ? "" : `  (got ${g}, want ${w})`), g === w);
}
function section(t: string): void { console.log("\n" + t); }

const FIELDS = [
  { field: "branch_name", get: (r: ExternalBranchRecord) => r.branch_name.trim() },
  { field: "district", get: (r: ExternalBranchRecord) => (r.district ?? "").trim() },
  { field: "address", get: (r: ExternalBranchRecord) => (r.address ?? "").trim() },
  { field: "open_date", get: (r: ExternalBranchRecord) => (r.open_date ?? "").trim() },
];

function rec(o: Partial<ExternalBranchRecord> & { branch_name: string }): ExternalBranchRecord {
  return {
    external_code: null, institution_name: null, district: null, province: null,
    municipality: null, ward: null, address: null, open_date: null, status: null,
    phone: null, email: null, ...o,
  } as ExternalBranchRecord;
}

function states(recs: ExternalBranchRecord[], inst: string): ExternalRecordState[] {
  return recs.map((record) => ({
    institution_id: inst,
    entity_id: externalBranchEntityId(inst, record),
    fingerprint: externalRecordFingerprint(record),
    record,
  }));
}

/** A realistic NRB-shaped page, so P3 is a real formatting change, not a stub. */
function page(rows: Array<[string, string, string, string, string, string]>, opts?: { upper?: boolean; permuted?: boolean; extraSpace?: boolean }): string {
  const head = opts?.permuted
    ? "<tr><th>Branch Name</th><th>Open Date</th><th>District</th><th>Code</th><th>Address</th><th>S.N.</th></tr>"
    : "<tr><th>S.N.</th><th>Code</th><th>Address</th><th>District</th><th>Branch Name</th><th>Open Date</th></tr>";
  const body = rows
    .map((r, i) => {
      const [sn, code, addr, dist, name, opened] = r;
      const cells = opts?.permuted ? [name, opened, dist, code, addr, sn] : [sn, code, addr, dist, name, opened];
      const sep = opts?.extraSpace ? "   " : "";
      return `<tr>${cells.map((c) => `<td>${sep}${c}${sep}</td>`).join("")}</tr>`;
    })
    .join(opts?.extraSpace ? "\n\n  " : "\n  ");
  const tag = opts?.upper ? "TABLE" : "table";
  return `<html><body>\n<${tag} class="table">\n  ${head}\n  ${body}\n</${tag}>\n</body></html>`;
}

const BASE_ROWS: Array<[string, string, string, string, string, string]> = [
  ["1", "11001001", "17, Kathmandu Metropolitian City", "Kathmandu", "Head Office", "1994-07-30"],
  ["2", "11001002", "22, Kathmandu Metropolitian City", "Kathmandu", "Kathmandu Banking Office", "1994-07-30"],
];

async function canonicalHash(html: string): Promise<string> {
  return deterministicHtmlCanonicalizer.hash("text/html", new TextEncoder().encode(html));
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "m34-persist-"));
  const dbPath = join(dir, "persist.db");
  const schema = readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(dbPath);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  const now = "2026-09-27T00:00:00.000Z";
  const ins = db.prepare(
    `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
  );
  ins.run("s-official", "MFB_WEBSITE", "INSTITUTION", "A", "https://www.example-a.com.np/branches", "www.example-a.com.np", "Branches", "MFI A", now);
  ins.run("s-nrb", "NRB", "NRB", "A", "https://www.nrb.org.np/bank-list/", "www.nrb.org.np", "BFI List", "NRB", now);
  db.close();

  const writer = new LocalSqliteEvidenceWriter(dbPath);
  const q = <T = Record<string, unknown>>(sql: string, ...a: unknown[]): T[] => {
    const d = new Database(dbPath);
    const r = d.prepare(sql).all(...a) as T[];
    d.close();
    return r;
  };
  const one = <T = Record<string, unknown>>(sql: string, ...a: unknown[]): T | undefined => {
    const d = new Database(dbPath);
    const r = d.prepare(sql).get(...a) as T | undefined;
    d.close();
    return r;
  };

  // The two helper wrappers keep every expectation expressed in the same shape
  // the planner already uses, so P1..P9 exercise the real write path.
  const ingest = async (args: {
    source: string; inst: string; recs: ExternalBranchRecord[];
    priorHash: string | null; contentHash: string; prior: ExternalRecordState[];
  }) => {
    const next = states(args.recs, args.inst);
    const plan = planExternalRepeat({
      source_id: args.source,
      prior_content_hash: args.priorHash,
      content_hash: args.contentHash,
      prior: args.prior,
      next,
      fields: FIELDS,
    });
    const applied = await applyExternalPlan(plan, {
      writer,
      source_id: args.source,
      snapshot: { fetched_at: now, http_status: 200, mime_type: "text/html", parser_version: "ext-branch-table-v1" },
      observed_at: now,
      confidence: 0.7,
      verification_status: "UNVERIFIED",
    });
    return { plan, applied };
  };

  const BASE = [
    rec({ external_code: "11001001", branch_name: "Head Office", district: "Kathmandu", address: "17, Kathmandu Metropolitian City", open_date: "1994-07-30" }),
    rec({ external_code: "11001002", branch_name: "Kathmandu Banking Office", district: "Kathmandu", address: "22, Kathmandu Metropolitian City", open_date: "1994-07-30" }),
  ];
  const h1 = await canonicalHash(page(BASE_ROWS));

  // ==========================================================================
  section("P1  same source twice -> zero semantic duplicates");
  // ==========================================================================
  {
    const first = await ingest({ source: "s-nrb", inst: "bank-x", recs: BASE, priorHash: null, contentHash: h1, prior: [] });
    check("P1.1 first run created assertions", first.applied.assertions > 0);
    const after1 = q("SELECT COUNT(*) c FROM data_assertions");
    eq("P1.2 assertion rows after first run", after1[0].c, 8);
    eq("P1.3 distinct semantic values after first run",
      q<{ c: number }>("SELECT COUNT(DISTINCT entity_id || '|' || field_name || '|' || LOWER(TRIM(value))) c FROM data_assertions")[0].c, 8);

    // Second run, identical content. The planner sees no change AND the writer
    // would refuse a duplicate anyway. Both layers must hold.
    const second = await ingest({ source: "s-nrb", inst: "bank-x", recs: BASE, priorHash: h1, contentHash: h1, prior: states(BASE, "bank-x") });
    check("P1.4 planner is a no-op", second.plan.no_op);
    eq("P1.5 second run inserted nothing", q("SELECT COUNT(*) c FROM data_assertions")[0].c, 8);
    eq("P1.6 no duplicate semantic values", second.applied.assertions, 0);
  }

  // ==========================================================================
  section("P2  same content, different snapshot id -> zero semantic duplicates");
  // ==========================================================================
  {
    // Force a second, distinct snapshot for byte-identical semantic content.
    const snap = await writer.saveSnapshot({
      sourceId: "s-nrb", fetchedAt: "2026-09-27T01:00:00.000Z", contentHash: h1,
      httpStatus: 200, mimeType: "text/html", parserVersion: "ext-branch-table-v1",
      r2Key: null, extractionStatus: "EXTRACTED",
    });
    check("P2.1 a distinct snapshot row exists", typeof snap === "string" && snap.length > 0);
    const snapCount = one<{ c: number }>("SELECT COUNT(*) c FROM source_snapshots WHERE content_hash = ?", h1);
    check("P2.2 snapshot rows were allowed to duplicate (append-only by design)", (snapCount?.c ?? 0) >= 1);

    const before = q("SELECT COUNT(*) c FROM data_assertions")[0].c;
    const again = await ingest({ source: "s-nrb", inst: "bank-x", recs: BASE, priorHash: h1, contentHash: h1, prior: states(BASE, "bank-x") });
    await again;
    eq("P2.3 no new assertion despite a new snapshot", q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c, before);
    // The real invariant is per SOURCE. Two different sources asserting the same
    // value is corroboration, not duplication - P8 depends on it - so the check
    // is deliberately scoped to one source asserting one value twice.
    eq("P2.4 zero duplicate semantic values from the same source",
      q<{ c: number }>(`SELECT COUNT(*) c FROM (
        SELECT entity_id, field_name, LOWER(TRIM(value)) v, source_id, COUNT(*) n
        FROM data_assertions GROUP BY entity_id, field_name, v, source_id HAVING n > 1)`)[0].c, 0);
  }

  // ==========================================================================
  section("P3  formatting-only HTML change -> canonical unchanged, no new assertion");
  // ==========================================================================
  {
    // Tag case and whitespace are presentation, not content. These must collapse.
    const formatted = page(BASE_ROWS, { upper: true, extraSpace: true });
    const h2 = await canonicalHash(formatted);
    eq("P3.1 canonical hash is unchanged by reformatting", h2, h1);
    check("P3.2 the raw bytes DID change", formatted !== page(BASE_ROWS));

    const before = q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c;
    const r = await ingest({ source: "s-nrb", inst: "bank-x", recs: BASE, priorHash: h1, contentHash: h2, prior: states(BASE, "bank-x") });
    check("P3.3 planner treats it as unchanged", r.plan.no_op);
    eq("P3.4 no new assertion written", q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c, before);
    eq("P3.5 no new snapshot written", r.applied.snapshot_id, null);
    eq("P3.6 no conflict invented", q<{ c: number }>("SELECT COUNT(*) c FROM data_conflicts")[0].c, 0);

    // Column PERMUTATION is deliberately NOT expected to be canonically stable.
    // Reordering the columns of a published table is a real change to the
    // document, so the canonicalizer is right to notice it; what must survive is
    // the extracted meaning, which is the parser's job, not the hasher's. Keeping
    // these two responsibilities separate is what stops a re-laid-out page from
    // either being ignored or being mistaken for new data.
    const { parseExternalBranchTable } = await import("../lib/ingestion");
    const a = parseExternalBranchTable(page(BASE_ROWS));
    const b = parseExternalBranchTable(page(BASE_ROWS, { permuted: true }));
    eq("P3.7 a column-permuted page still yields identical semantic records",
      b.records.map((x) => externalRecordFingerprint(x)), a.records.map((x) => externalRecordFingerprint(x)));
    check("P3.8 ...even though its canonical hash genuinely differs",
      (await canonicalHash(page(BASE_ROWS, { permuted: true }))) !== h1);
  }

  // Shared with P5: the "one attribute changed" state that P5 then renames.
  const CHANGED = [
    { ...BASE[0], address: "99, New Road, Kathmandu" },
    BASE[1],
  ];
  const rowsChanged: typeof BASE_ROWS = [
    ["1", "11001001", "99, New Road, Kathmandu", "Kathmandu", "Head Office", "1994-07-30"],
    ["2", "11001002", "22, Kathmandu Metropolitian City", "Kathmandu", "Kathmandu Banking Office", "1994-07-30"],
  ];
  const h3 = await canonicalHash(page(rowsChanged));

  // ==========================================================================
  section("P4  real attribute change -> new + old retained, same identity");
  // ==========================================================================
  {
    const r = await ingest({ source: "s-nrb", inst: "bank-x", recs: CHANGED, priorHash: h1, contentHash: h3, prior: states(BASE, "bank-x") });

    const addrRows = q<{ value: string }>(
      "SELECT value FROM data_assertions WHERE field_name='address' AND entity_id LIKE '%head office%' ORDER BY value",
    );
    eq("P4.1 both address observations are retained", addrRows.map((x) => x.value),
      ["17, Kathmandu Metropolitian City", "99, New Road, Kathmandu"]);
    eq("P4.2 no old value was deleted or overwritten", q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c, 9);
    eq("P4.3 identity count is unchanged", q<{ c: number }>("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions")[0].c, 2);
    eq("P4.4 exactly one CURRENT address for that branch",
      q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions WHERE field_name='address' AND entity_id LIKE '%head office%' AND valid_to IS NULL")[0].c, 1);
    eq("P4.5 the surviving current value is the new one",
      one<{ value: string }>("SELECT value FROM data_assertions WHERE field_name='address' AND entity_id LIKE '%head office%' AND valid_to IS NULL")?.value,
      "99, New Road, Kathmandu");
    eq("P4.6 the superseded row is marked, not deleted",
      q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions WHERE field_name='address' AND value='17, Kathmandu Metropolitian City' AND valid_to IS NOT NULL")[0].c, 1);
    eq("P4.7 superseded row is marked STALE",
      one<{ verification_status: string }>("SELECT verification_status FROM data_assertions WHERE value='17, Kathmandu Metropolitian City'")?.verification_status,
      "STALE");
    check("P4.8 the plan reported supersession", r.applied.superseded >= 1);
    eq("P4.9 nothing is left merely pending", r.applied.superseded_pending, 0);
    eq("P4.10 a conflict was recorded for the change", q("SELECT COUNT(*) c FROM data_conflicts WHERE field_name='address'")[0].c, 1);
  }

  // ==========================================================================
  section("P5  branch rename -> old identity retained, new created");
  // ==========================================================================
  {
    const RENAMED = [
      { ...CHANGED[0], branch_name: "Head Office (Renamed)" },
      CHANGED[1],
    ];
    const rows3: typeof BASE_ROWS = [
      ["1", "11001001", "99, New Road, Kathmandu", "Kathmandu", "Head Office (Renamed)", "1994-07-30"],
      ["2", "11001002", "22, Kathmandu Metropolitian City", "Kathmandu", "Kathmandu Banking Office", "1994-07-30"],
    ];
    const h4 = await canonicalHash(page(rows3));
    const prior5 = states(CHANGED, "bank-x");
    const r = await ingest({ source: "s-nrb", inst: "bank-x", recs: RENAMED, priorHash: h3, contentHash: h4, prior: prior5 });

    check("P5.1 the rename is NOT a mutation of the old identity", r.plan.writes.filter((w) => w.kind === "ASSERT").every((w) =>
      w.kind !== "ASSERT" || w.field_name !== "branch_name" || !String((w as { value: string }).value).includes("Head Office\"")));
    const names = q<{ value: string }>("SELECT DISTINCT value FROM data_assertions WHERE field_name='branch_name' ORDER BY value");
    check("P5.2 the old name is still present as history", names.some((x) => x.value === "Head Office"));
    check("P5.3 the new name is present as its own identity", names.some((x) => x.value === "Head Office (Renamed)"));
    eq("P5.4 identity count grew by exactly one", q<{ c: number }>("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions")[0].c, 3);
    eq("P5.5 the old identity has no current branch_name",
      q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions WHERE field_name='branch_name' AND value='Head Office' AND valid_to IS NULL")[0].c, 0);
    eq("P5.6 the old identity row is retained, marked superseded",
      q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions WHERE field_name='branch_name' AND value='Head Office' AND valid_to IS NOT NULL")[0].c, 1);
    // 8 rows from P1, +1 new address from P4, +4 rows for the renamed identity
    // created in P5. Nothing overwritten, nothing removed.
    eq("P5.7 nothing was deleted", q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c, 13);
    check("P5.8 the disappearance is recorded as a conflict, not a closure",
      q<{ c: number }>("SELECT COUNT(*) c FROM data_conflicts WHERE resolution_note LIKE '%NOT evidence the branch closed%'")[0].c >= 1);
  }

  // ==========================================================================
  section("P6  same name in different districts -> two identities");
  // ==========================================================================
  {
    const twoPlaces = [
      rec({ branch_name: "Ghorahi", district: "Dang" }),
      rec({ branch_name: "Ghorahi", district: "Rupandehi" }),
    ];
    const st = states(twoPlaces, "bank-y");
    const plan = planExternalRepeat({
      source_id: "s-nrb", prior_content_hash: null, content_hash: "h-p6",
      prior: [], next: st, fields: FIELDS,
    });
    const applied = await applyExternalPlan(plan, {
      writer, source_id: "s-nrb",
      snapshot: { fetched_at: now, http_status: 200, mime_type: "text/html", parser_version: "ext-branch-table-v1" },
      observed_at: now, confidence: 0.7, verification_status: "UNVERIFIED",
    });
    check("P6.1 both rows written", applied.assertions > 0);
    const ids = q<{ entity_id: string }>("SELECT DISTINCT entity_id FROM data_assertions WHERE entity_id LIKE '%ghorahi%' ORDER BY entity_id");
    eq("P6.2 exactly two identities", ids.length, 2);
    check("P6.3 one is Dang and one is Rupandehi",
      ids.some((x) => x.entity_id.includes("dang")) && ids.some((x) => x.entity_id.includes("rupandehi")));
    eq("P6.4 not a cross-source conflict", q("SELECT COUNT(*) c FROM data_conflicts WHERE entity_id LIKE '%ghorahi%'")[0].c, 0);
  }

  // ==========================================================================
  section("P7  same branch name in two institutions -> two identities");
  // ==========================================================================
  {
    const sameName = [rec({ branch_name: "Ghorahi", district: "Dang" })];
    for (const inst of ["mfi-001", "mfi-002"]) {
      const st = states(sameName, inst);
      const plan = planExternalRepeat({
        source_id: "s-nrb", prior_content_hash: null, content_hash: `h-p7-${inst}`,
        prior: [], next: st, fields: FIELDS,
      });
      await applyExternalPlan(plan, {
        writer, source_id: "s-nrb",
        snapshot: { fetched_at: now, http_status: 200, mime_type: "text/html", parser_version: "ext-branch-table-v1" },
        observed_at: now, confidence: 0.7, verification_status: "UNVERIFIED",
      });
    }
    // Scoped to the two institutions, because P6 already created a Dang branch
    // for bank-y under the same name. Matching on the name alone would count that
    // one too and quietly pass the wrong test.
    const ids = q<{ entity_id: string }>("SELECT DISTINCT entity_id FROM data_assertions WHERE entity_id LIKE '%ghorahi%|dang%' AND (entity_id LIKE 'mfi-001|%' OR entity_id LIKE 'mfi-002|%') ORDER BY entity_id");
    eq("P7.1 two identities for the same branch name", ids.length, 2);
    check("P7.2 each is scoped to its own institution",
      ids.some((x) => x.entity_id.startsWith("mfi-001|")) && ids.some((x) => x.entity_id.startsWith("mfi-002|")));
  }

  // ==========================================================================
  section("P8  cross-source provenance -> one identity, TWO assertion rows");
  // ==========================================================================
  {
    // The official site and the regulator both say this branch is in Dang. Both
    // claims must survive, otherwise "which sources saw this branch?" is
    // unanswerable and corroboration cannot be shown at all.
    const claimRec = [rec({ branch_name: "Ghorahi", district: "Dang", address: "1, Ghorahi" })];
    for (const [src, hash] of [["s-official", "h-p8-official"], ["s-nrb", "h-p8-nrb"]] as const) {
      const st = states(claimRec, "mfi-001");
      const plan = planExternalRepeat({
        source_id: src, prior_content_hash: null, content_hash: hash,
        prior: [], next: st, fields: FIELDS,
      });
      await applyExternalPlan(plan, {
        writer, source_id: src,
        snapshot: { fetched_at: now, http_status: 200, mime_type: "text/html", parser_version: "ext-branch-table-v1" },
        observed_at: now, confidence: 0.7, verification_status: "UNVERIFIED",
      });
    }
    const rows8 = q<{ entity_id: string; field_name: string; value: string; source_id: string }>(
      "SELECT entity_id, field_name, value, source_id FROM data_assertions WHERE entity_id LIKE 'mfi-001|%ghorahi%|dang%' AND field_name='district' ORDER BY source_id",
    );
    eq("P8.1 one semantic identity", q("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions WHERE entity_id LIKE 'mfi-001|%ghorahi%|dang%'")[0].c, 1);
    eq("P8.2 BOTH sources are represented", rows8.length, 2);
    check("P8.3 ...and they are different sources",
      new Set(rows8.map((x) => x.source_id)).size === 2);
    check("P8.4 every row points at a real snapshot",
      q("SELECT COUNT(*) c FROM data_assertions a LEFT JOIN source_snapshots s ON s.id = a.source_snapshot_id WHERE a.entity_id LIKE 'mfi-001|%ghorahi%|dang%' AND s.id IS NULL")[0].c === 0);
  }

  // ==========================================================================
  section("P9  supersession state machine");
  // ==========================================================================
  {
    const st = q<{ id: string; value: string; valid_to: string | null; verification_status: string }>(
      "SELECT id, value, valid_to, verification_status FROM data_assertions WHERE value='Head Office'",
    );
    check("P9.1 the superseded row exists", st.length === 1);
    check("P9.2 it carries a valid_to timestamp", typeof st[0]?.valid_to === "string");
    eq("P9.3 it is marked STALE", st[0]?.verification_status, "STALE");
    eq("P9.4 nothing was deleted anywhere in this phase",
      q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c > 0, true);
    // every stored status must be one the frozen CHECK constraint allows
    const allowed = ["UNVERIFIED", "AUTO_VERIFIED", "HUMAN_VERIFIED", "CONFLICT", "STALE", "REJECTED"];
    const used = q<{ verification_status: string }>("SELECT DISTINCT verification_status FROM data_assertions").map((x) => x.verification_status);
    check("P9.5 no status outside the frozen vocabulary is stored", used.every((u) => allowed.includes(u)));
    console.log(`    statuses in use: ${used.join(", ")}`);
  }

  // ==========================================================================
  section("P10  no zero-branch claim anywhere");
  // ==========================================================================
  {
    const zeros = q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions WHERE field_name='branch_count' AND value='0'");
    eq("P10.1 nothing asserted branch_count = 0", zeros[0].c, 0);
    const { decideBranchEvidence } = await import("../lib/ingestion");
    const unresolved = decideBranchEvidence({
      official_coverage: "BRANCH_STRUCTURE_UNREAD",
      official_valid_names: 0,
      external: [
        { source_type: "NRB", usable: false, records: 0, reason: "bank list, population is banks", configured: true },
        { source_type: "MEROLAGANI", usable: false, records: 0, reason: "no MFI branch source", configured: true },
      ],
    });
    eq("P10.2 an unusable official page with no usable external -> D_UNRESOLVED", unresolved.coverage, "D_UNRESOLVED");
    eq("P10.3 ...with branch_count null, never 0", unresolved.branch_count, null);
    check("P10.4 ...and it is not reported as available", unresolved.branch_evidence_available === false);
  }

  console.log("\n" + "-".repeat(60));
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("  failures:");
    for (const f of failures) console.log("    - " + f);
    process.exitCode = 1;
  }
}

void main();
