// ============================================================================
// People evidence application (M3.6A) — source-owned observation lifecycle.
//
// WHY THIS FILE EXISTS. The PEOPLE assertion identity has been source-owned
// since M3.4: `semanticAssertionId` hashes (entity_type, entity_id, field_name,
// source_id, normalized value), so each source keeps its own observation row and
// "two sources assert this same normalized claim" is a DERIVED relationship
// between two rows rather than the absence of a second row. That storage is
// correct and is NOT changed here.
//
// What was missing is the other half of that model for People specifically: the
// per-source lifecycle. M3.4 taught Branches (branch-external.ts), M3.5 taught
// Vacancies (career-evidence.ts) and Phase C taught Documents
// (financial-evidence.ts) to retire and revive THEIR OWN observations when the
// same source changes its mind, using operations the frozen schema and the
// EvidenceWriter contract already had. People asserted through the generic
// engine with no such step, so a source could never withdraw a claim it had
// stopped publishing, and the people conflict detector compared retired rows as
// if they were current.
//
// This module is that same lifecycle, applied to People, from the same
// primitives and the same vocabulary. It is deliberately NOT a new assertion
// model and NOT a new relation:
//
//   identity       unchanged (source-owned, computed in the writer)
//   retirement     writer.supersedeAssertion -> valid_to + STALE
//   revival        writer.reviveAssertion    -> valid_to cleared
//   disagreement   writer.saveConflict       -> data_conflicts
//   audit          writer.appendAudit        -> audit_logs
//
// No schema change, no migration, no new column, no new table, no per-module
// semantic exception. That uniform rule — a source's lifecycle is its own, and
// one source changing its mind never touches another source's observation — is
// what this file makes true for People as well.
// ============================================================================

import type { AssertionInput, ConflictInput, EvidenceWriter, StoredAssertion } from "./contract";

/** People assertions hang off the institution entity, as they always have. */
export const PEOPLE_ASSERTION_ENTITY_TYPE = "institution";

/** The M3.3 People field vocabulary: people_chair, people_ceo, people_director, ... */
export const PEOPLE_ASSERTION_FIELD_PREFIX = "people_";

/** True when a field name belongs to the People role vocabulary. */
export function isPeopleAssertionField(fieldName: string): boolean {
  return String(fieldName).toLowerCase().startsWith(PEOPLE_ASSERTION_FIELD_PREFIX);
}

/**
 * Normalisation identical to the writer's identity function, so a plan and the
 * id the writer will compute agree on what "the same claim" means. Deliberately
 * the same minimal rule: NFKC, collapsed whitespace, case-folded.
 */
