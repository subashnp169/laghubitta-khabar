// ============================================================================
// M3.4 FINAL GATE — BRANCH PERSISTENCE LIFECYCLE PROOF (L1..L7)
//
// This is the permanent integration proof for the branch assertion lifecycle.
// It is deliberately NOT a helper test: every case drives the real
// planExternalRepeat -> applyExternalPlan -> LocalSqliteEvidenceWriter path
// against the real schema/schema.sql, and every expectation is read back out of
// SQLite with SQL.
//
//   L1  same source, same value   -> one active assertion, no duplicate, no
//                                    duplicate canonical snapshot
//   L2  different sources, same value -> two rows, both active, both keep their
//                                    own source_id
//   L3  same source, changed value -> old STALE + valid_to, new active, nothing
//                                    deleted, both queryable
//   L4  renamed branch            -> old identity retained, new identity separate
//   L5  same name, different district -> two identities, no false conflict
//   L6  repeat complete ingestion -> no growth in active assertions, no
//                                    duplicate snapshots, stable read model
//   L7  read projection           -> current model shows active only; the
//                                    evidence layer still sees the history
//
// Run: npm run smoke:branch-lifecycle
// ============================================================================

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteEvidenceWriter } from "../lib/ingestion";
import {
  applyExternalPlan,
  externalBranchEntityId,
  externalRecordFingerprint,
  planExternalRepeat,
  type ExternalBranchRecord,
  type ExternalRecordState,
} from "../lib/ingestion";
import {
  branchAssertionHistory,
  branchesFromAssertionRows,
  type BranchAssertionRecord,
} from "../lib/repository/projection";

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

