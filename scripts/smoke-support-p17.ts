// ============================================================================
// P17 — monetization contract.
//
// Run: npm run smoke:support-p17
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

const page = read("src/app/support/page.tsx");
check("support page exists", page.length > 0);
check("states no paid products", page.includes("No paid products") || page.includes("no paid") || page.includes("Nothing is monetised"));
check("links to GitHub Sponsors", page.includes("github.com/sponsors"));
check("links to GitHub issue", page.includes("github.com"));

const footer = read("src/components/layout/Footer.tsx");
check("footer links to /support", footer.includes('href: "/support"'));

console.log(`\nsmoke:support-p17: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