export function normalizePeopleClaimValue(raw: string): string {
  return String(raw).normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

/** The still-current observations among a stored set (valid_to IS NULL). */
function current(rows: readonly StoredAssertion[]): StoredAssertion[] {
  return rows.filter((r) => r.valid_to === null);
}

/**
 * The mandatory source-scoped query: "what does source B currently say?"
 *
 * The writer's lookup already accepts a sourceId filter; this wraps it and adds
 * the currency filter, so the answer is about CURRENT state rather than about
 * everything the source has ever said. A source that withdrew a claim returns
 * nothing for it, which is the point: a retired observation is history, and
 * history stays answerable from the same rows with valid_to surfaced.
 */
export async function currentPeopleClaimsForSource(
  writer: EvidenceWriter,
  input: { institutionId: string; fieldName: string; sourceId: string },
): Promise<StoredAssertion[]> {
  const stored = await writer.findAssertions({
    entityType: PEOPLE_ASSERTION_ENTITY_TYPE,
    entityId: input.institutionId,
    fieldName: input.fieldName,
    sourceId: input.sourceId,
  });
  return current(stored);
}

/** One observed claim by one source about one people role field. */
export interface PeopleClaim {
  fieldName: string;
  value: string;
  confidence: number;
  /**
   * The snapshot that actually carried this claim.
   *
   * Optional because an observation can come from a single page, in which case
   * the apply context's snapshot is the only one and is unambiguous. It is
   * needed as soon as ONE observation aggregates several pages — a source's
   * leadership roster is routinely split across /about and /board-of-directors —
   * because then no single ctx snapshot is the true provenance of every claim,
   * and anchoring a claim to a snapshot that never contained it would be a
   * provenance lie. Falls back to ctx.sourceSnapshotId.
   */
  sourceSnapshotId?: string;
}

/** What one source observed about one institution on one page. */
export interface PeopleObservation {
  institutionId: string;
  /**
   * The role fields this page actually carries. This is what scopes retirement:
   * a slot absent from this list is never touched, so a source that publishes
   * only its board is not taken to have withdrawn the CEO it published last
   * month, and an unreadable slot is never mistaken for a withdrawal. Nothing
   * is inferred from silence; the caller states what it read.
   */
  observedFields: readonly string[];
  claims: readonly PeopleClaim[];
}

/** One other source's current claim that disagrees with an observed value. */
export interface PeopleConflictSide {
  sourceId: string;
  value: string;
}

/** What writing one observed claim would do to the stored claims. */
export interface PeopleClaimPlan {
  fieldName: string;
  value: string;
  confidence: number;
  /** The snapshot that carried this claim, when the observation named one. */
  sourceSnapshotId?: string;
  /** "UNCHANGED" when this source already has this exact value current. */
  kind: "NEW" | "UNCHANGED";
  /** This source's own current claims in this slot that this value replaces. */
  supersedes: StoredAssertion[];
  /** A retired row carrying this value, to revive instead of duplicating. */
  revives: StoredAssertion | null;
  /** Other sources whose CURRENT claim for this slot disagrees. */
  conflicts: PeopleConflictSide[];
}

/** Everything one page does to one institution's people claims. */
export interface PeopleObservationPlan {
  institutionId: string;
  slots: PeopleSlotPlan[];
}

export interface PeopleSlotPlan {
  fieldName: string;
  writes: PeopleClaimPlan[];
  /**
   * This source's current claims in an OBSERVED slot that the new page no
   * longer carries. Retiring these is what makes "B stopped reporting X" true
   * in the data instead of merely absent from the new page.
   */
  retires: StoredAssertion[];
}

/**
 * Decide, per role slot, exactly what one source's observation does.
 *
 * Read-then-write, deterministic, no writes: the same observation against the
 * same stored state always yields the same plan.
 */
export async function planPeopleEvidence(
  writer: EvidenceWriter,
  observation: PeopleObservation,
  sourceId: string,
): Promise<PeopleObservationPlan> {
  for (const c of observation.claims) {
    if (!isPeopleAssertionField(c.fieldName)) {
      throw new Error(`people evidence: "${c.fieldName}" is not a people_* field`);
    }
  }

  const slots = new Set<string>();
  for (const c of observation.claims) slots.add(c.fieldName);
  for (const f of observation.observedFields) {
    if (isPeopleAssertionField(f)) slots.add(f);
  }

  const planned: PeopleSlotPlan[] = [];
  for (const fieldName of [...slots].sort()) {
    const own = await writer.findAssertions({
      entityType: PEOPLE_ASSERTION_ENTITY_TYPE,
      entityId: observation.institutionId,
      fieldName,
      sourceId,
    });
    const ownCurrent = current(own);

    const all = await writer.findAssertions({
      entityType: PEOPLE_ASSERTION_ENTITY_TYPE,
      entityId: observation.institutionId,
      fieldName,
    });
    // Cross-source disagreement is read from CURRENT observations only, and
    // only ever from sources other than this one. Both sides stay stored; a
    // data_conflicts row is added. A retired claim is history and never counts
    // as a live disagreement.
    const others = current(all).filter((r) => r.source_id !== sourceId);

    const observed = observation.claims.filter((c) => c.fieldName === fieldName);
    const observedValues = new Set(observed.map((c) => normalizePeopleClaimValue(c.value)));

    const writes: PeopleClaimPlan[] = [];
    for (const claim of observed) {
      const want = normalizePeopleClaimValue(claim.value);
      const unchanged = ownCurrent.some((r) => normalizePeopleClaimValue(r.value) === want);
      writes.push({
        fieldName,
        value: claim.value,
        confidence: claim.confidence,
        sourceSnapshotId: claim.sourceSnapshotId,
        kind: unchanged ? "UNCHANGED" : "NEW",
        supersedes: unchanged ? [] : ownCurrent.filter((r) => normalizePeopleClaimValue(r.value) !== want),
        // A value that has come back: the writer's identity makes a re-insert a
        // silent no-op, so the retired row is revived rather than duplicated.
        // Only worth looking for when the claim is not already current.
        revives: unchanged ? null : own.find((r) => normalizePeopleClaimValue(r.value) === want) ?? null,
        conflicts: unchanged
          ? []
          : others
              .filter((r) => normalizePeopleClaimValue(r.value) !== want)
              .map((r) => ({ sourceId: r.source_id, value: r.value })),
      });
    }

    const retires = ownCurrent.filter((r) => !observedValues.has(normalizePeopleClaimValue(r.value)));
    if (writes.length > 0 || retires.length > 0) planned.push({ fieldName, writes, retires });
  }

  return { institutionId: observation.institutionId, slots: planned };
}

export interface PeopleApplyContext {
  sourceId: string;
  sourceSnapshotId: string;
  observedAt: string;
  runId: string;
  /** Confidence for NEW rows. Defaults to the claim's own confidence. */
  confidence?: number;
}

export type PeopleWriteStatus = "NEW" | "UNCHANGED" | "REVIVED" | "SUPERSEDED";

export interface AppliedPeopleClaim {
  fieldName: string;
  value: string;
  status: PeopleWriteStatus;
  conflicts: PeopleConflictSide[];
  /** The snapshot the written/revived row is anchored to. */
  sourceSnapshotId?: string;
}

export interface PeopleApplyResult {
  institutionId: string;
  /** True when this page observed nothing about the institution's people. */
  noObservation: boolean;
  writes: AppliedPeopleClaim[];
  /** Claim slots where two or more sources currently disagree. */
  conflictCount: number;
  newCount: number;
  unchangedCount: number;
  revivedCount: number;
  supersededCount: number;
}

/**
 * Write one source's observation of one institution's people.
 *
 * Per role slot, per source:
 *   - the identical current value       -> left alone (idempotent)
 *   - a different current value         -> this source's own prior claims are
 *                                          retired and the new one written
 *   - a value that has come back        -> the retired row is revived, never
 *                                          duplicated
 *   - a claim the page no longer makes  -> retired, so the read model stops
 *                                          publishing a withdrawn claim
 *   - another source's disagreeing claim-> an OPEN data_conflicts row, with
 *                                          both observations left intact
 *
 * Cross-source supersession never happens: only rows whose source_id is this
 * context's source are ever retired by this function.
 */
export async function applyPeopleEvidence(
  writer: EvidenceWriter,
  plan: PeopleObservationPlan,
  ctx: PeopleApplyContext,
): Promise<PeopleApplyResult> {
  const writes: AppliedPeopleClaim[] = [];

  // A page that observed nothing about people retires nothing. "This page had no
  // leadership roster" is not "the institution withdrew every claim it ever
  // published", and treating silence as withdrawal would delete good evidence.
  if (plan.slots.length === 0) {
    await writer.appendAudit({
      action: "PEOPLE_EVIDENCE_APPLIED",
      targetType: PEOPLE_ASSERTION_ENTITY_TYPE,
      targetId: plan.institutionId,
      afterJson: JSON.stringify({ source_id: ctx.sourceId, noObservation: true, runId: ctx.runId }),
    });
    return emptyResult(plan.institutionId, true);
  }

  for (const slot of plan.slots) {
    for (const w of slot.writes) {
      if (w.kind === "UNCHANGED") {
        // The source re-stated a claim it already holds current. That is not a
        // lifecycle change: no row is written, nothing is retired, nothing is
        // revived. But it IS a re-sighting, and the generic engine has always
        // recorded those in the ledger through saveAssertion's ignore path
        // (ASSERTION_RESEEN). Returning early here would silently delete that
        // audit trail for every people_* claim the moment apply took the path
        // over, so the same idempotent call is made deliberately.
        //
        // It is safe precisely because that path is a no-op on the row: INSERT OR
        // IGNORE writes nothing, and the stored claim keeps its ORIGINAL evidence
        // pointer and its verification_status, so re-sighting can neither
        // overwrite where a claim came from nor downgrade a human's review.
        await writer.saveAssertion({
          entityType: PEOPLE_ASSERTION_ENTITY_TYPE,
          entityId: plan.institutionId,
          fieldName: w.fieldName,
          value: w.value,
          sourceId: ctx.sourceId,
          sourceSnapshotId: w.sourceSnapshotId ?? ctx.sourceSnapshotId,
          observedAt: ctx.observedAt,
          confidence: ctx.confidence ?? w.confidence,
          // Passed for the ledger entry only; nothing writes this column.
          verificationStatus: "UNVERIFIED",
        });
        writes.push({ fieldName: w.fieldName, value: w.value, status: "UNCHANGED", conflicts: w.conflicts });
        continue;
      }

      for (const prior of w.supersedes) {
        await writer.supersedeAssertion({
          id: prior.id,
          validTo: ctx.observedAt,
          status: "STALE",
          reason: `re-observed with a different value from the same source (${ctx.sourceId})`,
        });
        writes.push({ fieldName: w.fieldName, value: prior.value, status: "SUPERSEDED", conflicts: [] });
      }

      // A claim is anchored to the snapshot that carried it. When one
      // observation aggregates several pages that differs per claim, so it is
      // resolved per claim and only falls back to the context.
      const snapshotId = w.sourceSnapshotId ?? ctx.sourceSnapshotId;

      if (w.revives && writer.reviveAssertion) {
        const ok = await writer.reviveAssertion({
          id: w.revives.id,
          observedAt: ctx.observedAt,
          sourceSnapshotId: snapshotId,
          confidence: ctx.confidence ?? w.confidence,
        });
        if (ok) {
          writes.push({ fieldName: w.fieldName, value: w.value, status: "REVIVED", conflicts: w.conflicts, sourceSnapshotId: snapshotId });
          continue;
        }
      }

      const input: AssertionInput = {
        entityType: PEOPLE_ASSERTION_ENTITY_TYPE,
        entityId: plan.institutionId,
        fieldName: w.fieldName,
        value: w.value,
        sourceId: ctx.sourceId,
        sourceSnapshotId: snapshotId,
        observedAt: ctx.observedAt,
        confidence: ctx.confidence ?? w.confidence,
        // Writing a claim is never verification. Only a human review can set
        // that, and nothing in this path produces one.
        verificationStatus: "UNVERIFIED",
      };
      await writer.saveAssertion(input);
          writes.push({ fieldName: w.fieldName, value: w.value, status: "NEW", conflicts: w.conflicts, sourceSnapshotId: snapshotId });
    }

    for (const prior of slot.retires) {
      await writer.supersedeAssertion({
        id: prior.id,
        validTo: ctx.observedAt,
        status: "STALE",
        reason: `the claim is no longer published by ${ctx.sourceId}`,
      });
      writes.push({ fieldName: slot.fieldName, value: prior.value, status: "SUPERSEDED", conflicts: [] });
    }
  }

  // Disagreement is recorded after every observation in this page is stored, so
  // the conflict rows can never describe a half-applied page.
  //
  // A dispute is recorded ONCE. A source that keeps disagreeing with another
  // source re-reports the same pair on every run, and appending a row each time
  // would grow the review queue without limit — while a pair a human has already
  // decided must never be reopened by a re-run. Both rules are the ones
  // flagPeopleConflicts already applies to the detector, so they are applied here
  // through the same writer operation rather than re-implemented.
  for (const w of writes) {
    for (const other of w.conflicts) {
      const existing = writer.findConflict
        ? await writer.findConflict({
            entityType: PEOPLE_ASSERTION_ENTITY_TYPE,
            entityId: plan.institutionId,
            fieldName: w.fieldName,
            sourceAId: other.sourceId,
            valueA: other.value,
            sourceBId: ctx.sourceId,
            valueB: w.value,
          })
        : null;
      if (existing) continue;
      const conflict: ConflictInput = {
        entityType: PEOPLE_ASSERTION_ENTITY_TYPE,
        entityId: plan.institutionId,
        fieldName: w.fieldName,
        sourceAId: other.sourceId,
        valueA: other.value,
        sourceBId: ctx.sourceId,
        valueB: w.value,
        detectedAt: ctx.observedAt,
        resolutionStatus: "OPEN",
        resolutionNote: "cross-source disagreement on the same people role field",
      };
      await writer.saveConflict(conflict);
    }
  }

  await writer.appendAudit({
    action: "PEOPLE_EVIDENCE_APPLIED",
    targetType: PEOPLE_ASSERTION_ENTITY_TYPE,
    targetId: plan.institutionId,
    afterJson: JSON.stringify({
      source_id: ctx.sourceId,
      runId: ctx.runId,
      // The snapshot each write is anchored to, so a re-sighting stays
      // attributable to the snapshot that carried the claim again.
      source_snapshot_id: ctx.sourceSnapshotId,
      writes: writes.map((w) => ({
        field: w.fieldName,
        value: w.value,
        status: w.status,
        // Per-claim, because one observation may aggregate several pages and
        // the snapshot that carried a claim is its real provenance.
        source_snapshot_id: w.sourceSnapshotId ?? ctx.sourceSnapshotId,
        conflicts: w.conflicts.map((c) => c.sourceId),
      })),
    }),
  });

  return {
    institutionId: plan.institutionId,
    noObservation: false,
    writes,
    conflictCount: writes.filter((w) => w.conflicts.length > 0).length,
    newCount: writes.filter((w) => w.status === "NEW").length,
    unchangedCount: writes.filter((w) => w.status === "UNCHANGED").length,
    revivedCount: writes.filter((w) => w.status === "REVIVED").length,
    supersededCount: writes.filter((w) => w.status === "SUPERSEDED").length,
  };
}

function emptyResult(institutionId: string, noObservation: boolean): PeopleApplyResult {
  return {
    institutionId,
    noObservation,
    writes: [],
    conflictCount: 0,
    newCount: 0,
    unchangedCount: 0,
    revivedCount: 0,
    supersededCount: 0,
  };
}
