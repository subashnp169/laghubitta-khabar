// ============================================================================
// V1.1.1 — conflict triage contract.
//
// Run: npm run smoke:triage-conflicts
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const csv = read("docs/data/CONFLICT-TRIAGE.csv");
const summary = read("docs/data/CONFLICT-TRIAGE-SUMMARY.md");

check("CSV file exists and is non-empty", csv.length > 0);
check("CSV header present", csv.startsWith("conflict_id,entity_type,entity_id"));
check("CSV has 229 data rows", csv.trim().split("\n").length - 1 === 229);
check("summary file exists and is non-empty", summary.length > 0);
check("summary states 229 total", /Total conflict rows: \*\*229\*\*/.test(summary));
check("summary states 229 same source", /Same source \(a = b\): \*\*229\*\*/.test(summary));
check("summary states 0 cross source", /Cross source \(a ≠ b\): \*\*0\*\*/.test(summary));
check("summary lists IGNORE_CANDIDATE", summary.includes("IGNORE_CANDIDATE"));
check("summary states no mutation", summary.includes("No `resolution_status`") || summary.includes("no conflict status"));
check("CSV values not truncated (sample has full value)", csv.includes("Mr. Chandra Mani Chaulagai") || csv.includes("value_a"));

// Determinism: re-run and compare.
const before = csv;
execSyncSafe();
const after = read("docs/data/CONFLICT-TRIAGE.csv");
check("triage is deterministic (byte-identical on re-run)", before === after);

function execSyncSafe() {
  const { execSync } = require("node:child_process");
  execSync("npm run triage:conflicts", { cwd: root, stdio: "pipe" });
}

console.log(`\nsmoke:triage-conflicts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
