// ============================================================================
// P4-1 — snapshot-diff alerts contract.
//
// Locks the properties that keep "what changed since last run" honest:
//   * the pure diff engine reports only rows that actually differ (added /
//     removed) and never invents a "changed" label that hides either side;
//   * rows without a real observation timestamp are dropped, never dated;
//   * identical inputs produce identical output (deterministic);
//   * buildDiffAlerts emits one alert per change, each carrying a REAL
//     occurredAt (never null) and only the allowed kinds/severities;
//   * the generated module (src/data/diff-alerts.ts) exists, is well-formed,
//     and every entry has a real timestamp.
//
// Run: npm run smoke:diff-alerts
// ============================================================================
import { diffAssertions, diffSummary } from "../lib/diff";
import { buildDiffAlerts } from "../lib/alerts";
import type { DiffAssertion } from "../lib/diff";
import { diffChanges, diffAlertsSource } from "../src/data/diff-alerts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log("  ok  ", name);
  } else {
    fail += 1;
    console.log("  FAIL", name);
  }
}

const A = (overrides: Partial<DiffAssertion> = {}): DiffAssertion => ({
  id: "a1",
  entityType: "institution",
  entityId: "mfi-001",
  fieldName: "people_director",
  value: "Alice",
  sourceId: "src-a",
  observedAt: "2026-09-27T06:00:00.000Z",
  confidence: 0.6,
  verificationStatus: "UNVERIFIED",
  ...overrides,
});

// --- Pure engine -------------------------------------------------------------
check("empty inputs -> empty diff", diffAssertions([], []).length === 0);
const before = [A(), A({ id: "a2", value: "Bob", observedAt: "2026-09-27T05:00:00.000Z" })];
const after = [A(), A({ id: "a3", value: "Carol", observedAt: "2026-09-28T07:00:00.000Z" })];
const changes = diffAssertions(before, after);
check("an added value is reported", changes.some((c) => c.kind === "added" && c.value === "Carol"));
check("a removed value is reported", changes.some((c) => c.kind === "removed" && c.value === "Bob"));
check("an unchanged value produces no change", !changes.some((c) => c.value === "Alice"));
check("diff is deterministic", JSON.stringify(diffAssertions(before, after)) === JSON.stringify(changes));

// Rows without a real observed_at are dropped, not dated.
const noDate: DiffAssertion = A({ id: "nd", value: "NoDate", observedAt: "" });
const changes2 = diffAssertions([], [noDate]);
check("a row with no observed_at is dropped (never fabricated)", changes2.length === 0);

// diffSummary counts.
const s = diffSummary(changes);
check("diffSummary total matches changes length", s.total === changes.length);
check("diffSummary added+removed == total", s.added + s.removed === s.total);

// --- buildDiffAlerts ---------------------------------------------------------
const alerts = buildDiffAlerts(changes);
check("one alert per change", alerts.length === changes.length);
check("every diff alert has a non-null occurredAt", alerts.every((a) => typeof a.occurredAt === "string" && (a.occurredAt as string).length > 0));
check("every diff alert kind is SNAPSHOT_DIFF", alerts.every((a) => a.kind === "SNAPSHOT_DIFF"));
check("every diff alert severity is medium or low", alerts.every((a) => a.severity === "medium" || a.severity === "low"));
check("buildDiffAlerts([]) is empty", buildDiffAlerts([]).length === 0);

// --- Generated module --------------------------------------------------------
check("generated module exports diffChanges", Array.isArray(diffChanges));
check("generated module exports diffAlertsSource", typeof diffAlertsSource === "object" && diffAlertsSource !== null);
check("diffAlertsSource has before/after labels", typeof diffAlertsSource.before === "string" && typeof diffAlertsSource.after === "string");
check("every generated change has a real observedAt", diffChanges.every((c) => typeof c.observedAt === "string" && c.observedAt.trim().length > 0));
check("generated diff is non-empty for the default pair", diffChanges.length > 0);

const added = diffChanges.filter((c) => c.kind === "added").length;
const removed = diffChanges.filter((c) => c.kind === "removed").length;
check(`generated diff counts reconcile (added=${added}, removed=${removed})`, added + removed === diffChanges.length);

console.log(`\nsmoke:diff-alerts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);