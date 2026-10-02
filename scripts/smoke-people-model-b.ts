// ============================================================================
// M3.6A — PEOPLE UNDER THE SOURCE-OWNED OBSERVATION MODEL (T1..T5 + matrix)
//
// This is the permanent proof that People operates on the canonical Model B:
// data_assertions rows are SOURCE-OWNED OBSERVATIONS, corroboration is DERIVED
// from the sources that currently hold a claim, and disagreement is represented
// without collapsing either side.
//
// It is deliberately NOT a helper test. Every case drives the real
// LocalSqliteEvidenceWriter against the real schema/schema.sql, and every
// expectation is read back out of SQLite with SQL or through the real
// peopleFromAssertionRows projection the D1 adapter and the public API both use.
//
// The controlled timeline is the one the STOP-3 investigation proved Model A
// could not represent — A->X, B->X, A->Y — because the interesting state is not
// "two rows" but "two owners of one claim, then one of them changes its mind":
//
//   T1  A -> X              one source-owned observation, no corroboration yet
//   T2  B -> X              TWO rows for one claim; corroboration derived = 2;
//                            still NO conflict, because agreement is not dispute
//   T3  A -> Y              A's X retired, A's Y current, B's X untouched and
//                            still current; cross-source disagreement recorded
//                            with BOTH sides and their owners attributed
//   T4  B stops reporting X B's X retired; A's Y still current; the source-scoped
//                            "what does B say now" answer is empty; no live
//                            disagreement is detected any more
//   T5  B reports X again   B's own row is REVIVED, not duplicated; A is
//                            untouched; the dispute is detectable again
//
// Then the required matrix: same source + same value, different sources + same
// value, different sources + different values, one source changing while the
// other holds, one source going stale while the other holds, revival, repeated
// same-source ingestion, source-scoped lookup, public deduplication, provenance
// recovery, cross-source conflict detection, and no orphan assertions.
//
// Run: npm run smoke:people-model-b
// ============================================================================

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LocalSqliteEvidenceWriter,
  applyPeopleEvidence,
  currentPeopleClaimsForSource,
  flagPeopleConflicts,
  listOpenConflicts,
  planPeopleEvidence,
  type PeopleClaim,
} from "../lib/ingestion";
import { peopleFromAssertionRows, type PersonAssertionRecord } from "../lib/repository/projection";

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
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    pass += 1;
    console.log("  ok   " + name);
  } else {
    fail += 1;
    failures.push(name);
    console.log("  FAIL " + name + (detail !== undefined ? `  (${JSON.stringify(detail)})` : ""));
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name + (g === w ? "" : `  (got ${g}, want ${w})`), g === w);
}
function section(t: string): void {
  console.log("\n" + t);
}

