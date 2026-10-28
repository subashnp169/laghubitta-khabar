// ============================================================================
// V1.1 — data-quality report contract.
//
// Locks the report's honesty and determinism:
//   * the report file exists and is non-empty;
//   * it states the reference "as of" (latest ingestion run, not wall clock);
//   * it reports 51 institutions, 43 with data, 5083 assertions, 229 conflicts;
//   * it reports 264 runs (217 success, 47 partial);
//   * it lists the staleness section with 13 stale pairs;
//   * re-running the generator produces byte-identical output (determinism).
//
// Run: npm run smoke:data-quality
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const reportPath = "docs/data/DATA-QUALITY-REPORT.md";
const before = read(reportPath);
check("report file exists and is non-empty", before.length > 0);
check("report uses a reference 'as of' (not wall clock)", /Reference "as of": latest ingestion run/.test(before));
check("report states 51 institutions", /Institutions in registry: \*\*51\*\*/.test(before));
check("report states 43 with data", /Institutions with assertion-level data: \*\*43\*\*/.test(before));
check("report states 5083 assertions", /Total assertions: \*\*5083\*\*/.test(before));
check("report states 229 conflicts", /Total conflict rows: \*\*229\*\*/.test(before));
check("report states 264 runs", /Runs: .*total 264/.test(before));
check("report has staleness section", before.includes("## 6b. Staleness"));
check("report lists 13 stale pairs", /Stale \(source, field-group\) pairs: \*\*13\*\*/.test(before));
check("report states 0 missing source_id", /Missing source_id: \*\*0\*\*/.test(before));
check("report states 0 missing observed_at", /Missing observed_at: \*\*0\*\*/.test(before));

// Determinism: re-run and compare.
execSync("npm run report:data-quality", { cwd: root, stdio: "pipe" });
const after = read(reportPath);
check("report is deterministic (byte-identical on re-run)", before === after);

console.log(`\nsmoke:data-quality: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
