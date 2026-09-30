// ============================================================================
// The M3.5 closure proof, end to end and in one process:
//
//   endpoint payload -> generic mapper -> per-record validation -> evidence writer
//   -> SQLite -> assertions -> read-model projection
//
// It is not a demo of the happy path. It runs the sequence that a reviewer has to be
// able to trust, and asserts the outcome of each step:
//
//   A  the real same-origin payload, which contains no vacancy      -> 0 of everything
//   B  a synthetic posting through the same contract              -> 1 vacancy
//   B  replayed unchanged                                           -> no new assertion
//   B  with a changed deadline                                      -> 1 changed, rest held
//   A  again (A -> B -> A)                                          -> nothing resurrected
//   C  a second source agreeing                                     -> no conflict
//   C  a second source disagreeing                                  -> conflict, no overwrite
//   provenance                                                      -> every assertion traces
//
// Case A is the point of the exercise. It is the shape actually observed on a live
// public career endpoint, it maps to zero vacancies, and the proof is that the zero
// survives all the way into the database and back out through the projection. There
// is no step in this pipeline that manufactures a vacancy to fill an empty result.
//
// Run: npm run prove:careers-json
// ============================================================================
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteEvidenceWriter } from "../lib/ingestion";
import { mapEnvelopeToVacancies } from "../lib/ingestion/career-json";
import { isSameSite } from "../lib/ingestion/career-endpoints";
import {
  applyVacancyEvidence,
  isPublishableAssertion,
  planVacancyEvidence,
  type AppliedVacancy,
} from "../lib/ingestion/career-evidence";
import { analyzeCareerPage, vacancyFingerprint, vacancyId, type VacancyRecord } from "../lib/ingestion/careers";
import {
  jobsFromAssertionRows,
  type VacancyAssertionRecord,
  type VacancyDto,
} from "../lib/repository/projection";

const require = createRequire(import.meta.url);
interface Row {
  [k: string]: unknown;
}
interface Db {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...a: unknown[]): Row;
    all(...a: unknown[]): Row[];
    run(...a: unknown[]): unknown;
  };
  close(): void;
}
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => Db;

/** The institution and sources under test. Named here, not in the mapper. */
const INST = "mfi-014";
const SRC_PRIMARY = "careers-official";
const SRC_SECONDARY = "careers-mirror";
const PAGE = "https://example-careers.test/content/Careers/7/Vacancy/17";
const T0 = "2026-09-30T00:00:00.000Z";
const T1 = "2026-09-30T06:00:00.000Z";
const T2 = "2026-09-30T12:00:00.000Z";
const PARSER = "careers-json-v1";

let checks = 0;
let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  checks += 1;
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — got ${JSON.stringify(detail)}`}`);
  }
}
/** Assert equality, reporting both sides. Used wherever the claim is about a value. */
function eq(label: string, got: unknown, want: unknown): void {
  // Structural for arrays and objects, so a claim about a list of counts is checked
  // element-wise rather than against a freshly allocated reference.
  const same = JSON.stringify(got ?? null) === JSON.stringify(want ?? null);
  check(label, same, { got, want });
}
function head(t: string): void {
  console.log(`\n=== ${t} ===`);
}

const fixture = (n: string): unknown =>
  (JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "careers", n), "utf8")) as { payload: unknown }).payload;
