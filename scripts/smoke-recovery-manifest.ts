// ============================================================================
// V1.1.2 — recovery manifest contract.
//
// Run: npm run smoke:recovery-manifest
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

const csv = read("docs/data/RECOVERY-MANIFEST.csv");
const summary = read("docs/data/RECOVERY-MANIFEST-SUMMARY.md");

check("CSV exists and is non-empty", csv.length > 0);
check("CSV header present", csv.startsWith("item_id,item_type,source_id"));
check("CSV has 55 data rows", csv.trim().split("\n").length - 1 === 55);
check("summary exists and is non-empty", summary.length > 0);
check("summary states 47 partial", /PARTIAL ingestion runs: \*\*47\*\*/.test(summary));
check("summary states 8 stubs", /Pilot-stub institutions.*\*\*8\*\*/.test(summary));
check("summary states 55 total", /Total manifest rows: \*\*55\*\*/.test(summary));
check("summary states no mutation", summary.includes("No ingestion was executed"));
check("CSV has PARTIAL_RUN rows", csv.includes("PARTIAL_RUN"));
check("CSV has PILOT_STUB rows", csv.includes("PILOT_STUB"));

// Determinism
const before = csv;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync } = require("node:child_process");
execSync("npm run recovery:manifest", { cwd: root, stdio: "pipe" });
const after = read("docs/data/RECOVERY-MANIFEST.csv");
check("manifest is deterministic (byte-identical on re-run)", before === after);

console.log(`\nsmoke:recovery-manifest: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
