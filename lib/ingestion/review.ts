// ============================================================================
// People review & conflict lifecycle (M3.3) — deterministic operator actions
// over the EXISTING evidence tables. No schema change: data_assertions already
// carries verification_status (UNVERIFIED / HUMAN_VERIFIED / REJECTED / …) and
// data_conflicts already carries resolution_status (OPEN / RESOLVED / IGNORED).
//
// Purpose: the extraction layer only ever writes UNVERIFIED assertions; this
// module is how a human moves a claim along the frozen lifecycle and how
// disagreeing sources become visible instead of silently winning. Every action
// appends an audit_logs row and never deletes evidence.
//
// Audit vocabulary (frozen): PEOPLE_ASSERTION_REVIEWED,
// PEOPLE_CONFLICT_RESOLVED, PEOPLE_CONFLICT_DETECTED.
// ============================================================================

import { createRequire } from "node:module";

import { PEOPLE_PARSER_ID, PEOPLE_JSON_PARSER_ID } from "./people";

type Row = Record<string, unknown>;
type DB = {
  prepare(sql: string): {
    get(...args: unknown[]): Row | undefined;
    all(...args: unknown[]): Row[];
    run(...args: unknown[]): { changes: number };
  };
  close(): void;
};

const PEOPLE_FIELD_PREFIX = "people_%";

function openDb(dbPath: string): DB {
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3") as new (p: string, o?: unknown) => DB;
  return new Database(dbPath);
}

let auditSeq = 0;
function auditId(): string {
  auditSeq += 1;
  return `aud-review-${Date.now().toString(36)}-${auditSeq}`;
}

/** Verification verdicts a human reviewer may set on one assertion. */
export type ReviewVerdict = "HUMAN_VERIFIED" | "REJECTED";

export interface ReviewAssertionInput {
  assertionId: string;
  verdict: ReviewVerdict;
  reviewer: string;
  note?: string;
  now?: string;
}

export interface ReviewAssertionResult {
  assertionId: string;
  fieldName: string;
  value: string;
  previousStatus: string;
  newStatus: ReviewVerdict;
  reviewer: string;
  changedRows: number;
}

/**
 * Move ONE people assertion to a human verdict. The assertion row is updated
 * in place (its evidence — source, snapshot, observed_at, confidence — is
 * untouched and the value is never rewritten). An audit_logs row records the
 * before/after status so the decision is traceable.
 */
export function reviewAssertion(dbPath: string, input: ReviewAssertionInput): ReviewAssertionResult {
  const now = input.now ?? new Date().toISOString();
  const db = openDb(dbPath);
  try {
    const row = db
      .prepare(
        `SELECT id, field_name, value, verification_status, source_id
           FROM data_assertions
          WHERE id = ? AND field_name LIKE ?`,
      )
      .get(input.assertionId, PEOPLE_FIELD_PREFIX) as Row | undefined;
    if (!row) {
      throw new Error(`reviewAssertion: assertion '${input.assertionId}' is not a people assertion`);
    }
    const previousStatus = String(row.verification_status);
    const res = db
      .prepare("UPDATE data_assertions SET verification_status = ? WHERE id = ?")
      .run(input.verdict, input.assertionId);
    db.prepare(
      `INSERT OR IGNORE INTO audit_logs
         (id, action, target_type, target_id, before_json, after_json, created_at)
       VALUES (?, 'PEOPLE_ASSERTION_REVIEWED', 'data_assertion', ?, ?, ?, ?)`,
    ).run(
      auditId(),
      input.assertionId,
      JSON.stringify({ verification_status: previousStatus }),
      JSON.stringify({
        verification_status: input.verdict,
        reviewer: input.reviewer,
        note: input.note ?? null,
        field_name: String(row.field_name),
        source_id: String(row.source_id),
      }),
      now,
    );
    return {
      assertionId: input.assertionId,
      fieldName: String(row.field_name),
      value: String(row.value),
      previousStatus,
      newStatus: input.verdict,
      reviewer: input.reviewer,
      changedRows: res.changes,
    };
  } finally {
    db.close();
  }
}