const INSTITUTION_ID = "mfi-people-modelb";
const INSTITUTION_ID_2 = "mfi-people-modelb-2";
const INSTITUTION_SLUG = "fixture-people-model-b";
const SRC_A = "src-a-official";
const SRC_B = "src-b-regulator";
const CEO = "people_ceo";
const CHAIR = "people_chair";
const X = "Anita Gurung";
const Y = "Keshav Raj Paudel";

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "m36a-people-"));
  const dbPath = join(dir, "people-model-b.db");
  seedDb(dbPath);
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

  /** Every stored claim for a people field, retired ones included. */
  type ClaimRow = { id: string; source_id: string; value: string; observed_at: string; valid_to: string | null; verification_status: string; source_snapshot_id: string | null };
  const allClaims = (field: string): ClaimRow[] =>
    q<ClaimRow>(
      `SELECT id, source_id, value, observed_at, valid_to, verification_status, source_snapshot_id
         FROM data_assertions
        WHERE entity_type = 'institution' AND entity_id = ? AND field_name = ?
        ORDER BY source_id, observed_at, id`,
      INSTITUTION_ID,
      field,
    );
  /** Only the claims that are still current, i.e. what the read model may publish. */
  const currentClaims = (field: string): ClaimRow[] => allClaims(field).filter((r) => r.valid_to === null);

  /**
   * Corroboration is DERIVED, never stored: count the distinct sources that
   * currently hold the claim. This is the number a reader is told about.
   */
  const corroboration = (field: string, value: string): number =>
    currentClaims(field).filter((r) => r.value === value).length;

  /** Rows exactly as the repository adapters hand them to the projection. */
  const readPeopleRows = (): PersonAssertionRecord[] =>
    q<PersonAssertionRecord>(
      `SELECT a.entity_id AS institution_id, ? AS institution_slug, 'Fixture People Model B' AS institution_name,
              a.field_name AS field_name, a.value AS value, a.source_id AS source_id,
              s.url AS source_url, a.observed_at AS observed_at,
              a.valid_to AS valid_to, a.verification_status AS verification_status,
              a.confidence AS confidence
         FROM data_assertions a
         LEFT JOIN sources s ON s.id = a.source_id
        WHERE a.entity_type = 'institution' AND a.entity_id = ? AND a.field_name LIKE 'people_%'
        ORDER BY a.field_name, a.value, a.source_id`,
      INSTITUTION_SLUG,
      INSTITUTION_ID,
    );
  /** Open conflict keys, shaped exactly as lib/repository/d1.ts builds them. */
  const openKeys = (): Set<string> => {
    const keys = new Set<string>();
    for (const c of listOpenConflicts(dbPath, INSTITUTION_ID)) {
      for (const f of c.fieldName.split("|")) keys.add(`${c.institutionId}|${f}`);
    }
    return keys;
  };
  const project = () => peopleFromAssertionRows(readPeopleRows(), { openConflictKeys: openKeys() });

  let clock = 0;
  const at = (): string => {
    clock += 1;
    return new Date(Date.parse("2026-10-01T00:00:00Z") + clock * 86400000).toISOString();
  };

  /** One page, read from one source, stored as its own snapshot. */
  const observe = async (sourceId: string, claims: PeopleClaim[], observedFields: string[], institutionId = INSTITUTION_ID) => {
    const observedAt = at();
    const snapshotId = await writer.saveSnapshot({
      sourceId,
      fetchedAt: observedAt,
      contentHash: `content-${sourceId}-${clock}`,
      httpStatus: 200,
      mimeType: "text/html",
      r2Key: null,
      parserVersion: "people-model-b-v1",
      extractionStatus: "EXTRACTED",
    });
    const plan = await planPeopleEvidence(writer, { institutionId, observedFields, claims }, sourceId);
    const applied = await applyPeopleEvidence(writer, plan, {
      sourceId,
      sourceSnapshotId: snapshotId,
      observedAt,
      runId: `run-${sourceId}-${clock}`,
    });
    return applied;
  };
  const claim = (fieldName: string, value: string): PeopleClaim => ({ fieldName, value, confidence: 0.7 });

  // ==========================================================================
  section("T1  A -> X : one source-owned observation, no corroboration yet");
  // ==========================================================================
  let bXId = "";
  {
    const applied = await observe(SRC_A, [claim(CEO, X)], [CEO]);
    eq("T1.1 the observation wrote one new claim", applied.newCount, 1);
    const rows = currentClaims(CEO);
    eq("T1.2 exactly one CURRENT claim exists", rows.length, 1);
    eq("T1.3 it is owned by A", rows[0].source_id, SRC_A);
    eq("T1.4 its value is X", rows[0].value, X);
    eq("T1.5 derived corroboration is 1 source", corroboration(CEO, X), 1);
    eq("T1.6 no conflict can exist yet", q("SELECT COUNT(*) c FROM data_conflicts")[0].c, 0);
    const people = project();
    eq("T1.7 the read model publishes one person", people.length, 1);
    eq("T1.8 with exactly one supporting source", people[0].meta.sources, [SRC_A]);
    bXId = rows[0].id;
  }

  // ==========================================================================
  section("T2  B -> X : two source-owned rows, corroboration derived, no conflict");
  // ==========================================================================
  {
    const applied = await observe(SRC_B, [claim(CEO, X)], [CEO]);
    eq("T2.1 B's observation added its own row", applied.newCount, 1);
    const rows = currentClaims(CEO);
    eq("T2.2 two current rows for ONE normalized claim", rows.length, 2);
    eq("T2.3 both hold the same value", [...new Set(rows.map((r) => r.value))], [X]);
    eq("T2.4 each keeps its OWN source_id", rows.map((r) => r.source_id), [SRC_A, SRC_B]);
    check("T2.5 each row is anchored to its own snapshot", new Set(rows.map((r) => r.source_snapshot_id)).size === 2, rows.map((r) => r.source_snapshot_id));
    eq("T2.6 corroboration is DERIVED from the two current owners", corroboration(CEO, X), 2);
    eq("T2.7 corroboration is NOT recorded as a conflict", q("SELECT COUNT(*) c FROM data_conflicts")[0].c, 0);
    eq("T2.8 the conflict detector agrees", flagPeopleConflicts(dbPath, { now: at() }), 0);

    const people = project();
    eq("T2.9 the read model DEDUPLICATES the person", people.length, 1);
    eq("T2.10 the person names both supporting sources", people[0].meta.sources, [SRC_A, SRC_B]);
    eq("T2.11 and reports corroboration of 2", people[0].meta.sources.length, 2);
    check("T2.12 provenance is recoverable per source", people[0].meta.source_url !== null && people[0].meta.source !== null);
    bXId = rows.find((r) => r.source_id === SRC_B)!.id;
  }

  // ==========================================================================
  section("T3  A -> Y : A's own claim is retired, B's X survives, dispute recorded");
  // ==========================================================================
  {
    const applied = await observe(SRC_A, [claim(CEO, Y)], [CEO]);
    eq("T3.1 A's new claim was written", applied.newCount, 1);
    eq("T3.2 A's X was retired, not deleted", allClaims(CEO).filter((r) => r.value === X && r.source_id === SRC_A)[0].valid_to !== null, true);
    eq("T3.3 the retired claim moved to STALE", allClaims(CEO).filter((r) => r.value === X && r.source_id === SRC_A)[0].verification_status, "STALE");

    const rows = currentClaims(CEO);
    eq("T3.4 exactly two claims are current", rows.length, 2);
    eq("T3.5 A now says Y", rows.find((r) => r.source_id === SRC_A)!.value, Y);
    eq("T3.6 B's X is untouched and still current", rows.find((r) => r.source_id === SRC_B)!.value, X);
    check("T3.7 B's row was NOT retired by A's change", rows.find((r) => r.source_id === SRC_B)!.valid_to === null);

    eq("T3.8 the apply step recorded the disagreement", applied.conflictCount, 1);
    const conflicts = q<{ field_name: string; source_a_id: string; value_a: string; source_b_id: string; value_b: string; resolution_status: string }>(
      "SELECT field_name, source_a_id, value_a, source_b_id, value_b, resolution_status FROM data_conflicts ORDER BY id",
    );
    eq("T3.9 exactly one OPEN conflict exists", conflicts.length, 1);
    eq("T3.10 it names the role field", conflicts[0].field_name, CEO);
    // The sides are unordered in storage; what matters is that the row names the
    // two DISPUTING owners and their two values, and never one source twice.
    const sides = [
      { source: conflicts[0].source_a_id, value: conflicts[0].value_a },
      { source: conflicts[0].source_b_id, value: conflicts[0].value_b },
    ];
    eq("T3.11 source attribution is preserved on both sides", sides.map((s) => s.source).sort(), [SRC_A, SRC_B]);
    eq("T3.12 each side carries its own value", sides.map((s) => s.value).sort(), [X, Y]);
    check("T3.13 the conflict is not a source disagreeing with itself", sides[0].source !== sides[1].source);
    eq("T3.14 and it is OPEN for a human to resolve", conflicts[0].resolution_status, "OPEN");

    const people = project();
    eq("T3.15 both claimants are published, neither invented", people.map((p) => p.name).sort(), [X, Y].sort());
    check("T3.16 both are degraded to CONFLICT", people.every((p) => p.meta.verification_status === "CONFLICT"), people.map((p) => [p.name, p.meta.verification_status]));
    eq("T3.17 neither claims the other's corroboration", people.find((p) => p.name === X)!.meta.sources, [SRC_B]);
    eq("T3.18 the dispute detector finds nothing new to add", flagPeopleConflicts(dbPath, { now: at() }), 0);
  }

  // ==========================================================================
  section("T4  B stops reporting X : B's claim goes stale, A's Y is unaffected");
  // ==========================================================================
  {
    const applied = await observe(SRC_B, [], [CEO]);
    eq("T4.1 nothing new was written", applied.newCount, 0);
    eq("T4.2 exactly one claim was retired", applied.supersededCount, 1);

    const bX = allClaims(CEO).find((r) => r.source_id === SRC_B && r.value === X)!;
    check("T4.3 B's X is now retired (valid_to stamped)", bX.valid_to !== null);
    eq("T4.4 and marked STALE", bX.verification_status, "STALE");
    const aY = allClaims(CEO).find((r) => r.source_id === SRC_A && r.value === Y)!;
    check("T4.5 A's Y remains current", aY.valid_to === null);
    eq("T4.6 A's Y keeps its verification status", aY.verification_status, "UNVERIFIED");

    const rows = currentClaims(CEO);
    eq("T4.7 only A's claim is current now", rows.map((r) => `${r.source_id}:${r.value}`), [`${SRC_A}:${Y}`]);

    // Mandatory source-scoped query: "what does source B currently say?"
    const bNow = await currentPeopleClaimsForSource(writer, { institutionId: INSTITUTION_ID, fieldName: CEO, sourceId: SRC_B });
    eq("T4.8 source-scoped: B no longer claims X", bNow.map((r) => r.value), []);
    const aNow = await currentPeopleClaimsForSource(writer, { institutionId: INSTITUTION_ID, fieldName: CEO, sourceId: SRC_A });
    eq("T4.9 source-scoped: A still claims Y", aNow.map((r) => r.value), [Y]);
    const never = await currentPeopleClaimsForSource(writer, { institutionId: INSTITUTION_ID, fieldName: CHAIR, sourceId: SRC_B });
    eq("T4.10 source-scoped: a source that never observed the slot answers empty", never.length, 0);

    eq("T4.11 no live disagreement remains to be detected", flagPeopleConflicts(dbPath, { now: at() }), 0);
    eq("T4.12 the retired claim is still stored, with its value and owner", allClaims(CEO).filter((r) => r.value === X).length, 2);

    // The T3 conflict row is deliberately NOT deleted or auto-resolved: only a
    // human closes it. It is reported here so that behaviour is visible rather
    // than accidental.
    eq("T4.13 the historical conflict row survives for review", q("SELECT COUNT(*) c FROM data_conflicts WHERE resolution_status = 'OPEN'")[0].c, 1);
    const people = project();
    eq("T4.14 the retired X is no longer published as a current claim", people.map((p) => p.name), [Y]);
    eq("T4.15 and A is the only source supporting it", people[0].meta.sources, [SRC_A]);
  }

  // ==========================================================================
  section("T5  B reports X again : B's own row is revived, never duplicated");
  // ==========================================================================
  {
    const before = allClaims(CEO).length;
    const applied = await observe(SRC_B, [claim(CEO, X)], [CEO]);
    eq("T5.1 the value came back as a REVIVAL", applied.revivedCount, 1);
    eq("T5.2 no new row was inserted for it", applied.newCount, 0);
    eq("T5.3 the stored row count is unchanged", allClaims(CEO).length, before);

    const bX = allClaims(CEO).find((r) => r.source_id === SRC_B && r.value === X)!;
    eq("T5.4 the SAME row was revived", bX.id, bXId);
    check("T5.5 it is current again", bX.valid_to === null);
    eq("T5.6 and back to UNVERIFIED", bX.verification_status, "UNVERIFIED");

    const rows = currentClaims(CEO);
    eq("T5.7 both sources are current again", rows.map((r) => `${r.source_id}:${r.value}`).sort(), [`${SRC_A}:${Y}`, `${SRC_B}:${X}`].sort());
    const aY = allClaims(CEO).find((r) => r.source_id === SRC_A && r.value === Y)!;
    check("T5.8 A's claim was never disturbed by B's revival", aY.valid_to === null && aY.value === Y);
    const bNow = await currentPeopleClaimsForSource(writer, { institutionId: INSTITUTION_ID, fieldName: CEO, sourceId: SRC_B });
    eq("T5.9 source-scoped: B says X again", bNow.map((r) => r.value), [X]);

    eq("T5.10 the dispute is detectable again but adds no duplicate row", flagPeopleConflicts(dbPath, { now: at() }), 0);
    eq("T5.11 still exactly one OPEN conflict for the pair", q("SELECT COUNT(*) c FROM data_conflicts")[0].c, 1);
    const people = project();
    eq("T5.12 the read model publishes both claimants once each", people.map((p) => p.name).sort(), [X, Y].sort());
  }

  // ==========================================================================
  section("M1  same source + same value : idempotent, no unbounded duplicates");
  // ==========================================================================
  const Z = "Bimala Rai Paudel";
  {
    const first = await observe(SRC_A, [claim(CHAIR, Z)], [CHAIR]);
    const second = await observe(SRC_A, [claim(CHAIR, Z)], [CHAIR]);
    const third = await observe(SRC_A, [claim(CHAIR, Z)], [CHAIR]);
    eq("M1.1 first observation is NEW", first.newCount, 1);
    eq("M1.2 the repeats are UNCHANGED", [second.newCount, third.newCount], [0, 0]);
    eq("M1.3 still exactly ONE stored row for the claim", allClaims(CHAIR).length, 1);
    eq("M1.4 still exactly one current row", currentClaims(CHAIR).length, 1);
    // The lifecycle path recognises its own current claim and does not re-issue
    // the insert, so the re-sighting is carried by the apply audit entry rather
    // than by an ASSERTION_RESEEN row (which is the generic engine's INSERT OR
    // IGNORE path, proven separately by smoke-people-idempotency C5-C7).
    const reseen = q<{ after_json: string }>(
      "SELECT after_json FROM audit_logs WHERE action = 'PEOPLE_EVIDENCE_APPLIED' ORDER BY created_at DESC, id DESC LIMIT 1",
    )[0];
    check("M1.5 the re-sighting is audited with its owner and snapshot", (() => {
      const parsed = JSON.parse(reseen.after_json) as { source_id: string; source_snapshot_id: string; writes: Array<{ value: string; status: string }> };
      return parsed.source_id === SRC_A && parsed.source_snapshot_id !== null && parsed.writes.some((w) => w.value === Z && w.status === "UNCHANGED");
    })(), reseen);
    eq("M1.6 same source + same value is NOT a conflict", flagPeopleConflicts(dbPath, { now: at() }), 0);
  }

  // ==========================================================================
  section("M2  different sources + same value : two observations, no conflict");
  // ==========================================================================
  {
    await observe(SRC_B, [claim(CHAIR, Z)], [CHAIR]);
    const again = await observe(SRC_B, [claim(CHAIR, Z)], [CHAIR]);
    eq("M2.1 B's repeat stays idempotent", again.newCount, 0);
    const rows = currentClaims(CHAIR);
    eq("M2.2 two current rows, one per source", rows.length, 2);
    eq("M2.3 both name the same person", [...new Set(rows.map((r) => r.value))], [Z]);
    eq("M2.4 corroboration derived = 2 independent sources", corroboration(CHAIR, Z), 2);
    eq("M2.5 agreement between sources is never a conflict", q("SELECT COUNT(*) c FROM data_conflicts WHERE field_name = ?", CHAIR)[0].c, 0);

    const people = project();
    const zed = people.find((p) => p.name === Z)!;
    eq("M2.6 the public projection publishes the person ONCE", people.filter((p) => p.name === Z).length, 1);
    eq("M2.7 and exposes both sources as corroboration", zed.meta.sources, [SRC_A, SRC_B]);
    check("M2.8 provenance per source is recoverable", zed.meta.source !== null && zed.meta.source_url !== null);
  }

  // ==========================================================================
  section("M3  a source disagreeing with ITSELF is a page artifact, not a dispute");
  // ==========================================================================
  // Deliberately on its own institution: a second institution is also holding a
  // competing chair claim further down this script, and a self-disagreement can
  // only be observed in isolation from a real cross-source one.
  {
    await observe(SRC_A, [claim(CHAIR, "Sunita Poudel"), claim(CHAIR, "Mohan Karki")], [CHAIR], INSTITUTION_ID_2);
    const rows = q<{ source_id: string; value: string }>(
      "SELECT source_id, value FROM data_assertions WHERE entity_id = ? AND field_name = ? AND valid_to IS NULL ORDER BY value",
      INSTITUTION_ID_2,
      CHAIR,
    );
    eq("M3.1 A's own page holding two chairs is stored as two claims", rows.length, 2);
    eq("M3.2 both are its own", rows.map((r) => r.source_id), [SRC_A, SRC_A]);
    eq("M3.3 no conflict is invented for a source disagreeing with itself", flagPeopleConflicts(dbPath, { institutionId: INSTITUTION_ID_2, now: at() }), 0);

    // The moment a SECOND source disagrees, the same two-chair page becomes a
    // genuine cross-source dispute, attributed to the two owners. It is recorded
    // as the observation is written, so the detector has nothing left to add.
    await observe(SRC_B, [claim(CHAIR, "Dipesh Karki")], [CHAIR], INSTITUTION_ID_2);
    const pairs = q<{ source_a_id: string; source_b_id: string; value_a: string; value_b: string }>(
      "SELECT source_a_id, source_b_id, value_a, value_b FROM data_conflicts WHERE entity_id = ? ORDER BY id",
      INSTITUTION_ID_2,
    );
    check("M3.4 a second source makes it a real dispute", pairs.length > 0);
    check("M3.5 every conflict there names two different sources", pairs.every((c) => c.source_a_id !== c.source_b_id), pairs);
    check("M3.6 and B is on one side of every dispute", pairs.every((c) => c.source_a_id === SRC_B || c.source_b_id === SRC_B), pairs);
    eq("M3.7 the detector adds no duplicate row", flagPeopleConflicts(dbPath, { institutionId: INSTITUTION_ID_2, now: at() }), 0);

    // The multi-holder slot stays readable as a roster, not as a contradiction.
    const secondKeys = new Set<string>();
    for (const c of listOpenConflicts(dbPath, INSTITUTION_ID_2)) {
      for (const f of c.fieldName.split("|")) secondKeys.add(`${INSTITUTION_ID_2}|${f}`);
    }
    const second = peopleFromAssertionRows(
      q<PersonAssertionRecord>(
        `SELECT a.entity_id AS institution_id, ? AS institution_slug, 'Fixture Two' AS institution_name,
                a.field_name AS field_name, a.value AS value, a.source_id AS source_id,
                NULL AS source_url, a.observed_at AS observed_at, a.valid_to AS valid_to,
                a.verification_status AS verification_status, a.confidence AS confidence
           FROM data_assertions a
          WHERE a.entity_type = 'institution' AND a.entity_id = ? AND a.field_name LIKE 'people_%'
          ORDER BY a.value, a.source_id`,
        "fixture-people-model-b-two",
        INSTITUTION_ID_2,
      ),
      { openConflictKeys: secondKeys },
    );
    eq("M3.8 all three chair claimants are published, none merged away", second.map((p) => p.name).sort(), ["Dipesh Karki", "Mohan Karki", "Sunita Poudel"].sort());
    check("M3.9 each is flagged CONFLICT while the dispute is open", second.every((p) => p.meta.verification_status === "CONFLICT"), second.map((p) => [p.name, p.meta.verification_status]));
  }

  // ==========================================================================
  section("M4  one source changes while the other holds : independence holds");
  // ==========================================================================
  {
    const bBefore = currentClaims(CHAIR).find((r) => r.source_id === SRC_B)!;
    // A republishes the chair slot with a different person. Only A's own chair
    // claim may be affected; B's is a separate observation and must not move.
    await observe(SRC_A, [claim(CHAIR, "Keshav Raj Paudel")], [CHAIR]);
    const bAfter = allClaims(CHAIR).find((r) => r.id === bBefore.id)!;
    check("M4.1 B's row was not touched by A's change", bAfter.valid_to === null && bAfter.observed_at === bBefore.observed_at);
    eq("M4.2 B still holds its own claim", bAfter.value, Z);

    // The disagreement is recorded as it is written, so it exists before any
    // detector runs, and A's previous chair claim was retired rather than kept.
    const chairConflicts = q<{ source_a_id: string; value_a: string; source_b_id: string; value_b: string }>(
      "SELECT source_a_id, value_a, source_b_id, value_b FROM data_conflicts WHERE field_name = ? ORDER BY id",
      CHAIR,
    );
    check("M4.3 the cross-source disagreement is recorded", chairConflicts.length > 0);
    check("M4.4 it names A and B, never one source twice", chairConflicts.every((c) => c.source_a_id !== c.source_b_id), chairConflicts);
    check("M4.5 with both disputed values", chairConflicts.some((c) => [c.value_a, c.value_b].includes(Z) && [c.value_a, c.value_b].includes("Keshav Raj Paudel")), chairConflicts);
    eq("M4.6 A's superseded chair claim is retired", allClaims(CHAIR).filter((r) => r.source_id === SRC_A && r.value === Z)[0].valid_to !== null, true);
    eq("M4.7 the detector adds no duplicate row for it", flagPeopleConflicts(dbPath, { now: at() }), 0);
  }

  // ==========================================================================
  section("M5  integrity : provenance retained, nothing deleted, no orphans");
  // ==========================================================================
  {
    const orphans = q<{ c: number }>(
      `SELECT COUNT(*) c FROM data_assertions a
        WHERE a.field_name LIKE 'people_%'
          AND (a.source_snapshot_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM source_snapshots s WHERE s.id = a.source_snapshot_id))`,
    )[0].c;
    eq("M5.1 every people assertion is anchored to a stored snapshot", orphans, 0);

    const noSource = q<{ c: number }>(
      `SELECT COUNT(*) c FROM data_assertions a
        WHERE a.field_name LIKE 'people_%'
          AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.id = a.source_id)`,
    )[0].c;
    eq("M5.2 every people assertion names a real owning source", noSource, 0);

    const retired = allClaims(CEO).filter((r) => r.valid_to !== null);
    check("M5.3 retired claims are retained with value, source and snapshot", retired.length > 0 && retired.every((r) => r.value.length > 0 && r.source_id.length > 0 && r.source_snapshot_id !== null));
    eq("M5.4 nothing was promoted out of UNVERIFIED", q<{ c: number }>("SELECT COUNT(*) c FROM data_assertions WHERE field_name LIKE 'people_%' AND verification_status IN ('HUMAN_VERIFIED','AUTO_VERIFIED')")[0].c, 0);
    const audits = one<{ c: number }>("SELECT COUNT(*) c FROM audit_logs WHERE action = 'PEOPLE_EVIDENCE_APPLIED'")!;
    check("M5.5 every applied observation is audited", Number(audits.c) >= 8, audits);
    const supersedeAudit = one<{ c: number }>("SELECT COUNT(*) c FROM audit_logs WHERE action = 'ASSERTION_SUPERSEDED'")!;
    check("M5.6 retirements are audited, not silent", Number(supersedeAudit.c) > 0, supersedeAudit);
    const reviveAudit = one<{ c: number }>("SELECT COUNT(*) c FROM audit_logs WHERE action = 'ASSERTION_REVIVED'")!;
    check("M5.7 revivals are audited", Number(reviveAudit.c) > 0, reviveAudit);
  }

  // ==========================================================================
  section("M6  the read model answers both questions the model has to answer");
  // ==========================================================================
  {
    const people = project();
    const byName = new Map(people.map((p) => [p.name, p]));
    // "Keshav Raj Paudel" is Y, the current CEO claim of source A, and M4 also
    // made that person A's chair: two current roles, so two positions.
    eq("M6.1 WHAT IS CURRENT: only current claims are published", people.map((p) => p.name).sort(), ["Anita Gurung", "Bimala Rai Paudel", "Keshav Raj Paudel"]);
    eq("M6.2 HOW MANY SUPPORT IT: A's retired X is not counted for anyone", byName.get("Anita Gurung")!.meta.sources, [SRC_B]);
    eq("M6.3 the retired chair claim no longer corroborates B's", byName.get("Bimala Rai Paudel")!.meta.sources, [SRC_B]);
    check("M6.4 every published person carries its supporting source(s)", people.every((p) => p.meta.sources.length > 0));
    check("M6.5 no person is duplicated because sources corroborate", people.length === new Set(people.map((p) => p.name)).size);
    eq("M6.6 positions enumerate every current role field", byName.get("Keshav Raj Paudel")!.positions.map((p) => p.title).sort(), ["Chairperson", "Chief Executive Officer"]);
    eq("M6.7 X holds exactly the CEO role B still reports", byName.get("Anita Gurung")!.positions.map((p) => p.title), ["Chief Executive Officer"]);
    check("M6.8 the corroborating chair is still a single published person", byName.get("Bimala Rai Paudel")!.positions.length === 1);
  }

  console.log(`\nM3.6A people Model B: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("failed: " + failures.join(" | "));
    process.exitCode = 1;
  }
}

/** Real schema, one institution, two sources. Nothing else is invented. */
function seedDb(dbPath: string): void {
  const schema = readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
  const db = new Database(dbPath);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);
  db.prepare(
    `INSERT INTO institutions (id, slug, name_en, short_name, institution_type, status)
     VALUES (?, ?, 'Fixture People Model B', 'Fixture Model B', 'PROVINCIAL', 'ACTIVE')`,
  ).run(INSTITUTION_ID, INSTITUTION_SLUG);
  db.prepare(
    `INSERT INTO institutions (id, slug, name_en, short_name, institution_type, status)
     VALUES (?, ?, 'Fixture People Model B Two', 'Fixture Model B Two', 'PROVINCIAL', 'ACTIVE')`,
  ).run(INSTITUTION_ID_2, "fixture-people-model-b-two");
  const ins = db.prepare(
    `INSERT INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
  );
  const now = "2026-10-01T00:00:00.000Z";
  ins.run(SRC_A, "MFB_WEBSITE", "INSTITUTION", "A", "https://official.fixture.test/leadership", "official.fixture.test", "Official leadership", "Institution site", now);
  ins.run(SRC_B, "NRB", "INSTITUTION", "A", "https://regulator.fixture.test/institutions", "regulator.fixture.test", "Regulator listing", "Regulator", now);
  db.close();
}

void main();
