// ============================================================================
// P1-7 — uniform status vocabulary acceptance tests.
//
// `docs/DATA-STATUS-VOCABULARY.md` requires one vocabulary for statuses across
// every page. These assert the shared `src/util/evidence.ts` mapping is the
// single authority for source health, run outcome, and evidence field state, so
// a page can no longer invent its own label or tone.
//
// Run: npm run smoke:vocabulary
// ============================================================================
import {
  fieldState,
  runStatus,
  sourceStatus,
  UNKNOWN_LABEL,
  verificationStatus,
} from "../src/util/evidence";

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

// Source health: every token the ingestion UI and the database use must resolve
// to a labelled, toned presentation — no page-local map.
for (const token of ["HEALTHY", "DEGRADED", "UNHEALTHY", "ERROR", "PAUSED", "NEVER-RUN", "never_run"]) {
  const s = sourceStatus(token);
  check(`sourceStatus(${token}) labelled`, s.label.length > 0 && s.label !== token);
}
check("sourceStatus(UNHEALTHY) tone conflict", sourceStatus("UNHEALTHY").tone === "conflict");
check("sourceStatus(ERROR) shares UNHEALTHY label", sourceStatus("ERROR").label === sourceStatus("UNHEALTHY").label);
check("sourceStatus hyphens fold (NEVER-RUN == NEVER_RUN)", sourceStatus("NEVER-RUN").label === sourceStatus("NEVER_RUN").label);
check("sourceStatus(null) is not a raw token", !/null|undefined/i.test(sourceStatus(null).label));

// Run outcome: the ingestion page's local LAST_RUN_TONE vocabulary now lives here.
for (const token of ["SUCCESS", "PARTIAL", "FAILED", "SKIPPED"]) {
  const s = runStatus(token);
  check(`runStatus(${token}) labelled`, s.label.length > 0);
}
check("runStatus(SUCCESS) tone positive", runStatus("SUCCESS").tone === "positive");
check("runStatus(FAILED) tone conflict", runStatus("FAILED").tone === "conflict");

// Evidence field state: lowercase domain tokens resolve without a page map.
for (const token of ["candidate", "verified", "pending_reverification"]) {
  const s = fieldState(token);
  check(`fieldState(${token}) labelled`, s.label.length > 0 && s.label !== token);
}
check("fieldState(verified) tone positive", fieldState("verified").tone === "positive");
check("fieldState(pending_reverification) tone attention", fieldState("pending_reverification").tone === "attention");

// Verification status still resolves through the same module.
check("verificationStatus resolves a known token", verificationStatus("human_verified").label.length > 0);

// The canonical unknown word is exported, not re-invented per page.
check("UNKNOWN_LABEL is canonical", UNKNOWN_LABEL === "Unknown");

console.log(`\nsmoke:vocabulary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
