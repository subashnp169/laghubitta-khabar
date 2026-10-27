// ============================================================================
// P4-1 — snapshot diff (pure).
//
// Compares two sets of evidence assertions (a "before" and an "after" run) and
// reports what actually changed, carrying the REAL observation timestamp of the
// changed row — never an invented date. This is the engine behind the
// "what changed since last run" alerts; it is pure (no DB, no I/O, no
// randomness) so a smoke can drive it with fixtures.
//
// Identity of a change is (entityType, entityId, fieldName, value). A row that
// exists in `after` but not `before` is "added"; one in `before` but not `after`
// is "removed". Rows present in both (same identity) are unchanged and produce
// no alert. A field whose value changed surfaces as one "removed" + one "added"
// — two honest facts, never a synthesised "changed" label that hides either side.
// ============================================================================

export interface DiffAssertion {
  id: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  value: string;
  sourceId: string;
  observedAt: string;
  confidence: number | null;
  verificationStatus: string;
}

export type DiffChangeKind = "added" | "removed";

export interface DiffChange {
  kind: DiffChangeKind;
  entityType: string;
  entityId: string;
  fieldName: string;
  value: string;
  sourceId: string;
  /** Real observation timestamp of the row that carries this change. */
  observedAt: string;
  confidence: number | null;
  verificationStatus: string;
}

function key(a: DiffAssertion): string {
  return `${a.entityType}|${a.entityId}|${a.fieldName}|${a.value}`;
}

/**
 * Diff two assertion sets. Output is sorted deterministically: by observedAt
 * desc, then kind, then entityId, then fieldName, then value. Empty inputs give
 * an empty result (no fabrication).
 */
export function diffAssertions(before: DiffAssertion[], after: DiffAssertion[]): DiffChange[] {
  const beforeKeys = new Set(before.map(key));
  const afterKeys = new Set(after.map(key));

  const changes: DiffChange[] = [];

  for (const a of after) {
    if (!beforeKeys.has(key(a))) {
      // Only emit if observedAt is a real timestamp; skip rows without one rather
      // than fabricating a date.
      if (typeof a.observedAt === "string" && a.observedAt.trim().length > 0) {
        changes.push({
          kind: "added",
          entityType: a.entityType,
          entityId: a.entityId,
          fieldName: a.fieldName,
          value: a.value,
          sourceId: a.sourceId,
          observedAt: a.observedAt,
          confidence: a.confidence,
          verificationStatus: a.verificationStatus,
        });
      }
    }
  }

  for (const b of before) {
    if (!afterKeys.has(key(b))) {
      if (typeof b.observedAt === "string" && b.observedAt.trim().length > 0) {
        changes.push({
          kind: "removed",
          entityType: b.entityType,
          entityId: b.entityId,
          fieldName: b.fieldName,
          value: b.value,
          sourceId: b.sourceId,
          observedAt: b.observedAt,
          confidence: b.confidence,
          verificationStatus: b.verificationStatus,
        });
      }
    }
  }

  changes.sort((x, y) => {
    if (x.observedAt !== y.observedAt) return x.observedAt < y.observedAt ? 1 : -1;
    if (x.kind !== y.kind) return x.kind < y.kind ? -1 : 1;
    if (x.entityId !== y.entityId) return x.entityId < y.entityId ? -1 : 1;
    if (x.fieldName !== y.fieldName) return x.fieldName < y.fieldName ? -1 : 1;
    return x.value < y.value ? -1 : 1;
  });

  return changes;
}

/** Convenience: how many changes of each kind. */
export function diffSummary(changes: DiffChange[]): { added: number; removed: number; total: number } {
  let added = 0;
  let removed = 0;
  for (const c of changes) {
    if (c.kind === "added") added += 1;
    else removed += 1;
  }
  return { added, removed, total: changes.length };
}