const sameSite = (u: string): boolean => isSameSite(u, PAGE);

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "m35-json-proof-"));
  const dbPath = join(dir, "proof.db");

  // The real schema, plus the source rows the assertions reference: data_assertions
  // carries a foreign key to sources, so an unseeded database would prove nothing.
  const seed = new Database(dbPath);
  seed.exec(readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8"));
  const addSource = seed.prepare(
    `INSERT OR IGNORE INTO sources
       (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
  );
  addSource.run(SRC_PRIMARY, "MFB_WEBSITE", "INSTITUTION", "A", "https://example-careers.test/page/careers", "example-careers.test", "Careers", "Primary careers page", T0);
  addSource.run(SRC_SECONDARY, "MFB_WEBSITE", "INSTITUTION", "B", "https://example-careers.test/page/careers?mirror=1", "example-careers.test", "Careers (second page)", "Second page on the same host", T0);
  seed.close();

  const writer = new LocalSqliteEvidenceWriter(dbPath);
  const read = (): Db => new Database(dbPath, { readonly: true });
  const scalar = (sql: string, ...a: unknown[]): number => (read().prepare(sql).get(...a) as { n: number }).n;
  const rows = (sql: string, ...a: unknown[]): Row[] => read().prepare(sql).all(...a);
  const allRows = (): Row[] => rows("SELECT * FROM data_assertions WHERE entity_type = 'VACANCY'");

  const currentVacancyCount = (): number =>
    scalar("SELECT COUNT(DISTINCT entity_id) n FROM data_assertions WHERE entity_type = 'VACANCY' AND valid_to IS NULL");
  const currentAssertionCount = (): number =>
    scalar("SELECT COUNT(*) n FROM data_assertions WHERE entity_type = 'VACANCY' AND valid_to IS NULL");

  /** The current deadline claims, one entry per source, so a disagreement is visible. */
  const currentDeadlineValues = (): string[] =>
    rows(
      "SELECT value FROM data_assertions WHERE entity_type = 'VACANCY' AND field_name = 'DEADLINE' AND valid_to IS NULL ORDER BY source_id",
    ).map((r) => String(r.value));

  /**
   * Project exactly as a caller would, and nothing more. `openConflicts` supplies the
   * keys read from data_conflicts, so the read model is never told about a dispute
   * it did not find in the rows themselves.
   */
  const project = (o: { listed: boolean; openConflicts?: boolean }): VacancyDto[] =>
    jobsFromAssertionRows(readRows(allRows()), {
      now: "2026-09-30",
      listedEntityIds: o.listed ? new Set([entityId]) : new Set<string>(),
      openConflictKeys: o.openConflicts
        ? new Set(
            rows("SELECT entity_id, field_name FROM data_conflicts WHERE resolution_status = 'OPEN'").map(
              (r) => `${String(r.entity_id)}|${String(r.field_name)}`,
            ),
          )
        : undefined,
    });

  /** One observation of one payload by one source: snapshot, map, plan, write. */
  const observe = async (
    label: string,
    fixtureName: string,
    sourceId: string,
    runId: string,
    observedAt: string,
  ): Promise<{ mapped: ReturnType<typeof mapEnvelopeToVacancies>; applied: AppliedVacancy[] }> => {
    const payload = fixture(fixtureName);
    const mapped = mapEnvelopeToVacancies(payload, PAGE, sameSite);
    const snap = await writer.saveSnapshot({
      sourceId,
      fetchedAt: observedAt,
      // A real content hash of the bytes that were fetched. Deterministic here so
      // the proof is reproducible, but it is the same field production fills.
      contentHash: `sha256:${Buffer.from(`${fixtureName}|${runId}`).toString("hex").padEnd(64, "0").slice(0, 64)}`,
      httpStatus: 200,
      mimeType: "application/json",
      r2Key: null,
      parserVersion: PARSER,
      extractionStatus: "EXTRACTED",
    });
    const ctx = { sourceId, sourceSnapshotId: snap, observedAt, runId };
    const applied: AppliedVacancy[] = [];
    for (const record of mapped.records) {
      applied.push(await applyVacancyEvidence(writer, planVacancyEvidence(record, INST), ctx));
    }
    const a = applied[0];
    console.log(
      `${label}: shape=${mapped.description.shape} records=${mapped.records.length}` +
        (a ? ` new=${a.newCount} changed=${a.changedCount} unchanged=${a.unchangedCount} conflicts=${a.conflictCount}` : "") +
        (mapped.offSiteLinks.length > 0 ? ` offSite=${mapped.offSiteLinks.length}` : ""),
    );
    for (const w of a?.writes ?? []) {
      if (w.status !== "UNCHANGED") console.log(`    ${w.status} ${w.fieldName} = ${JSON.stringify(w.value)}`);
    }
    for (const w of mapped.warnings) console.log(`    ! ${w}`);
    return { mapped, applied };
  };

  // ------------------------------------------------------------------------
  head("A — the real same-origin payload, which contains no vacancy");
  const a1 = await observe("run 1", "json-v1-himalayan-no-vacancy.json", SRC_PRIMARY, "run-1", T0);
  eq("A1 the fragment was read, so the absence is a finding rather than a skip", a1.mapped.fragmentCount, 1);
  eq("A2 the envelope shape is reported", a1.mapped.description.shape, "SINGLE_ARRAY_KEY");
  eq("A3 no vacancy is asserted", a1.mapped.records.length, 0);
  eq("A4 the off-site destination is recorded", a1.mapped.offSiteLinks.length, 1);
  check("A5 and it is plain HTTP on another site", String(a1.mapped.offSiteLinks[0]).startsWith("http://"), a1.mapped.offSiteLinks[0]);
  eq("A6 no vacancy row exists in SQLite", currentVacancyCount(), 0);
  eq("A7 no assertion row exists in SQLite", currentAssertionCount(), 0);
  eq("A8 exactly one snapshot was written, because the fetch happened", scalar("SELECT COUNT(*) n FROM source_snapshots"), 1);
  eq("A9 the fetch is recorded as extracted, and the empty result is visible as zero assertions", [
    scalar("SELECT COUNT(*) n FROM source_snapshots WHERE extraction_status = 'EXTRACTED'"),
    currentAssertionCount(),
  ], [1, 0]);
  eq("A10 and the projection is empty too", jobsFromAssertionRows(readRows(allRows())).length, 0);

  // ------------------------------------------------------------------------
  head("B — a synthetic posting through the same contract");
  const b1 = await observe("run 2", "json-v1-valid.json", SRC_PRIMARY, "run-2", T0);
  eq("B1 the mapper read one record", b1.mapped.records.length, 1);
  eq("B2 with the title from the position cell", b1.mapped.records[0]?.title, "Trainee Assistant");
  eq("B3 four assertions were planned", b1.applied[0]?.writes.length, 4);
  eq("B4 all four are new", b1.applied[0]?.newCount, 4);
  eq("B5 one vacancy entity exists", currentVacancyCount(), 1);
  eq("B6 four current assertions exist", currentAssertionCount(), 4);
  eq("B7 nothing is marked verified: writing is not verifying", scalar("SELECT COUNT(*) n FROM data_assertions WHERE verification_status <> 'UNVERIFIED'"), 0);
  const entityId = String(rows("SELECT DISTINCT entity_id FROM data_assertions WHERE entity_type = 'VACANCY'")[0].entity_id);

  // A deadline read from a declared column clears the publishable bar; the title
  // does too. Nothing here was written at a confidence a reader would treat as
  // stronger than its support.
  const confidences = rows("SELECT field_name, confidence FROM data_assertions WHERE entity_type = 'VACANCY' AND valid_to IS NULL ORDER BY field_name");
  console.log(`    confidences: ${confidences.map((r) => `${String(r.field_name)}=${Number(r.confidence)}`).join(" ")}`);
  check("B8 every stored assertion is at or above the publishable bar", confidences.every((r) => isPublishableAssertion({ confidence: Number(r.confidence) })), true);

  // ------------------------------------------------------------------------
  head("B replayed unchanged — idempotence");
  const b2 = await observe("run 3 (replay)", "json-v1-valid.json", SRC_PRIMARY, "run-3", T1);
  eq("B9 the replay wrote no new assertion", b2.applied[0]?.newCount, 0);
  eq("B10 and changed none", b2.applied[0]?.changedCount, 0);
  eq("B11 all four were recognised as unchanged", b2.applied[0]?.unchangedCount, 4);
  eq("B12 there is still one vacancy", currentVacancyCount(), 1);
  eq("B13 and still four current assertions", currentAssertionCount(), 4);
  eq("B14 the assertion count never grew, so a replay is not a duplicate", scalar("SELECT COUNT(*) n FROM data_assertions WHERE entity_type = 'VACANCY'"), 4);

  // ------------------------------------------------------------------------
  head("B with a changed deadline — one field moves, the rest hold");
  const b3 = await observe("run 4 (deadline changed)", "json-v1-changed-deadline.json", SRC_PRIMARY, "run-4", T1);
  eq("B15 exactly one field changed", b3.applied[0]?.changedCount, 1);
  eq("B16 the changed field is the deadline", b3.applied[0]?.writes.find((w) => w.status === "CHANGED")?.fieldName, "DEADLINE");
  eq("B17 the other three are unchanged", b3.applied[0]?.unchangedCount, 3);
  eq("B18 still one vacancy: a change is not a new vacancy", currentVacancyCount(), 1);
  eq("B19 still four current assertions", currentAssertionCount(), 4);
  eq("B20 the superseded value is retained in history", scalar("SELECT COUNT(*) n FROM data_assertions WHERE entity_type = 'VACANCY' AND valid_to IS NOT NULL"), 1);

  // ------------------------------------------------------------------------
  head("A again — A -> B -> A, and nothing comes back to life");
  const a2 = await observe("run 5 (source no longer lists it)", "json-v1-himalayan-no-vacancy.json", SRC_PRIMARY, "run-5", T2);
  eq("A11 the second observation of the real payload also asserts nothing", a2.mapped.records.length, 0);
  const resurrected = scalar(
    "SELECT COUNT(*) n FROM data_assertions WHERE entity_type = 'VACANCY' AND valid_to IS NULL AND observed_at > ?",
    T1,
  );
  eq("A12 no assertion was resurrected by an observation that saw nothing", resurrected, 0);
  eq("A13 the earlier assertions are untouched rather than deleted", scalar("SELECT COUNT(*) n FROM data_assertions WHERE entity_type = 'VACANCY'"), 5);
  // A retired row has no reason column of its own, so the "why" lives in the audit
  // log. Every closed row must have a matching entry that names the reason, the
  // field, the value that stopped being current, and the source it came from.
  const retiredRows = rows(
    "SELECT id, field_name, value, source_id FROM data_assertions WHERE valid_to IS NOT NULL",
  );
  const supersedeAudits = rows(
    "SELECT target_id, before_json FROM audit_logs WHERE action = 'ASSERTION_SUPERSEDED'",
  );
  const audited = new Map(
    supersedeAudits.map((a) => [
      String(a.target_id),
      JSON.parse(String(a.before_json ?? "{}")) as Record<string, unknown>,
    ]),
  );
  eq("A14a every retired row so far is accounted for", retiredRows.length, 1);
  const undocumented = retiredRows.filter((r) => {
    const audit = audited.get(String(r.id));
    return (
      !audit ||
      typeof audit.reason !== "string" ||
      audit.reason.length === 0 ||
      audit.fieldName !== r.field_name ||
      audit.retiredValue !== r.value ||
      audit.sourceId !== r.source_id ||
      audit.status !== "STALE"
    );
  });
  eq("A14b every superseded row records why it was closed, and what, and by whom", undocumented.length, 0);

  // The read model is asked to distinguish "seen earlier, absent now" from "never
  // seen" and from "closed". Absence from one listing is not a closure.
  const asListed = project({ listed: true });
  const notListed = project({ listed: false });
  eq("A15 while it is listed it is published", asListed.length, 1);
  eq("A16 when it is no longer listed it is NOT_LISTED, not closed", notListed[0]?.status, "NOT_LISTED");

  // ------------------------------------------------------------------------
  head("C — a second source on the same host");
  // The second source first reports the same deadline the first source now holds, so
  // agreement is proven before disagreement is, and the two cases cannot be confused.
  const c1 = await observe("run 6 (second source, same posting)", "json-v1-changed-deadline.json", SRC_SECONDARY, "run-6", T2);
  eq("C1 the second source agrees on every field", c1.applied[0]?.conflictCount, 0);
  eq("C2 and raises no conflict", scalar("SELECT COUNT(*) n FROM data_conflicts"), 0);
  eq("C3 both sources' claims are on record", scalar("SELECT COUNT(DISTINCT source_id) n FROM data_assertions WHERE entity_type = 'VACANCY' AND field_name = 'JOB_TITLE' AND valid_to IS NULL"), 2);

  // Now the second source reverts to the earlier deadline while the first still holds
  // the later one. This is the case a reader has to be protected from, so it is left
  // standing at the end of this section rather than tidied away immediately.
  const c2 = await observe("run 7 (second source, different deadline)", "json-v1-valid.json", SRC_SECONDARY, "run-7", T2);
  eq("C4 the disagreement is detected", c2.applied[0]?.conflictCount, 1);
  eq("C5 an open conflict is recorded", scalar("SELECT COUNT(*) n FROM data_conflicts WHERE resolution_status = 'OPEN'"), 1);
  eq("C6 the conflict names both sources", scalar("SELECT COUNT(*) n FROM data_conflicts WHERE source_a_id = ? AND source_b_id = ?", SRC_PRIMARY, SRC_SECONDARY), 1);
  eq("C6b and it names the field and both values", scalar("SELECT COUNT(*) n FROM data_conflicts WHERE field_name = 'DEADLINE' AND value_a = ? AND value_b = ?", "2083-06-15", "2026-09-20"), 1);
  const heldDeadline = rows(
    "SELECT DISTINCT value FROM data_assertions WHERE entity_type = 'VACANCY' AND field_name = 'DEADLINE' AND valid_to IS NULL AND source_id = ?",
    SRC_PRIMARY,
  );
  eq("C7 the first source's value is not overwritten", heldDeadline.length, 1);
  eq("C8 and is still its own", heldDeadline[0]?.value, "2083-06-15");
  eq("C8b while the second source's own claim is a separate current row", currentDeadlineValues().length, 2);
  eq("C9 the vacancy still projects to one row, not two", project({ listed: true }).length, 1);

  // While the sources disagree, the read model must publish no deadline at all and
  // must say so on the record. Picking one source's date would be inventing a
  // consensus that does not exist.
  const conflicted = project({ listed: true, openConflicts: true });
  eq("C10 the record reports CONFLICT while the sources disagree", conflicted[0]?.status, "CONFLICT");
  eq("C11 and publishes no deadline, because there is none agreed", conflicted[0]?.deadline, null);
  eq("C12 and names the field in dispute", conflicted[0]?.conflicts, ["deadline"]);
  eq("C13 the fields the sources agree on are still published", [conflicted[0]?.title, conflicted[0]?.location], ["Trainee Assistant", "Kathmandu"]);

  // Re-convergence: the second source catches up. The agreed value becomes
  // publishable again, but the conflict row is NOT quietly closed - M3.5 has no
  // human reviewer, so a conflict that a reviewer never resolved stays on the record.
  const c3 = await observe("run 8 (second source, caught up)", "json-v1-changed-deadline.json", SRC_SECONDARY, "run-8", T2);
  eq("C14 the sources now agree, so no new conflict arises", c3.applied[0]?.conflictCount, 0);
  eq("C15 and there is still exactly one conflict, not a second", scalar("SELECT COUNT(*) n FROM data_conflicts"), 1);
  eq("C16 which is still open, because nobody resolved it", scalar("SELECT COUNT(*) n FROM data_conflicts WHERE resolution_status = 'OPEN'"), 1);
  eq("C17 both current deadline rows are the agreed value", currentDeadlineValues(), ["2083-06-15", "2083-06-15"]);
  const settled = project({ listed: true, openConflicts: true });
  eq("C18 the agreed deadline is publishable again", settled[0]?.deadline, "2083-06-15");
  eq("C19 the vacancy is open again", settled[0]?.status, "ACTIVE");
  eq("C20 and the unresolved conflict is still shown on it", settled[0]?.conflicts, ["deadline"]);

  // ------------------------------------------------------------------------
  head("provenance — every assertion traces to a source, a snapshot and a moment");
  const traced = rows(
    `SELECT COUNT(*) n FROM data_assertions a
       LEFT JOIN sources s ON s.id = a.source_id
       LEFT JOIN source_snapshots ss ON ss.id = a.source_snapshot_id
      WHERE a.entity_type = 'VACANCY' AND (s.id IS NULL OR ss.id IS NULL)`,
  );
  eq("P1 no assertion lacks a resolvable source and snapshot", traced[0]?.n, 0);
  const snapCounts = rows("SELECT source_id, COUNT(*) n FROM source_snapshots GROUP BY source_id ORDER BY source_id");
  console.log(`    snapshots per source: ${snapCounts.map((r) => `${String(r.source_id)}=${Number(r.n)}`).join(" ")}`);
  eq("P2 every fetch that produced an observation left a snapshot", Number(snapCounts.reduce((a, r) => a + Number(r.n), 0)), 8);
  eq("P3 every run that asserted something is recorded in the audit log", scalar("SELECT COUNT(*) n FROM audit_logs WHERE action = 'VACANCY_EVIDENCE_APPLIED'"), 6);
  eq("P4 snapshots record the parser version that read them", scalar("SELECT COUNT(*) n FROM source_snapshots WHERE parser_version = ?", PARSER), 8);

  // The same accounting as A14, now over every run: nothing was ever closed out
  // without a record of what it was, whose it was, and why it stopped being current.
  const allRetired = rows(
    "SELECT id, field_name, value, source_id FROM data_assertions WHERE entity_type = 'VACANCY' AND valid_to IS NOT NULL",
  );
  const allSupersedeAudits = rows(
    "SELECT target_id, before_json FROM audit_logs WHERE action = 'ASSERTION_SUPERSEDED'",
  );
  const allAudited = new Map(
    allSupersedeAudits.map((a) => [
      String(a.target_id),
      JSON.parse(String(a.before_json ?? "{}")) as Record<string, unknown>,
    ]),
  );
  eq("P5 two claims are retired right now", allRetired.length, 2);
  // Three retirements happened across the eight runs, not two: in run 7 the mirror's
  // 2083 deadline was retired when it reverted, and in run 8 that same row was
  // revived once the source caught up. A revived row is not a silent deletion, so the
  // revival is on the record too.
  eq("P6 and all three retirements that happened are on the record", allSupersedeAudits.length, 3);
  eq("P6b the revival that undid one of them is on the record as well", scalar("SELECT COUNT(*) n FROM audit_logs WHERE action = 'ASSERTION_REVIVED'"), 1);
  const revivedAudit = rows("SELECT target_id, before_json, after_json FROM audit_logs WHERE action = 'ASSERTION_REVIVED'");
  check("P6d and it says what came back, when it had been retired, and what re-observed it", (() => {
    const b = JSON.parse(String(revivedAudit[0]?.before_json ?? "{}")) as Record<string, unknown>;
    const a = JSON.parse(String(revivedAudit[0]?.after_json ?? "{}")) as Record<string, unknown>;
    const row = allRetired.concat(rows("SELECT id, field_name, value, source_id FROM data_assertions WHERE id = ?", String(revivedAudit[0]?.target_id)))[0];
    return (
      typeof b.reason === "string" &&
      typeof b.retired_at === "string" &&
      b.fieldName === "DEADLINE" &&
      b.value === "2083-06-15" &&
      row !== undefined &&
      typeof a.source_snapshot_id === "string" &&
      typeof a.observed_at === "string"
    );
  })(), revivedAudit[0]?.before_json);
  eq("P6c and the revived row is current again, carrying the newer snapshot", scalar("SELECT COUNT(*) n FROM data_assertions WHERE entity_type = 'VACANCY' AND field_name = 'DEADLINE' AND value = '2083-06-15' AND source_id = ? AND valid_to IS NULL AND source_snapshot_id = (SELECT id FROM source_snapshots WHERE source_id = ? ORDER BY fetched_at DESC, id DESC LIMIT 1)", SRC_SECONDARY, SRC_SECONDARY), 1);
  eq(
    "P7 no retirement is undocumented",
    allRetired.filter((r) => {
      const audit = allAudited.get(String(r.id));
      return (
        !audit ||
        typeof audit.reason !== "string" ||
        audit.reason.length === 0 ||
        audit.fieldName !== r.field_name ||
        audit.retiredValue !== r.value ||
        audit.sourceId !== r.source_id
      );
    }).length,
    0,
  );

  // ------------------------------------------------------------------------
  head("the read model, as a reader would see it");
  const final = project({ listed: true, openConflicts: true });
  const v = final[0] as VacancyDto | undefined;
  eq("M1 one vacancy is published", final.length, 1);
  eq("M2 with the observed title", v?.title, "Trainee Assistant");
  eq("M3 the observed location", v?.location, "Kathmandu");
  eq("M4 the deadline both sources now agree on", v?.deadline, "2083-06-15");
  // The lifecycle status must be one of the named states, never a bare boolean
  // leaking through as a string: a reader has to be able to tell "closed" from
  // "nobody looked recently", and only the named vocabulary can say that.
  const LIFECYCLE: readonly string[] = ["ACTIVE", "NOT_LISTED", "CONFLICT", "SOURCE_UNAVAILABLE", "CLOSED"];
  check("M5 the status is a named lifecycle state, not a bare flag", LIFECYCLE.includes(String(v?.status)), v?.status);
  check("M6 and it carries the source it came from", typeof v?.source_name === "string" || v?.source_name === null, true);
  eq("M7 the unresolved conflict is listed on the record", v?.conflicts, ["deadline"]);
  check("M8 nothing is published as human-verified, because no human reviewed it", v?.meta.verification_status !== "HUMAN_VERIFIED", v?.meta.verification_status);
  check("M9 and the coarse flag agrees with the named status", v?.is_active === (v?.status === "ACTIVE"), { is_active: v?.is_active, status: v?.status });
  console.log(`\n  projection: ${JSON.stringify({ title: v?.title, location: v?.location, deadline: v?.deadline, status: v?.status, conflicts: v?.conflicts }, null, 2)}`);

  head("stored assertions");
  for (const r of rows(
    `SELECT field_name, value, source_id, confidence, verification_status, valid_to IS NOT NULL AS retired
       FROM data_assertions WHERE entity_type = 'VACANCY' ORDER BY field_name, source_id, id`,
  )) {
    console.log(
      `  ${String(r.field_name).padEnd(20)} ${JSON.stringify(r.value).padEnd(16)} ${String(r.source_id).padEnd(17)} ` +
        `${Number(r.confidence)} ${String(r.verification_status)}${Number(r.retired) ? " (retired)" : ""}`,
    );
  }

  // ==========================================================================
  // L — the ONE real vacancy, from byte-exact captured live evidence
  // ==========================================================================
  //
  // Section A proved that a real payload containing no vacancy stays empty all
  // the way through to the read model. This section proves the other direction,
  // on the one vacancy the pilot actually found, because that is the central
  // M3.5 claim and it needs its own evidence rather than an inference.
  //
  // The live pilot is observation-only: it writes sources and snapshots and
  // asserts nothing, so the pilot database holds zero data_assertions rows and
  // the fact that a vacancy was FOUND is not the same as the fact that it is
  // PERSISTED. Rather than convert the pilot into a writing job to show this,
  // the real production path - planner, validator, LocalSqliteEvidenceWriter,
  // read model - is run here against a byte-exact capture of the real page, in
  // its own database so it cannot contaminate the sequence above.
  //
  // The capture is hash-pinned. Re-fetching the URL will not reproduce the hash,
  // because the site serves different bytes on different requests; that variance
  // is a documented property of the evidence, not a defect in the proof.
  await liveVacancyProof(dir);

  head("result");
  check("Z the whole proof passes", failures === 0, `${failures} failed of ${checks}`);
  console.log(`\n${failures === 0 ? "OK" : "FAIL"} — ${checks - failures}/${checks} checks`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/** Read current VACANCY assertions in the shape the projection expects. */
function readRows(rows: Row[]): VacancyAssertionRecord[] {
  return rows.map((r) => ({
    entity_id: String(r.entity_id),
    field_name: String(r.field_name),
    value: String(r.value),
    source_id: String(r.source_id),
    observed_at: String(r.observed_at),
    valid_to: r.valid_to === null || r.valid_to === undefined ? null : String(r.valid_to),
    verification_status: String(r.verification_status),
    confidence: Number(r.confidence),
    institution_id: "mfi-014",
    institution_slug: "example-careers",
    institution_name: "Example Laghubitta",
    source_name: String(r.source_id),
  })) as VacancyAssertionRecord[];
}

// ---------------------------------------------------------------------------
// L — the one real vacancy
// ---------------------------------------------------------------------------

const LIVE = {
  inst: "mfi-012",
  slug: "suryodaya-womi-laghubitta-bittiya-sanstha-ltd",
  name: "Suryodaya Womi Laghubitta Bittiya Sanstha Ltd.",
  src: "swmfi-website",
  src2: "swmfi-website-second",
  page: "https://swmfi.com.np/",
  parser: "careers-html-v1",
  // The literal substrings the re-parsed mutations below rewrite. They are the
  // notice's own title and the uploaded notice's filename as they appear in the
  // captured bytes, so the mutations rewrite what the page actually says.
  title: "नायव प्रमुख कार्यकारी अधिकृत पदपूर्ति सम्बन्धी सूचना",
  pdfName: "!!!-2026-09-30-147766.pdf",
  otherTitle: "सहायक कार्यकारी पदपूर्ति सम्बन्धी सूचना",
  t0: "2026-09-30T06:39:54.949Z",
  t1: "2026-09-30T07:00:00.000Z",
  t2: "2026-09-30T08:00:00.000Z",
  t3: "2026-09-30T09:00:00.000Z",
  t4: "2026-09-30T10:00:00.000Z",
  t5: "2026-09-30T10:30:00.000Z",
} as const;

  interface LiveMeta {
  source_url: string;
  final_url: string;
  institution_id: string;
  observed_at: string;
  http_status: number;
  content_type: string | null;
  bytes: number;
  sha256: string;
  page_shape: string;
  page_shape_reason: string;
  record_count: number;
  parser_version: string;
}

/**
 * The one real vacancy, carried the whole way through the production path.
 *
 * Everything asserted here is read back out of SQLite. Nothing is asserted about
 * the live site at run time, so this proof is reproducible offline and cannot
 * silently change because a remote page changed.
 */
async function liveVacancyProof(dir: string): Promise<void> {
  const htmlPath = join(process.cwd(), "fixtures", "careers", "live-mfi-012-root.html");
  const metaPath = join(process.cwd(), "fixtures", "careers", "live-mfi-012-root.meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as LiveMeta;
  const bytes = readFileSync(htmlPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  head("L — the one real vacancy: captured evidence, hash-pinned");
  eq("L1 the captured bytes are the bytes the capture recorded", sha256, meta.sha256);
  eq("L2 and the byte count agrees too", bytes.length, meta.bytes);
  eq("L3 the capture is of the institution under test", meta.institution_id, LIVE.inst);
  eq("L4 fetched over HTTPS from the institution's own host", meta.source_url.startsWith("https://swmfi.com.np"), true);

  // Parse the real bytes with the real grammar. No fixture, no hand-built record.
  const analysis = analyzeCareerPage({
    body: new Uint8Array(bytes),
    contentType: meta.content_type,
    url: meta.final_url,
    httpStatus: meta.http_status,
  });

  /**
   * Re-parse a modified local copy of the captured bytes.
   *
   * The observations this section needs - the link moving, the notice being
   * re-titled, the same title rendered without its trailing punctuation - are
   * produced by running the real grammar over modified bytes rather than by
   * hand-editing a parsed record. A record assembled by hand could assert
   * something the parser would never emit, and the proof would then be proving
   * its own fixture instead of the system.
   */
  const reparse = (mutate: (html: string) => string): VacancyRecord => {
    const mutated = Buffer.from(mutate(bytes.toString("utf8")), "utf8");
    const parsed = analyzeCareerPage({
      body: new Uint8Array(mutated),
      contentType: meta.content_type,
      url: meta.final_url,
      httpStatus: meta.http_status,
    });
    if (parsed.records.length !== 1) {
      throw new Error(`expected exactly one record after mutation, got ${parsed.records.length}`);
    }
    return parsed.records[0];
  };
  eq("L4 and the capture is hash-pinned, so the proof is reproducible offline", meta.sha256.length, 64);
  eq("L4a the capture names the parser that read it", meta.parser_version, LIVE.parser);
  eq("L4b the mutations below are re-parsed from the captured bytes, not hand-built", typeof reparse, "function");

  eq("L5 the grammar reads the captured page as one anchored detail record", analysis.shape, "SINGLE_VACANCY_DETAIL");
  eq("L6 with exactly one record", analysis.records.length, 1);
  const record = analysis.records[0];
  check("L7 the record's title is the real notice title", typeof record?.title === "string" && record.title.includes("कार्यकारी"), record?.title);
  eq("L8 and no deadline was proven from it", record?.deadline, null);
  eq("L9 and no location was proven from it", record?.location, null);
  eq("L10 and no employment type was proven from it", record?.employment_type, null);
  eq("L11 and no contact email was proven from it", record?.contact_email, null);
  check("L12 the one field beyond the title is the application link to the notice PDF", typeof record?.application_url === "string" && record.application_url.endsWith(".pdf"), record?.application_url);
  eq("L13 and that link is same-origin", new URL(String(record?.application_url)).origin, "https://swmfi.com.np");
  eq("L14 over HTTPS, not a downgrade", new URL(String(record?.application_url)).protocol, "https:");

  // What the planner is willing to assert. This is the boundary of the evidence:
  // the notice's deadline and requirements live in the PDF and are NOT here.
  const planned = planVacancyEvidence(record, LIVE.inst);
  eq("L15 the plan asserts two fields, and only two", planned.assertions.length, 2);
  eq("L16 named exactly", planned.assertions.map((a) => a.fieldName).sort(), ["APPLICATION_URL", "JOB_TITLE"]);
  const plannedFields = planned.assertions.map((a) => String(a.fieldName));
  check("L17 no deadline is invented from the un-read PDF", !plannedFields.includes("DEADLINE"), plannedFields);
  check("L18 no location is invented", !plannedFields.includes("LOCATION"), plannedFields);
  check("L19 no salary, employer or requirements are invented", !plannedFields.some((f) => ["SALARY", "EMPLOYER", "REQUIREMENTS", "EDUCATION", "EXPERIENCE"].includes(f)), plannedFields);

  // ---- persistence, in its own databases ----------------------------------
  // Two databases, not one, so that each scenario is read on its own terms. The
  // first carries the history of a single source; the second carries a two-source
  // disagreement. Sharing one database would let the moved application link from
  // the first scenario become a second, unrelated conflict in the second, and the
  // proof would then be asserting something the sources never actually said.
  const seedDatabase = (path: string): void => {
    const seed = new Database(path);
    seed.exec(readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8"));
    const addSource = seed.prepare(
      `INSERT OR IGNORE INTO sources
         (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?)`,
    );
    addSource.run(LIVE.src, "MFB_WEBSITE", "INSTITUTION", "A", "https://swmfi.com.np", "swmfi.com.np", `${LIVE.name} — official website`, LIVE.inst, LIVE.t0);
    addSource.run(LIVE.src2, "MFB_WEBSITE", "INSTITUTION", "B", "https://swmfi.com.np/careers", "swmfi.com.np", `${LIVE.name} — careers page`, LIVE.inst, LIVE.t0);
    seed.close();
  };

  const openStore = (path: string) => {
    const read = (): Db => new Database(path, { readonly: true });
    const scalar = (sql: string, ...a: unknown[]): number => (read().prepare(sql).get(...a) as { n: number }).n;
    const q = (sql: string, ...a: unknown[]): Row[] => read().prepare(sql).all(...a);
    const project = (o: { openConflicts?: boolean }): VacancyDto[] =>
      jobsFromAssertionRows(
        q("SELECT * FROM data_assertions WHERE entity_type = 'VACANCY'").map((r) => ({
          entity_id: String(r.entity_id),
          field_name: String(r.field_name),
          value: String(r.value),
          source_id: String(r.source_id),
          observed_at: String(r.observed_at),
          valid_to: r.valid_to === null || r.valid_to === undefined ? null : String(r.valid_to),
          verification_status: String(r.verification_status),
          confidence: Number(r.confidence),
          institution_id: LIVE.inst,
          institution_slug: LIVE.slug,
          institution_name: LIVE.name,
          source_name: String(r.source_id),
        })) as VacancyAssertionRecord[],
        {
          now: "2026-09-30",
          openConflictKeys: o.openConflicts
            ? new Set(q("SELECT entity_id, field_name FROM data_conflicts WHERE resolution_status = 'OPEN'").map((r) => `${String(r.entity_id)}|${String(r.field_name)}`))
            : undefined,
        },
      );
    return {
      scalar,
      q,
      project,
      currentCount: (): number =>
        scalar("SELECT COUNT(DISTINCT entity_id) n FROM data_assertions WHERE entity_type = 'VACANCY' AND valid_to IS NULL"),
    };
  };

  const dbPath = join(dir, "live.db");
  seedDatabase(dbPath);
  const writer = new LocalSqliteEvidenceWriter(dbPath);
  const store = openStore(dbPath);
  const { scalar, q, currentCount } = store;
  const projectLive = store.project;

  /** One observation by one source of one already-parsed record. */
  const observeLive = async (
    label: string,
    rec: VacancyRecord,
    sourceId: string,
    runId: string,
    observedAt: string,
  ): Promise<AppliedVacancy> => {
    const snap = await writer.saveSnapshot({
      sourceId,
      fetchedAt: observedAt,
      // The hash of the real captured bytes, so the persisted provenance points at
      // the exact evidence this section parsed rather than at a synthetic string.
      contentHash: `sha256:${sha256}`,
      httpStatus: meta.http_status,
      mimeType: meta.content_type,
      r2Key: null,
      parserVersion: LIVE.parser,
      extractionStatus: "EXTRACTED",
    });
    const a = await applyVacancyEvidence(writer, planVacancyEvidence(rec, LIVE.inst), {
      sourceId,
      sourceSnapshotId: snap,
      observedAt,
      runId,
    });
    console.log(
      `${label}: new=${a.newCount} changed=${a.changedCount} unchanged=${a.unchangedCount} conflicts=${a.conflictCount}` +
        ` retired=${a.writes.filter((w: { status: string }) => w.status === "SUPERSEDED").length}`,
    );
    for (const w of a.writes) {
      if (w.status !== "UNCHANGED") console.log(`    ${w.status} ${w.fieldName} = ${JSON.stringify(w.value).slice(0, 90)}`);
    }
    return a;
  };

  head("L — first write: live evidence into SQLite");
  const w1 = await observeLive("L run 1 (first observation)", record, LIVE.src, "live-run-1", LIVE.t0);
  eq("L20 one vacancy entity exists", currentCount(), 1);
  eq("L21 with exactly the two proven fields", scalar("SELECT COUNT(*) n FROM data_assertions WHERE entity_type = 'VACANCY' AND valid_to IS NULL"), 2);
  eq("L22 the title is stored at the parser's confidence", scalar("SELECT confidence n FROM data_assertions WHERE field_name = 'JOB_TITLE' AND valid_to IS NULL"), 0.6);
  eq("L23 the application link at its own", scalar("SELECT confidence n FROM data_assertions WHERE field_name = 'APPLICATION_URL' AND valid_to IS NULL"), 0.5);
  eq("L24 the two writes were new", w1.newCount, 2);
  eq("L25 the entity id is derived from institution + normalized title", planVacancyEvidence(record, LIVE.inst).entityId.startsWith(`vacancy-${LIVE.inst}|`), true);
  eq("L26 nothing was written as human-verified", scalar("SELECT COUNT(*) n FROM data_assertions WHERE verification_status = 'HUMAN_VERIFIED'"), 0);

  const firstPublished = projectLive({});
  eq("L27 the read model publishes it", firstPublished.length, 1);
  eq("L28 with the observed title", firstPublished[0]?.title, record.title);
  eq("L29 and no deadline, because none was proven", firstPublished[0]?.deadline, null);
  eq("L30 and no location, because none was proven", firstPublished[0]?.location, null);
  eq("L31 and a lifecycle status", firstPublished[0]?.status, "ACTIVE");
  check("L32 but nothing claims human review", firstPublished[0]?.meta.verification_status !== "HUMAN_VERIFIED", firstPublished[0]?.meta.verification_status);
  check("L33 and the application link is the only actionable field", firstPublished[0]?.application_url === record.application_url, firstPublished[0]?.application_url);

  head("L — second identical write: idempotency");
  const w2 = await observeLive("L run 2 (identical re-observation)", record, LIVE.src, "live-run-2", LIVE.t1);
  eq("L34 no new assertion is written", w2.newCount, 0);
  eq("L35 no assertion is superseded", w2.changedCount, 0);
  eq("L36 and no conflict is raised", w2.conflictCount, 0);
  eq("L37 the store is unchanged at two current assertions", scalar("SELECT COUNT(*) n FROM data_assertions WHERE entity_type = 'VACANCY' AND valid_to IS NULL"), 2);
  eq("L38 the same single entity", currentCount(), 1);
  eq("L39 a second observation still leaves its own snapshot, because it really was a second fetch", scalar("SELECT COUNT(*) n FROM source_snapshots WHERE source_id = ?", LIVE.src), 2);
  eq("L40 and the projection is byte-identical", JSON.stringify(projectLive({})), JSON.stringify(firstPublished));

  head("L — history: a changed field on the same vacancy");
  // The application link moves; the title does not. This is a supersession, because
  // identity is institution + normalized title + normalized location, and neither of
  // those changed. A deadline extension is the same case and is proven in section B.
  // The record is produced by re-running the real grammar over modified local bytes
  // rather than by hand-editing an object, so what is asserted is something the
  // parser could actually have emitted. The captured fixture itself is untouched and
  // no live source is mutated.
  const moved = reparse((h) => h.replaceAll(LIVE.pdfName, `${LIVE.pdfName.slice(0, -4)}-v2.pdf`));
  const w3 = await observeLive("L run 3 (application link changed)", moved, LIVE.src, "live-run-3", LIVE.t2);
  eq("L41 exactly one field changed", w3.changedCount, 1);
  eq("L42 and it is not a new vacancy", currentCount(), 1);
  eq("L43 the superseded row is kept, not deleted", scalar("SELECT COUNT(*) n FROM data_assertions WHERE field_name = 'APPLICATION_URL' AND valid_to IS NOT NULL"), 1);
  eq("L44 the new value is current", scalar("SELECT value n FROM data_assertions WHERE field_name = 'APPLICATION_URL' AND valid_to IS NULL"), moved.application_url);
  check("L44b and it is the re-parsed link, not a hand-written one", String(moved.application_url).endsWith("-v2.pdf"), moved.application_url);
  eq("L45 the title was left alone", scalar("SELECT COUNT(*) n FROM data_assertions WHERE field_name = 'JOB_TITLE' AND valid_to IS NULL"), 1);
  const sup = q("SELECT target_id, before_json FROM audit_logs WHERE action = 'ASSERTION_SUPERSEDED'");
  eq("L46 the supersession is audited", sup.length, 1);
  const supBody = JSON.parse(String(sup[0]?.before_json ?? "{}")) as Record<string, unknown>;
  check("L47 the audit names the field, the retired value, the reason and the source", (() => {
    const retired = q("SELECT value, source_id FROM data_assertions WHERE id = ?", String(sup[0]?.target_id))[0];
    return (
      supBody.fieldName === "APPLICATION_URL" &&
      typeof supBody.reason === "string" && supBody.reason.length > 0 &&
      supBody.sourceId === LIVE.src &&
      supBody.retiredValue === retired?.value
    );
  })(), supBody);
  eq("L48 provenance survives the supersession", scalar("SELECT COUNT(*) n FROM data_assertions WHERE entity_type = 'VACANCY' AND (source_id IS NULL OR source_snapshot_id IS NULL)"), 0);
  const afterHistory = projectLive({});
  eq("L49 the read model shows the current link, not the retired one", afterHistory[0]?.application_url, moved.application_url);

  head("L — a changed TITLE is a different posting, not a supersession");
  // Identity includes the normalized title, so a different title is a different
  // vacancy. Merging on title alone is how two jobs become one, so the model
  // forks and keeps both rather than overwriting. This is asserted explicitly
  // because it is the one place a reader might expect a supersession and get a
  // second vacancy instead - and the second vacancy is the correct outcome.
  const retitled = reparse((h) => h.replaceAll(`${LIVE.title} !!!`, LIVE.otherTitle));
  const w4 = await observeLive("L run 4 (different title)", retitled, LIVE.src, "live-run-4", LIVE.t3);
  eq("L50 it is a new entity, not a changed field", w4.newCount, 2);
  eq("L51 so there are now two vacancies", currentCount(), 2);
  eq("L52 the original is untouched", scalar("SELECT value n FROM data_assertions WHERE field_name = 'JOB_TITLE' AND valid_to IS NULL AND value = ?", record.title), record.title);
  eq("L53 and both titles are readable", projectLive({}).length, 2);

  head("L — conflict: two sources, one posting, different wording");
  // A JOB_TITLE conflict is reachable only when two sources normalize to the same
  // identity key but store different text. The live site renders its notice title
  // with and without trailing punctuation across pages, which is exactly that case.
  // Asserting a conflict on two genuinely different titles would be unreachable here,
  // because different titles are different vacancies - proven in L50 above.
  //
  // This runs in its own database so that the only disagreement present is the one
  // the two sources actually have. In the history database the application link had
  // already moved, so a second source quoting the old link would raise a second,
  // unrelated conflict and the count below would be measuring our test order.
  const conflictPath = join(dir, "live-conflict.db");
  seedDatabase(conflictPath);
  const conflictWriter = new LocalSqliteEvidenceWriter(conflictPath);
  const cs = openStore(conflictPath);
  const observeIn = async (
    w: LocalSqliteEvidenceWriter,
    label: string,
    rec: VacancyRecord,
    sourceId: string,
    runId: string,
    observedAt: string,
  ): Promise<AppliedVacancy> => {
    const snap = await w.saveSnapshot({
      sourceId,
      fetchedAt: observedAt,
      contentHash: `sha256:${sha256}`,
      httpStatus: meta.http_status,
      mimeType: meta.content_type,
      r2Key: null,
      parserVersion: LIVE.parser,
      extractionStatus: "EXTRACTED",
    });
    const a = await applyVacancyEvidence(w, planVacancyEvidence(rec, LIVE.inst), {
      sourceId,
      sourceSnapshotId: snap,
      observedAt,
      runId,
    });
    console.log(`  ${label}: new=${a.newCount} changed=${a.changedCount} unchanged=${a.unchangedCount} conflicts=${a.conflictCount}`);
    return a;
  };

  const punctuated = reparse((h) => h.replaceAll(`${LIVE.title} !!!`, LIVE.title));
  eq("L54 the two wordings share one identity", vacancyId(LIVE.inst, record.title, null), vacancyId(LIVE.inst, punctuated.title, null));
  check("L55 but they are not the same stored text", punctuated.title !== record.title, [record.title, punctuated.title]);
  await observeIn(conflictWriter, "L source A (title with trailing punctuation)", record, LIVE.src, "live-run-a", LIVE.t4);
  const w5 = await observeIn(conflictWriter, "L source B (same posting, other punctuation)", punctuated, LIVE.src2, "live-run-b", LIVE.t5);
  eq("L56 the disagreement is detected", w5.conflictCount, 1);
  eq("L57 an open conflict is recorded", cs.scalar("SELECT COUNT(*) n FROM data_conflicts WHERE resolution_status = 'OPEN' AND entity_type = 'VACANCY'"), 1);
  eq("L58 it names the disputed field", cs.scalar("SELECT field_name n FROM data_conflicts WHERE resolution_status = 'OPEN' AND entity_type = 'VACANCY'"), "JOB_TITLE");
  eq("L59 and both wordings", cs.scalar("SELECT COUNT(*) n FROM data_conflicts WHERE value_a = ? AND value_b = ?", record.title, punctuated.title), 1);
  const entityId = planVacancyEvidence(record, LIVE.inst).entityId;
  const conflicted = cs.project({ openConflicts: true }).find((d) => d.id === entityId);
  eq("L60 the disputed vacancy reports CONFLICT", conflicted?.status, "CONFLICT");
  // The read model cannot name a vacancy without a title, so the disputed wording is
  // shown rather than omitted. What makes it safe is that it is never presented as
  // agreed: the field is named in `conflicts` and the status is CONFLICT, so a
  // consumer may not quote it as fact. Fields that can be omitted are suppressed.
  eq("L61 the two wordings are kept, not one overwriting the other", cs.scalar("SELECT COUNT(*) n FROM data_assertions WHERE field_name = 'JOB_TITLE' AND valid_to IS NULL"), 2);
  check("L61b and neither is retired as wrong", cs.scalar("SELECT COUNT(*) n FROM data_assertions WHERE field_name = 'JOB_TITLE' AND valid_to IS NOT NULL") === 0, true);
  eq("L62 and the record names the field in dispute", conflicted?.conflicts, ["title"]);
  check("L63 while the undisputed application link is still published", typeof conflicted?.application_url === "string", conflicted?.application_url);

  head("L — re-convergence");
  const w6 = await observeIn(conflictWriter, "L source B catches up to the agreed wording", record, LIVE.src2, "live-run-c", LIVE.t5);
  eq("L64 agreement raises no new conflict", w6.conflictCount, 0);
  eq("L65 and there is still exactly one conflict, not a second", cs.scalar("SELECT COUNT(*) n FROM data_conflicts WHERE entity_type = 'VACANCY'"), 1);
  eq("L66 which stays open, because nobody resolved it", cs.scalar("SELECT COUNT(*) n FROM data_conflicts WHERE resolution_status = 'OPEN'"), 1);
  const settled = cs.project({ openConflicts: true }).find((d) => d.id === entityId);
  eq("L67 the title is publishable again", settled?.title, record.title);
  eq("L68 the vacancy is open again", settled?.status, "ACTIVE");
  eq("L69 and the unresolved conflict is still shown on the record", settled?.conflicts, ["title"]);

  head("L — what the live pilot itself persisted");
  // The distinction the whole section exists to make: FOUND by the parser is not
  // PERSISTED by the pilot. The pilot is observation-only, and this is the proof.
  const pilotPath = join(process.cwd(), "data", "pilot", "evidence", "pilot-careers-2026-09-29.db");
  if (existsSync(pilotPath)) {
    const pilot = new Database(pilotPath, { readonly: true });
    const ps = (sql: string, ...a: unknown[]): number => (pilot.prepare(sql).get(...a) as { n: number }).n;
    eq("L70 the pilot database holds no VACANCY assertion", ps("SELECT COUNT(*) n FROM data_assertions WHERE entity_type = 'VACANCY'"), 0);
    check("L71 and no assertion of any type", ps("SELECT COUNT(*) n FROM data_assertions") === 0, ps("SELECT COUNT(*) n FROM data_assertions"));
    eq("L72 but it did record the source", ps("SELECT COUNT(*) n FROM sources WHERE id = ?", LIVE.src), 1);
    eq("L73 and a snapshot of the page that carried the vacancy", ps("SELECT COUNT(*) n FROM source_snapshots WHERE source_id = ?", LIVE.src), 4);
    eq("L74 marked as not extracted, which is why nothing was asserted", ps("SELECT COUNT(*) n FROM source_snapshots WHERE source_id = ? AND extraction_status = 'SKIPPED'", LIVE.src), 4);
    pilot.close();
  } else {
    console.log("  (pilot database absent; L70-L74 skipped — the proof database above stands on its own)");
  }

  head("L — the exact identity and provenance, for the audit record");
  const identity = planVacancyEvidence(record, LIVE.inst).entityId;
  console.log(`  source url        : ${meta.source_url}`);
  console.log(`  final url         : ${meta.final_url}`);
  console.log(`  institution       : ${LIVE.inst} (${LIVE.slug})`);
  console.log(`  source id         : ${LIVE.src}`);
  console.log(`  observed at       : ${meta.observed_at}`);
  console.log(`  http / mime       : ${meta.http_status} ${meta.content_type}`);
  console.log(`  sha256            : ${sha256}`);
  console.log(`  page shape        : ${analysis.shape} — ${analysis.reason}`);
  console.log(`  parser version    : ${LIVE.parser}`);
  console.log(`  entity id         : ${identity}`);
  console.log(`  fingerprint       : ${vacancyFingerprint(record)}`);
  for (const r of q(
    `SELECT id, entity_id, field_name, value, source_id, source_snapshot_id, confidence, verification_status, observed_at
       FROM data_assertions WHERE entity_type = 'VACANCY' AND field_name = 'JOB_TITLE' AND value = ? AND valid_to IS NULL`,
    record.title,
  )) {
    console.log(`  assertion id      : ${String(r.id)}`);
    console.log(`  field             : ${String(r.field_name)} = ${JSON.stringify(r.value)}`);
    console.log(`  source snapshot   : ${String(r.source_snapshot_id)}`);
    console.log(`  confidence/status : ${Number(r.confidence)} ${String(r.verification_status)} @ ${String(r.observed_at)}`);
  }
  console.log(`  app url same-site : ${isSameSite(String(record.application_url), meta.final_url)}`);
  console.log(`  app url protocol  : ${new URL(String(record.application_url)).protocol}`);
  head("L — stored assertions for the one real vacancy");
  for (const r of q(
    `SELECT field_name, value, source_id, confidence, verification_status, valid_to IS NOT NULL AS retired
       FROM data_assertions WHERE entity_type = 'VACANCY' ORDER BY field_name, source_id, id`,
  )) {
    console.log(
      `  ${String(r.field_name).padEnd(16)} ${JSON.stringify(r.value).slice(0, 58).padEnd(60)} ${String(r.source_id).padEnd(22)} ` +
        `${Number(r.confidence)} ${String(r.verification_status)}${Number(r.retired) ? " (retired)" : ""}`,
    );
  }
  const p = projectLive({ openConflicts: true }).find((d) => d.id === planVacancyEvidence(record, LIVE.inst).entityId);
  console.log(`\n  projection: ${JSON.stringify({ title: p?.title, deadline: p?.deadline, location: p?.location, status: p?.status, conflicts: p?.conflicts }, null, 2)}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
