// ============================================================================
// P2-4 — branch coverage completeness acceptance.
//
// A published branch list is only ever what an institution published on a page
// we could read. The honest presentation is a coverage state, not a bare count:
// Partial, Not extracted or Unknown. This asserts the shared
// `src/util/branches.ts` mapping, and in particular that a zero can never be
// read as "this institution has no branches".
//
// Run: npm run smoke:branch-coverage
// ============================================================================
import {
  BRANCH_COVERAGE,
  branchCoverage,
  type BranchCoverageState,
} from "../src/util/branches";

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

const STATES: BranchCoverageState[] = ["partial", "not_extracted", "unknown"];
const TONES = new Set(["positive", "attention", "conflict", "info", "neutral"]);

check("exactly three coverage states are defined", Object.keys(BRANCH_COVERAGE).length === STATES.length);
for (const state of STATES) {
  const p = BRANCH_COVERAGE[state];
  check(`${state}: present`, Boolean(p));
  check(`${state}: label non-empty and not the raw token`, p.label.length > 0 && p.label !== state.replace(/_/g, " "));
  check(`${state}: tone is a known tone`, TONES.has(p.tone));
  check(`${state}: help is a sentence`, p.help.length > 20 && /[.!?]$/.test(p.help));
}

// A non-200 read model is Unknown — we could not read the records.
const unknown = branchCoverage(500, 0);
check("status 500 -> unknown", unknown.state === "unknown");
check("status 404 -> unknown", branchCoverage(404, 12).state === "unknown");
check("unknown resolves its label/tone/help from the table", unknown.label === BRANCH_COVERAGE.unknown.label && unknown.tone === BRANCH_COVERAGE.unknown.tone);

// Branches present -> Partial. We only ever have what was published.
const partialOne = branchCoverage(200, 1);
check("200 with 1 branch -> partial", partialOne.state === "partial");
check("200 with many branches -> partial", branchCoverage(200, 240).state === "partial");
check("partial never claims completeness in its help", /may|higher|more/i.test(BRANCH_COVERAGE.partial.help));

// No branches -> Not extracted (a coverage gap), never a zero-claim.
const none = branchCoverage(200, 0);
check("200 with 0 branches -> not_extracted", none.state === "not_extracted");
check("not_extracted help says it is not a statement of no branches", /not a statement|no branches/i.test(BRANCH_COVERAGE.not_extracted.help));
check("not_extracted is not the positive tone (a gap is not good news)", BRANCH_COVERAGE.not_extracted.tone !== "positive");

// The mapping returns the full presentation so callers never reconstruct it.
for (const [status, count, want] of [
  [200, 0, "not_extracted"],
  [200, 5, "partial"],
  [503, 5, "unknown"],
] as const) {
  const cov = branchCoverage(status, count);
  check(`branchCoverage(${status}, ${count}) -> ${want}`, cov.state === want && cov.label.length > 0 && cov.help.length > 0);
}

console.log(`\nsmoke:branch-coverage: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