export interface FlagConflictsInput {
  institutionId?: string;
  now?: string;
}

/** Role fields that can only hold ONE person per institution (a board can have
 * many directors, but an institution has exactly one chairperson/CEO). A second
 * distinct value for these is a genuine disagreement, not a roster. */
const SINGLE_VALUED_PEOPLE_FIELDS = new Set(["people_chair", "people_ceo"]);

/**
 * The same normalization the assertion identity uses, so "the same claim" means
 * the same thing here as it does to the writer. A whitespace or case difference
 * between two sources is corroboration, never a disagreement.
 */
function normalizeConflictValue(raw: unknown): string {
  return String(raw).normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

/**
 * Detect people conflicts deterministically. Two disagreement modes only:
 *   1. SINGLE-VALUED ROLE — people_chair / people_ceo carry more than one
 *      distinct value for the institution (two sources disagree on who holds
 *      the office). Multi-valued roles (people_director / people_board) are a
 *      roster, never a conflict by value count.
 *   2. ROLE DISAGREEMENT — the same person name is asserted under DIFFERENT
 *      role families BY DIFFERENT sources (one site says chair, another says
 *      director). Same-source double roles are a page artifact, not a conflict.
 * Each mode writes one OPEN data_conflicts row per unordered pair, recording
 * the source that first asserted each side. Existing OPEN pairs are never
 * duplicated, so re-running the detector is idempotent. REJECTED assertions are
 * ignored (a rejected claim is not a live conflict). No assertion is ever
 * modified — the evidence ledger stays intact.
 *
 * M3.6A — two Model-B corrections, both about reading CURRENT source-owned
 * observations instead of a first-witness snapshot of the whole table:
 *
 *   - CURRENCY. Only rows with `valid_to IS NULL` are compared. A source that
 *     stopped publishing a claim has had that claim retired by the people
 *     lifecycle (lib/ingestion/people-evidence.ts), and a retired claim is
 *     history: it must not keep manufacturing a live disagreement.
 *   - PER-SOURCE ATTRIBUTION. The single-valued mode reads one row per
 *     (value, source) rather than one row per value. With A->X, B->X, A->Y the
 *     old grouping reported "X from A" against "Y from A" — a disagreement
 *     with a source on both sides, and B's agreement with A silently dropped.
 *     The genuine dispute is B->X versus A->Y. Two values asserted by the SAME
 *     source is that source's own page artifact (the exemption mode 2 already
 *     applies), not a cross-source conflict.
 */
export function flagPeopleConflicts(dbPath: string, input: FlagConflictsInput = {}): number {
  const now = input.now ?? new Date().toISOString();
  const db = openDb(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT entity_id, field_name, value, source_id, MIN(observed_at) AS first_seen, MIN(id) AS sample_id
           FROM data_assertions
          WHERE field_name LIKE ? AND verification_status != 'REJECTED' AND valid_to IS NULL
            ${input.institutionId ? "AND entity_id = ?" : ""}
          GROUP BY entity_id, field_name, value, source_id
          ORDER BY entity_id, field_name, value, source_id`,
      )
      .all(PEOPLE_FIELD_PREFIX, ...(input.institutionId ? [input.institutionId] : [])) as Array<Row & { entity_id: string; field_name: string; value: string; source_id: string; sample_id: string }>;

    type Side = { value: string; sourceId: string };
    type Pair = { entityId: string; fieldName: string; a: Side; b: Side };
    const pairs: Pair[] = [];

    // (1) single-valued role fields
    const bySingle = new Map<string, Array<Row & { value: string; source_id: string }>>();
    for (const r of rows) {
      const field = String(r.field_name).toLowerCase();
      if (!SINGLE_VALUED_PEOPLE_FIELDS.has(field)) continue;
      const key = `${r.entity_id}|${field}`;
      const bucket = bySingle.get(key);
      if (bucket) bucket.push(r);
      else bySingle.set(key, [r]);
    }
    for (const [key, bucket] of bySingle) {
      if (bucket.length < 2) continue;
      const [entityId, fieldName] = key.split("|");
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i];
          const b = bucket[j];
          // Same value from two sources is corroboration, not a conflict, and a
          // source disagreeing with ITSELF is a page artifact. Either way there
          // is no cross-source dispute to record.
          if (a.source_id === b.source_id) continue;
          if (normalizeConflictValue(a.value) === normalizeConflictValue(b.value)) continue;
          pairs.push({
            entityId,
            fieldName,
            a: { value: String(a.value), sourceId: String(a.source_id) },
            b: { value: String(b.value), sourceId: String(b.source_id) },
          });
        }
      }
    }

    // (2) same person, different role, different sources
    const byPerson = new Map<string, Map<string, Set<string>>>();
    for (const r of rows) {
      const person = String(r.value).trim().toLocaleLowerCase();
      const field = String(r.field_name).toLowerCase();
      const key = `${r.entity_id}|${person}`;
      let fields = byPerson.get(key);
      if (!fields) {
        fields = new Map<string, Set<string>>();
        byPerson.set(key, fields);
      }
      const sourceSet = fields.get(field);
      if (sourceSet) sourceSet.add(String(r.source_id));
      else fields.set(field, new Set([String(r.source_id)]));
    }
    for (const [key, fields] of byPerson) {
      const fieldList = [...fields.keys()].sort();
      if (fieldList.length < 2) continue;
      for (let i = 0; i < fieldList.length; i++) {
        for (let j = i + 1; j < fieldList.length; j++) {
          const fieldA = fieldList[i];
          const fieldB = fieldList[j];
          const sourceA = [...(fields.get(fieldA) ?? [])].sort()[0];
          const sourceB = [...(fields.get(fieldB) ?? [])].sort()[0];
          if (sourceA === sourceB) continue; // same source → page artifact
          const [entityId, person] = key.split("|");
          const personValue = rows.find((r) => String(r.value).trim().toLocaleLowerCase() === person && String(r.field_name).toLowerCase() === fieldA);
          pairs.push({
            entityId,
            fieldName: `${fieldA}|${fieldB}`,
            a: { value: String(personValue?.value ?? person), sourceId: sourceA },
            b: { value: String(personValue?.value ?? person), sourceId: sourceB },
          });
        }
      }
    }

    let created = 0;
    let conflictSeq = 0;
    for (const p of pairs) {
      // A pair a human already decided stays decided: re-running the detector
      // must never resurrect a RESOLVED/IGNORED conflict. Re-opening is a human
      // action, so no status filter here on purpose.
      const existing = db
        .prepare(
          `SELECT id FROM data_conflicts
            WHERE entity_type = 'institution' AND entity_id = ? AND field_name = ?
              AND ((value_a = ? AND value_b = ?) OR (value_a = ? AND value_b = ?))`,
        )
        .get(p.entityId, p.fieldName, p.a.value, p.b.value, p.b.value, p.a.value) as Row | undefined;
      if (existing) continue;
      conflictSeq += 1;
      db.prepare(
        `INSERT INTO data_conflicts
           (id, entity_type, entity_id, field_name, source_a_id, value_a,
            source_b_id, value_b, detected_at, resolution_status, resolution_note)
         VALUES (?, 'institution', ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
      ).run(
        `cf-people-${Date.now().toString(36)}-${conflictSeq}`,
        p.entityId,
        p.fieldName,
        p.a.sourceId,
        p.a.value,
        p.b.sourceId,
        p.b.value,
        now,
        `flagged by ${PEOPLE_PARSER_ID}/${PEOPLE_JSON_PARSER_ID} conflict detector`,
      );
      db.prepare(
        `INSERT OR IGNORE INTO audit_logs
           (id, action, target_type, target_id, before_json, after_json, created_at)
         VALUES (?, 'PEOPLE_CONFLICT_DETECTED', 'institution', ?, NULL, ?, ?)`,
      ).run(
        auditId(),
        p.entityId,
        JSON.stringify({ field_name: p.fieldName, value_a: p.a.value, value_b: p.b.value, source_a: p.a.sourceId, source_b: p.b.sourceId }),
        now,
      );
      created += 1;
    }
    return created;
  } finally {
    db.close();
  }
}

