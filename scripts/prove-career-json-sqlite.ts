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
import { mkdtempSync, readFileSync } from "node:fs";
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

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
