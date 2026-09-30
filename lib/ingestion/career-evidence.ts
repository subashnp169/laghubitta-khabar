/**
 * M3.5 careers — evidence planning and application.
 *
 * This module is the only place that turns a parsed `VacancyRecord` into stored
 * assertions. It owns three decisions, and each one is a rule rather than a
 * judgement call:
 *
 *  1. WHAT may be asserted. Structural support asserts at >= 0.5. A deadline
 *     read out of prose stays at 0.45 and is stored as evidence, never as fact.
 *  2. WHEN an assertion is new. Idempotency is a read of what is already stored
 *     followed by a conditional write, because the frozen schema has no
 *     uniqueness constraint on `data_assertions` and a blind insert would append
 *     a duplicate on every run.
 *  3. WHAT happens when the same field is seen again with a different value. The
 *     prior assertion is closed out as STALE with a `valid_to`, never deleted, and
 *     the new one is inserted. Two sources disagreeing is a conflict row, not an
 *     overwrite.
 *
 * It writes nothing about closure. A vacancy that is absent from a later listing
 * is `NOT_LISTED`, a state the projection derives from observation history, and
 * asserting "closed" from a missing listing would be inventing a fact the
 * fetcher never observed.
 */

import type {
  AssertionInput,
  ConflictInput,
  EvidenceWriter,
  StoredAssertion,
} from "./contract";
import {
  DEADLINE,
  JOB_TITLE,
  SOURCE_DOCUMENT,
  deadlineConfidence,
  type VacancyField,
  type VacancyRecord,
  vacancyId,
} from "./careers";

/** The entity type every careers assertion is written under. */
export const VACANCY_ENTITY_TYPE = "VACANCY";

/** Parser versions, recorded on the snapshot so a rule change is visible. */
export const CAREER_PARSER_VERSION = "careers-html-v1";
export const CAREER_JSON_PARSER_VERSION = "careers-json-v1";

/** The confidence at or above which a stored assertion is a publishable fact. */
export const PUBLISHABLE_CONFIDENCE = 0.5;

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** One assertion the planner intends to write, before any decision is made. */
export interface PlannedAssertion {
  fieldName: string;
  value: string;
  confidence: number;
  /** True when stored for audit but below the publishable threshold. */
  evidenceOnly: boolean;
}

export interface PlannedVacancy {
  entityId: string;
  institutionId: string;
  title: string;
  pageUrl: string;
  shape: VacancyRecord["shape"];
  assertions: PlannedAssertion[];
  /** Values found but refused, with the reason. Never silently dropped. */
  rejections: VacancyRecord["rejections"];
}

/** The confidence to write for one field, given how it was supported. */
function confidenceFor(f: VacancyField): number {
  if (f.field === DEADLINE) {
    const support = f.support === "column" ? "column" : "text";
    return deadlineConfidence(support);
  }
  if (f.evidenceOnly) return 0.45;
  return f.support === "column" || f.support === "structure" ? 0.5 : 0.45;
}

/**
 * Plan the assertions for one vacancy.
 *
 * The title is always planned: without it there is no identity, so a record
 * without one never reaches this function. Every other field is planned at the
 * confidence its own support earned, which is why a declared "Location" column
 * and a "Location:" label in prose are not the same claim.
 */
export function planVacancyEvidence(rec: VacancyRecord, institutionId: string): PlannedVacancy {
  const entityId = vacancyId(institutionId, rec.title, rec.location);
  const seen = new Set<string>();
  const assertions: PlannedAssertion[] = [];

  // The title is planned unconditionally and separately: without it there is no
  // identity, so a record without one never reaches this function. Every other
  // field is planned at the confidence its own support earned, which is why a
  // declared "Location" column and a "Location:" label in prose are not the same
  // claim.
  assertions.push({ fieldName: JOB_TITLE, value: rec.title, confidence: 0.6, evidenceOnly: false });
  seen.add(JOB_TITLE);

  for (const f of rec.fields) {
    if (f.field === JOB_TITLE) continue;
    if (f.rejection) continue; // a refused value is not a value
    if (seen.has(f.field)) continue; // first support for a field wins
    const confidence = confidenceFor(f);
    if (confidence <= 0) continue;
    seen.add(f.field);
    assertions.push({
      fieldName: f.field,
      value: f.value,
      confidence,
      evidenceOnly: confidence < PUBLISHABLE_CONFIDENCE,
    });
  }

  return {
    entityId,
    institutionId,
    title: rec.title,
    pageUrl: rec.page_url,
    shape: rec.shape,
    assertions,
    rejections: rec.rejections,
  };
}

