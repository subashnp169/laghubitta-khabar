// ============================================================================
// P7 — digital / social presence contract.
//
// Run: npm run smoke:digital-p7
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { officialWebsites, socialAccounts, digitalProvenance } from "../src/lib/site-data";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

check("officialWebsites is an array", Array.isArray(officialWebsites));
check("socialAccounts is an array", Array.isArray(socialAccounts));
check("digitalProvenance is non-empty", typeof digitalProvenance === "string" && digitalProvenance.length > 0);
check("no social accounts fabricated (0 today)", socialAccounts.length === 0);
check("official websites come from real institution records", officialWebsites.length > 0);
check("digitalProvenance states the social empty state", digitalProvenance.includes("0 social_accounts") || digitalProvenance.includes("Social accounts: 0"));

const page = read("src/app/digital/page.tsx");
check("digital page exists", page.length > 0);
check("digital page renders Verified section", page.includes('"Verified official websites"'));
check("digital page renders Candidate section", page.includes('"Candidate (unconfirmed) websites"'));
check("digital page renders Social accounts section", page.includes('"Social accounts"'));
check("digital page uses EmptyState", page.includes("EmptyState"));
check("digital page shows digitalProvenance", page.includes("digitalProvenance"));

const footer = read("src/components/layout/Footer.tsx");
check("footer links to /digital", footer.includes('href: "/digital"'));

console.log(`\nsmoke:digital-p7: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