export interface OpenConflictRow {
  id: string;
  institutionId: string;
  institutionSlug: string;
  institutionName: string;
  fieldName: string;
  valueA: string;
  sourceAId: string;
  valueB: string;
  sourceBId: string;
  detectedAt: string;
  resolutionStatus: string;
}

/** OPEN people conflicts joined to institution + source names (review queue). */
export function listOpenConflicts(dbPath: string, institutionId?: string): OpenConflictRow[] {
  const db = openDb(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT c.id, c.entity_id, c.field_name, c.value_a, c.source_a_id, c.value_b, c.source_b_id,
                c.detected_at, c.resolution_status, i.slug, i.name_en
           FROM data_conflicts c
           LEFT JOIN institutions i ON i.id = c.entity_id
          WHERE c.resolution_status = 'OPEN' AND c.entity_type = 'institution' AND c.field_name LIKE ?
            ${institutionId ? "AND c.entity_id = ?" : ""}
          ORDER BY c.entity_id, c.field_name, c.value_a, c.value_b`,
      )
      .all(PEOPLE_FIELD_PREFIX, ...(institutionId ? [institutionId] : [])) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      institutionId: String(r.entity_id),
      institutionSlug: String(r.slug ?? ""),
      institutionName: String(r.name_en ?? ""),
      fieldName: String(r.field_name),
      valueA: r.value_a === null ? "" : String(r.value_a),
      sourceAId: r.source_a_id === null ? "" : String(r.source_a_id),
      valueB: r.value_b === null ? "" : String(r.value_b),
      sourceBId: r.source_b_id === null ? "" : String(r.source_b_id),
      detectedAt: String(r.detected_at),
      resolutionStatus: String(r.resolution_status),
    }));
  } finally {
    db.close();
  }
}

export interface ResolveConflictInput {
  conflictId: string;
  status: "RESOLVED" | "IGNORED";
  resolvedBy: string;
  note?: string;
  now?: string;
}

/** Close an open people conflict with a human decision (rows are kept). */
export function resolveConflict(dbPath: string, input: ResolveConflictInput): { conflictId: string; status: string; changedRows: number } {
  const now = input.now ?? new Date().toISOString();
  const db = openDb(dbPath);
  try {
    const res = db
      .prepare(
        `UPDATE data_conflicts
            SET resolution_status = ?, resolved_by = ?, resolved_at = ?, resolution_note = ?
          WHERE id = ? AND resolution_status = 'OPEN'`,
      )
      .run(input.status, input.resolvedBy, now, input.note ?? null, input.conflictId);
    if (res.changes === 0) {
      throw new Error(`resolveConflict: conflict '${input.conflictId}' is not open`);
    }
    db.prepare(
      `INSERT OR IGNORE INTO audit_logs
         (id, action, target_type, target_id, before_json, after_json, created_at)
       VALUES (?, 'PEOPLE_CONFLICT_RESOLVED', 'data_conflict', ?, ?, ?, ?)`,
    ).run(
      auditId(),
      input.conflictId,
      JSON.stringify({ resolution_status: "OPEN" }),
      JSON.stringify({ resolution_status: input.status, resolved_by: input.resolvedBy, note: input.note ?? null }),
      now,
    );
    return { conflictId: input.conflictId, status: input.status, changedRows: res.changes };
  } finally {
    db.close();
  }
}