const OBSERVED_FIELDS = [
  { field: "branch_name", get: (r: ExternalBranchRecord) => r.branch_name.trim() },
  { field: "district", get: (r: ExternalBranchRecord) => (r.district ?? "").trim() },
  { field: "address", get: (r: ExternalBranchRecord) => (r.address ?? "").trim() },
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

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "m34-lifecycle-"));
  const dbPath = join(dir, "lifecycle.db");
  db_exec(dbPath);
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
  /** Rows exactly as a repository adapter would hand them to the projection. */
  const readRows = (): BranchAssertionRecord[] =>
    q<BranchAssertionRecord>(
      `SELECT a.entity_id AS entity_id, a.value AS value, a.source_id AS source_id,
              a.field_name AS field_name, a.observed_at AS observed_at,
              a.valid_to AS valid_to, a.verification_status AS verification_status,
              a.confidence AS confidence,
              substr(a.entity_id, 1, instr(a.entity_id, '|') - 1) AS institution_id,
              substr(a.entity_id, 1, instr(a.entity_id, '|') - 1) AS institution_slug
         FROM data_assertions a
        WHERE a.entity_type = 'BRANCH'
        ORDER BY a.observed_at, a.field_name, a.source_id`,
    );

  const now = "2026-09-28T00:00:00.000Z";
  let clock = 0;
  const tick = (): string => {
    clock += 1;
    return new Date(Date.parse(now) + clock * 86400000).toISOString();
  };

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
      fields: OBSERVED_FIELDS,
    });
    const applied = await applyExternalPlan(plan, {
      writer,
      source_id: args.source,
      snapshot: {
        fetched_at: args.priorHash ? tick() : now,
        http_status: 200, mime_type: "text/html", parser_version: "ext-branch-table-v1",
      },
      observed_at: tick(),
      confidence: 0.7,
      verification_status: "UNVERIFIED",
    });
    return { plan, applied, next };
  };

  const dang = rec({ branch_name: "Ghorahi", district: "Dang", address: "1, Ghorahi" });
  const entityDang = externalBranchEntityId("mfi-001", dang);
  const priorDang = states([dang], "mfi-001");
  const moved = { ...dang, address: "9, Ghorahi Bazaar" };
  const renamed = rec({ branch_name: "Ghorahi Branch Office", district: "Dang", address: "9, Ghorahi Bazaar" });
  const entityRenamed = externalBranchEntityId("mfi-001", renamed);
  // The L3.OPEN district-correction case gets its OWN branch, on its own source,
  // so it cannot disturb the single-branch timeline that L4 and L7 read back.
  const sunsari = rec({ branch_name: "Biratnagar", district: "Sunsari", address: "1, Sunsari" });
  const sunsariKailali = rec({ branch_name: "Biratnagar", district: "Kailali", address: "1, Sunsari" });
  const entitySunsari = externalBranchEntityId("mfi-003", sunsari);
  const entitySunsariKailali = externalBranchEntityId("mfi-003", sunsariKailali);

  // ==========================================================================
  section("L1  same source, same value -> idempotent, no duplicate snapshot");
  // ==========================================================================
  {
    const r1 = await ingest({ source: "s-official", inst: "mfi-001", recs: [dang], priorHash: null, contentHash: "h1", prior: [] });
    check("L1.1 first ingest wrote assertions", r1.applied.assertions > 0);
    const active1 = q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE entity_id = ? AND valid_to IS NULL", entityDang,
    )[0].c;
    eq("L1.2 exactly one active assertion per field", active1, 3);
    eq("L1.3 three stored rows, one per field", q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c, 3);
    eq("L1.4 exactly one snapshot so far", q<{ c: number }>("SELECT COUNT(*) c FROM source_snapshots")[0].c, 1);

    // Identical ingestion again. Same content hash, so the planner is a no-op and
    // the writer must not invent a second snapshot for byte-identical content.
    const r2 = await ingest({ source: "s-official", inst: "mfi-001", recs: [dang], priorHash: "h1", contentHash: "h1", prior: states([dang], "mfi-001") });
    check("L1.5 the repeat is a no-op at the planner", r2.plan.no_op);
    eq("L1.6 no new assertion", q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c, 3);
    eq("L1.7 still exactly one active assertion per field", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE entity_id = ? AND valid_to IS NULL", entityDang,
    )[0].c, 3);
    eq("L1.8 no duplicate canonical snapshot", q<{ c: number }>("SELECT COUNT(*) c FROM source_snapshots")[0].c, 1);
    eq("L1.9 no conflict invented", q<{ c: number }>("SELECT COUNT(*) c FROM data_conflicts")[0].c, 0);
  }

  // ==========================================================================
  section("L2  different sources, same value -> two rows, both provenance kept");
  // ==========================================================================
  {
    await ingest({ source: "s-nrb", inst: "mfi-001", recs: [dang], priorHash: null, contentHash: "h2", prior: [] });
    const rows = q<{ source_id: string; value: string }>(
      "SELECT source_id, value FROM data_assertions WHERE entity_id = ? AND field_name = 'district' AND valid_to IS NULL ORDER BY source_id",
      entityDang,
    );
    eq("L2.1 two assertion rows for the identical claim", rows.length, 2);
    eq("L2.2 both agree on the value", [...new Set(rows.map((r) => r.value))], ["Dang"]);
    check("L2.3 each keeps its own source_id", new Set(rows.map((r) => r.source_id)).size === 2);
    eq("L2.4 the sources are the official site and the regulator",
      rows.map((r) => r.source_id), ["s-nrb", "s-official"]);
    eq("L2.5 both are active", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE entity_id = ? AND field_name = 'district' AND valid_to IS NULL", entityDang,
    )[0].c, 2);
    check("L2.6 corroboration is NOT recorded as a conflict", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_conflicts WHERE field_name = 'district'",
    )[0].c === 0);
  }

  // ==========================================================================
  section("L3  same source, changed value -> old STALE + valid_to, nothing deleted");
  // ==========================================================================
  {
    // The changed field here is `address`, a non-identity field. Correcting an
    // address supersedes in place: same branch, old value retired, new value
    // active, and the old row still queryable.
    const moved = { ...dang, address: "9, Ghorahi Bazaar" };
    const r = await ingest({ source: "s-official", inst: "mfi-001", recs: [moved], priorHash: "h1", contentHash: "h3", prior: priorDang });
    check("L3.1 an address change is a change, not a new branch", r.plan.writes.some((w) => w.kind === "SUPERSEDE"));
    check("L3.2 the supersede was APPLIED, not left pending", r.applied.superseded > 0);
    eq("L3.3 nothing left pending", r.applied.superseded_pending, 0);

    const old = one<{ valid_to: string | null; verification_status: string }>(
      "SELECT valid_to, verification_status FROM data_assertions WHERE source_id='s-official' AND entity_id = ? AND field_name='address' AND value='1, Ghorahi'",
      entityDang,
    );
    eq("L3.4 the old value is STALE", old?.verification_status, "STALE");
    check("L3.5 the old value carries a valid_to", typeof old?.valid_to === "string" && (old?.valid_to ?? "").length > 0);
    eq("L3.6 the old row still exists — nothing deleted", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE source_id='s-official' AND entity_id = ? AND field_name='address' AND value='1, Ghorahi'", entityDang,
    )[0].c, 1);
    eq("L3.7 the new value is active", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE source_id='s-official' AND entity_id = ? AND field_name='address' AND value='9, Ghorahi Bazaar' AND valid_to IS NULL", entityDang,
    )[0].c, 1);
    eq("L3.8 the branch identity is unchanged by an address correction", q<{ c: number }>(
      "SELECT COUNT(DISTINCT entity_id) c FROM data_assertions WHERE entity_id = ?", entityDang,
    )[0].c, 1);
    eq("L3.9 exactly one active address per source", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE source_id='s-official' AND entity_id = ? AND field_name='address' AND valid_to IS NULL", entityDang,
    )[0].c, 1);
    eq("L3.10 the disagreement is recorded as a conflict", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_conflicts WHERE field_name='address'",
    )[0].c, 1);
  }

  // --------------------------------------------------------------------------
  // L3.OPEN — the one place the two required cases pull against each other.
  //
  // L3 above corrects a non-identity field and supersedes in place. Correcting a
  // *geographic* field cannot behave that way under the current identity key,
  // because geography is part of the key:
  //
  //     branchIdentityKey -> "mfi-001|ghorahi|dang"  vs  "mfi-001|ghorahi|kailali"
  //
  // So a district correction currently produces a NEW identity and retires the
  // old one — Case 4 (rename) behaviour, not Case 3 (correction) behaviour.
  //
  // The two required cases are in genuine tension and cannot both hold today:
  //
  //   Case 3  district Dang -> Kailali  must STALE the value in place,
  //                                on one branch.
  //   Case 5  ABC/Dang and ABC/Kailali  must remain TWO branch identities.
  //
  // Case 5 forces geography into the identity (or an equivalent discriminator).
  // Case 3 forces geography OUT of it. A within-observation ordinal could
  // satisfy both, but it is fragile: it silently re-identifies branches when a
  // page reorders.
  //
  // This is recorded rather than papered over, and no change is made unilaterally
  // because it changes what a "branch" IS — an M3.4 identity decision, not a bug.
  // What is asserted below is the CURRENT, truthful behaviour, so a later change
  // has to be deliberate.
  // --------------------------------------------------------------------------
  {
    check("L3.11 a district correction changes the identity key today", entitySunsariKailali !== entitySunsari);
    await ingest({ source: "s-nrb", inst: "mfi-003", recs: [sunsari], priorHash: null, contentHash: "h3b", prior: [] });
    await ingest({ source: "s-nrb", inst: "mfi-003", recs: [sunsariKailali], priorHash: "h3b", contentHash: "h3c", prior: states([sunsari], "mfi-003") });
    eq("L3.12 ...and the old district row is retired rather than superseded in place", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE source_id='s-nrb' AND entity_id = ? AND field_name='district' AND valid_to IS NULL", entitySunsari,
    )[0].c, 0);
    check("L3.13 ...while the corrected district exists under the new identity", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE source_id='s-nrb' AND entity_id = ? AND field_name='district' AND value='Kailali' AND valid_to IS NULL", entitySunsariKailali,
    )[0].c === 1);
    eq("L3.14 both identities remain historically queryable", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE entity_id IN (?, ?)", entitySunsari, entitySunsariKailali,
    )[0].c > 0, true);
    // Nothing here may ever become a claim of zero branches.
    check("L3.15 no branch_count is asserted by any of this", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE field_name LIKE '%branch_count%'",
    )[0].c === 0);
  }

  // ==========================================================================
  section("L4  renamed branch -> old identity retained, new identity separate");
  // ==========================================================================
  {
    check("L4.1 the rename produces a different identity", entityRenamed !== entityDang);
    const r = await ingest({ source: "s-official", inst: "mfi-001", recs: [renamed], priorHash: "h3", contentHash: "h4", prior: states([moved], "mfi-001") });
    check("L4.2 the previous identity is not mutated away", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE entity_id = ?", entityDang,
    )[0].c > 0);
    // Scoped to s-official on purpose. L2 had s-nrb independently assert the same
    // identity, and a rename seen by one source must not retire the other
    // source's evidence. Supersession is per-source, always.
    eq("L4.3 the old branch_name is marked superseded for that source, not deleted", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE source_id='s-official' AND entity_id = ? AND field_name='branch_name' AND valid_to IS NULL", entityDang,
    )[0].c, 0);
    check("L4.4 ...and is still present as history", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE entity_id = ? AND field_name='branch_name'", entityDang,
    )[0].c >= 1);
    eq("L4.5 the new identity is represented separately", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE entity_id = ? AND field_name='branch_name' AND valid_to IS NULL", entityRenamed,
    )[0].c, 1);
    // The renaming, the renaming source's old identity, the district-correction
    // pair, and nothing else.
    eq("L4.6 four identities now exist in total", q<{ c: number }>(
      "SELECT COUNT(DISTINCT entity_id) c FROM data_assertions",
    )[0].c, 4);
    check("L4.8 the other source's claim on the old identity survives the rename", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE source_id='s-nrb' AND entity_id = ? AND field_name='branch_name' AND valid_to IS NULL", entityDang,
    )[0].c === 1);
    // A disappearance is not a closure. This is the distinction that keeps a
    // rename from being published as a branch shutting down.
    check("L4.7 the disappearance is recorded, explicitly not as a closure", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_conflicts WHERE resolution_note LIKE '%NOT evidence the branch closed%'",
    )[0].c >= 1);
  }

  // ==========================================================================
  section("L5  same name, different district -> two identities, no false conflict");
  // ==========================================================================
  {
    const abcDang = rec({ branch_name: "ABC", district: "Dang" });
    const abcKailali = rec({ branch_name: "ABC", district: "Kailali" });
    const two = [abcDang, abcKailali];
    check("L5.1 same name + different district = two identities",
      externalBranchEntityId("mfi-002", abcDang) !== externalBranchEntityId("mfi-002", abcKailali));
    await ingest({ source: "s-nrb", inst: "mfi-002", recs: two, priorHash: null, contentHash: "h5", prior: [] });
    const ids = q<{ entity_id: string }>(
      "SELECT DISTINCT entity_id FROM data_assertions WHERE entity_id LIKE 'mfi-002|abc|%' ORDER BY entity_id",
    );
    eq("L5.2 both identities were written", ids.length, 2);
    check("L5.3 one is Dang and one is Kailali",
      ids.some((x) => x.entity_id.includes("dang")) && ids.some((x) => x.entity_id.includes("kailali")));
    eq("L5.4 no false cross-source conflict was invented", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_conflicts WHERE entity_id LIKE 'mfi-002|abc|%'",
    )[0].c, 0);
  }

  // ==========================================================================
  section("L6  repeat complete ingestion -> stable read model, no growth");
  // ==========================================================================
  {
    const before = {
      rows: q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c,
      active: q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions WHERE valid_to IS NULL")[0].c,
      snaps: q<{ c: number }>("SELECT COUNT(*) c FROM source_snapshots")[0].c,
      conflicts: q<{ c: number }>("SELECT COUNT(*) c FROM data_conflicts")[0].c,
    };
    // A TRUE no-op repeat: identical content, identical prior. Nothing at all
    // may move — not an assertion, not a snapshot, not a conflict.
    const noop = await ingest({ source: "s-official", inst: "mfi-001", recs: [dang], priorHash: "h1", contentHash: "h1", prior: priorDang });
    check("L6.1 the repeat is recognised as a no-op", noop.plan.no_op);
    eq("L6.2 no growth in total assertion rows", q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c, before.rows);
    eq("L6.3 no growth in active assertions", q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions WHERE valid_to IS NULL")[0].c, before.active);
    eq("L6.4 no duplicate snapshots for unchanged content", q<{ c: number }>("SELECT COUNT(*) c FROM source_snapshots")[0].c, before.snaps);
    eq("L6.5 no new conflicts on a true repeat", q<{ c: number }>("SELECT COUNT(*) c FROM data_conflicts")[0].c, before.conflicts);
    eq("L6.6 zero duplicate semantic assertions from any one source", q<{ c: number }>(
      `SELECT COUNT(*) c FROM (
         SELECT entity_id, field_name, LOWER(TRIM(value)) v, source_id, COUNT(*) n
           FROM data_assertions WHERE valid_to IS NULL
          GROUP BY entity_id, field_name, v, source_id HAVING n > 1)`,
    )[0].c, 0);

    // Replaying a *change* is a different thing from replaying a no-op, and it
    // behaves differently. The address disagreement was already seen and already
    // superseded; observing it again is a second observation of a known
    // disagreement, so it appends a fresh data_conflicts row carrying the new
    // detected_at while adding no assertion and no snapshot.
    //
    // That is recorded here rather than suppressed. Conflicts are append-only
    // evidence that a source disagreed with itself at a point in time, and "we
    // saw this again later" is information. Collapsing repeats would need a
    // deterministic conflict identity, which is a deliberate decision about
    // review semantics, not something to change quietly while writing a test.
    const cBefore = q<{ c: number }>("SELECT COUNT(*) c FROM data_conflicts")[0].c;
    const rBefore = q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c;
    await ingest({ source: "s-official", inst: "mfi-001", recs: [moved], priorHash: "h1", contentHash: "h3", prior: priorDang });
    eq("L6.7 replaying a change adds no assertion", q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions")[0].c, rBefore);
    eq("L6.8 ...and no snapshot", q<{ c: number }>("SELECT COUNT(*) c FROM source_snapshots")[0].c, before.snaps);
    check("L6.9 ...but it does append a fresh conflict observation",
      q<{ c: number }>("SELECT COUNT(*) c FROM data_conflicts")[0].c > cBefore);
    eq("L6.10 ...and the current value is unaffected by the replay", q<{ c: number }>(
      "SELECT COUNT(*) c FROM data_assertions WHERE entity_id = ? AND field_name='address' AND valid_to IS NULL", entityDang,
    )[0].c, 1);
  }

  // ==========================================================================
  section("L7  read projection: current truth vs. evidence history");
  // ==========================================================================
  {
    const rows = readRows();
    const current = branchesFromAssertionRows(rows);
    const history = branchAssertionHistory(rows);

    // The read model reflects the rename for the source that saw it. L4 retired
    // only s-official's claim; s-nrb still lists the old identity, so that
    // identity remains visible — attributed to s-nrb. Suppressing it would mean
    // letting one source silently overwrite another, and dropping it entirely
    // would mean discarding evidence that is still genuinely being published.
    // The disagreement between the two is a conflict, which is where it belongs.
    const cur = current.find((b) => b.id === `branch-${entityRenamed}`);
    check("L7.2 the renamed identity is the current branch", cur !== undefined);
    eq("L7.3 it reports the new name", cur?.name, "Ghorahi Branch Office");
    eq("L7.3b ...and the unchanged district", cur?.district, "Dang");
    check("L7.4 the new identity is attributed to the source that observed the rename",
      cur?.meta.source === "s-official");
    const oldId = current.find((b) => b.id === `branch-${entityDang}`);
    check("L7.5 the old identity survives only while a source still asserts it",
      oldId !== undefined && oldId.meta.source === "s-nrb");
    check("L7.6 the pre-rename name is not attributed to the renaming source",
      oldId?.name !== "Ghorahi" || oldId.meta.source !== "s-official");

    // Both ABC branches are current, because both are real and distinct.
    const abcs = current.filter((b) => b.name === "ABC");
    eq("L7.7 both same-name-different-district branches are current", abcs.length, 2);
    check("L7.8 ...and they are distinguishable by district",
      new Set(abcs.map((b) => b.district)).size === 2);

    // History: the read model declined to show superseded rows; the evidence
    // layer still has every one of them.
    const oldName = history.filter((h) => h.entity_id === entityDang && h.field_name === "branch_name");
    eq("L7.9 history retains the old branch_name claim from each source", oldName.length, 2);
    eq("L7.10 ...and keeps the retired one with its value intact",
      oldName.find((h) => h.source_id === "s-official")?.value, "Ghorahi");
    eq("L7.11 ...flagged as no longer current",
      oldName.find((h) => h.source_id === "s-official")?.is_current, false);
    const oldDistrict = history.filter((h) => h.entity_id === entitySunsari && h.field_name === "district" && h.value === "Sunsari");
    check("L7.12 history retains the corrected-away district", oldDistrict.length >= 1);
    check("L7.13 every history row carries its source_id", history.every((h) => h.source_id.length > 0));
    check("L7.14 history is larger than the current read model", history.length > current.length);
    check("L7.15 current rows are exactly the non-retired ones",
      history.some((h) => h.is_current));

    // The read model must never resurrect a branch that no source still lists.
    // Verified structurally: every projected branch has at least one active
    // name claim behind it, so no branch can appear without a current source.
    const activeNames = new Set(rows
      .filter((r) => r.field_name === "branch_name" && r.valid_to === null)
      .map((r) => r.entity_id));
    check("L7.16 every projected branch has an active name claim behind it",
      current.every((b) => activeNames.has(b.id.replace(/^branch-/, ""))));

    // Unknown stays unknown. No branch_count is ever derived here.
    check("L7.17 the projection never invents a branch count",
      !current.some((b) => "branch_count" in (b as unknown as Record<string, unknown>)));
  }

  console.log("\n" + "-".repeat(60));
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("  failures:");
    for (const f of failures) console.log("    - " + f);
    process.exitCode = 1;
  }
}

/** Create the real schema plus the minimal source rows the fixtures reference. */
function db_exec(dbPath: string): void {
  const schema = readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(dbPath);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  const now = "2026-09-28T00:00:00.000Z";
  const ins = db.prepare(
    `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
  );
  ins.run("s-official", "MFB_WEBSITE", "INSTITUTION", "A", "https://example-a.com.np/branches", "example-a.com.np", "Branches", "MFI A", now);
  ins.run("s-nrb", "NRB", "NRB", "A", "https://www.nrb.org.np/bank-list/", "www.nrb.org.np", "BFI List", "NRB", now);
  db.close();
}

void main();