/**
 * Plan the evidence for a vacancy document (a PDF notice, typically).
 *
 * A document is asserted as a document and nothing else. Its text is not
 * extracted, so no field inside it is supported by anything this system can
 * show, and asserting one would be a claim about a file nobody read.
 */
export function planVacancyDocumentEvidence(input: {
  institutionId: string;
  url: string;
  label: string;
}): { entityId: string; assertion: PlannedAssertion } {
  return {
    entityId: vacancyId(input.institutionId, input.label, null),
    assertion: {
      fieldName: SOURCE_DOCUMENT,
      value: input.url,
      confidence: 0.5,
      evidenceOnly: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export type VacancyWriteStatus = "NEW" | "UNCHANGED" | "CHANGED" | "CONFLICTED";

export interface AppliedAssertion {
  fieldName: string;
  value: string;
  status: VacancyWriteStatus;
  /** True when another source holds a different value for this field. */
  conflictedWith: string[];
}

export interface AppliedVacancy {
  entityId: string;
  title: string;
  pageUrl: string;
  writes: AppliedAssertion[];
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  conflictCount: number;
  rejections: VacancyRecord["rejections"];
}

export interface ApplyContext {
  sourceId: string;
  sourceSnapshotId: string;
  observedAt: string;
  runId: string;
}

/** The still-current assertions among a stored set. */
function active(rows: readonly StoredAssertion[]): StoredAssertion[] {
  return rows.filter((r) => r.valid_to === null);
}

/**
 * Write one planned vacancy's assertions.
 *
 * Per field, per source: an identical current value is left alone, a different
 * current value closes the old assertion out and appends the new one, and any
 * disagreement from a *different* source is recorded as a conflict while both
 * values stay readable. Cross-source disagreement never overwrites.
 */
export async function applyVacancyEvidence(
  writer: EvidenceWriter,
  planned: PlannedVacancy,
  ctx: ApplyContext,
): Promise<AppliedVacancy> {
  const writes: AppliedAssertion[] = [];

  for (const a of planned.assertions) {
    const own = await writer.findAssertions({
      entityType: VACANCY_ENTITY_TYPE,
      entityId: planned.entityId,
      fieldName: a.fieldName,
      sourceId: ctx.sourceId,
    });
    const ownActive = active(own);

    // What any other source currently says about this field on this entity.
    const all = await writer.findAssertions({
      entityType: VACANCY_ENTITY_TYPE,
      entityId: planned.entityId,
      fieldName: a.fieldName,
    });
    const others = active(all).filter((r) => r.source_id !== ctx.sourceId);
    const conflictedWith = others.filter((r) => r.value !== a.value).map((r) => r.source_id);

    for (const other of conflictedWith) {
      const otherRow = others.find((r) => r.source_id === other && r.value !== a.value);
      const conflict: ConflictInput = {
        entityType: VACANCY_ENTITY_TYPE,
        entityId: planned.entityId,
        fieldName: a.fieldName,
        sourceAId: other,
        valueA: otherRow?.value ?? "",
        sourceBId: ctx.sourceId,
        valueB: a.value,
        detectedAt: ctx.observedAt,
        resolutionStatus: "OPEN",
        resolutionNote: "cross-source disagreement on the same vacancy identity",
      };
      await writer.saveConflict(conflict);
    }

    if (ownActive.some((r) => r.value === a.value)) {
      writes.push({ fieldName: a.fieldName, value: a.value, status: "UNCHANGED", conflictedWith });
      continue;
    }

    for (const prior of ownActive) {
      await writer.supersedeAssertion({
        id: prior.id,
        validTo: ctx.observedAt,
        status: "STALE",
        reason: "re-observed with a different value from the same source",
      });
    }

    // A value that has come back. The semantic identity of an assertion is
    // (entity, field, source, value), so this exact row already exists in the
    // table, retired. Inserting again is silently ignored by the writer and the
    // field would be left with no current claim, so the row is revived instead.
    const reverted = own.find((r) => r.value === a.value);
    if (reverted && writer.reviveAssertion) {
      const ok = await writer.reviveAssertion({
        id: reverted.id,
        observedAt: ctx.observedAt,
        sourceSnapshotId: ctx.sourceSnapshotId,
        confidence: a.confidence,
      });
      if (ok) {
        writes.push({ fieldName: a.fieldName, value: a.value, status: "CHANGED", conflictedWith });
        continue;
      }
    }

    const input: AssertionInput = {
      entityType: VACANCY_ENTITY_TYPE,
      entityId: planned.entityId,
      fieldName: a.fieldName,
      value: a.value,
      sourceId: ctx.sourceId,
      sourceSnapshotId: ctx.sourceSnapshotId,
      observedAt: ctx.observedAt,
      confidence: a.confidence,
      // A stored assertion is never "verified" by the act of being written. Only
      // a human review can set that, and M3.5 produces none.
      verificationStatus: "UNVERIFIED",
    };
    await writer.saveAssertion(input);
    writes.push({
      fieldName: a.fieldName,
      value: a.value,
      status: ownActive.length > 0 ? "CHANGED" : "NEW",
      conflictedWith,
    });
  }

  await writer.appendAudit({
    action: "VACANCY_EVIDENCE_APPLIED",
    targetType: VACANCY_ENTITY_TYPE,
    targetId: planned.entityId,
    afterJson: JSON.stringify({
      title: planned.title,
      pageUrl: planned.pageUrl,
      shape: planned.shape,
      runId: ctx.runId,
      fields: planned.assertions.map((x) => ({
        field: x.fieldName,
        confidence: x.confidence,
        evidenceOnly: x.evidenceOnly,
      })),
      writes: writes.map((w) => ({ field: w.fieldName, status: w.status, conflicts: w.conflictedWith })),
      rejections: planned.rejections,
    }),
  });

  return {
    entityId: planned.entityId,
    title: planned.title,
    pageUrl: planned.pageUrl,
    writes,
    newCount: writes.filter((w) => w.status === "NEW").length,
    changedCount: writes.filter((w) => w.status === "CHANGED").length,
    unchangedCount: writes.filter((w) => w.status === "UNCHANGED").length,
    conflictCount: conflictsIn(writes),
    rejections: planned.rejections,
  };
}

function conflictsIn(writes: readonly AppliedAssertion[]): number {
  return writes.filter((w) => w.conflictedWith.length > 0).length;
}

/** Assert a vacancy document link. No fields are invented for its contents. */
export async function applyVacancyDocument(
  writer: EvidenceWriter,
  plan: ReturnType<typeof planVacancyDocumentEvidence>,
  ctx: ApplyContext,
): Promise<{ entityId: string; status: VacancyWriteStatus }> {
  const own = await writer.findAssertions({
    entityType: VACANCY_ENTITY_TYPE,
    entityId: plan.entityId,
    fieldName: SOURCE_DOCUMENT,
    sourceId: ctx.sourceId,
  });
  if (active(own).some((r) => r.value === plan.assertion.value)) {
    return { entityId: plan.entityId, status: "UNCHANGED" };
  }
  for (const prior of active(own)) {
    await writer.supersedeAssertion({ id: prior.id, validTo: ctx.observedAt, status: "STALE", reason: "document link re-observed" });
  }
  const reverted = own.find((r) => r.value === plan.assertion.value);
  if (reverted && writer.reviveAssertion) {
    const ok = await writer.reviveAssertion({
      id: reverted.id,
      observedAt: ctx.observedAt,
      sourceSnapshotId: ctx.sourceSnapshotId,
      confidence: plan.assertion.confidence,
    });
    if (ok) return { entityId: plan.entityId, status: "CHANGED" };
  }
  const input: AssertionInput = {
    entityType: VACANCY_ENTITY_TYPE,
    entityId: plan.entityId,
    fieldName: SOURCE_DOCUMENT,
    value: plan.assertion.value,
    sourceId: ctx.sourceId,
    sourceSnapshotId: ctx.sourceSnapshotId,
    observedAt: ctx.observedAt,
    confidence: plan.assertion.confidence,
    verificationStatus: "UNVERIFIED",
  };
  await writer.saveAssertion(input);
  return { entityId: plan.entityId, status: own.length > 0 ? "CHANGED" : "NEW" };
}

/** True when a stored assertion's confidence clears the publishable bar. */
export function isPublishableAssertion(row: { confidence: number }): boolean {
  return row.confidence >= PUBLISHABLE_CONFIDENCE;
}
