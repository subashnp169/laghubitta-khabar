// ============================================================================
// P10 — media / activity contract.
//
// Locks the honest shape of the media surface:
//   * the generated module exists and is well-formed;
//   * every array is an array; counts are non-negative integers;
//   * mediaProvenance is a non-empty string stating the (empty) state honestly;
//   * the /media page renders the three sections and the provenance note;
//   * no fabricated rows (all three arrays empty until media is ingested).
//
// Run: npm run smoke:media-p10
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { videos, posts, digitalServices, mediaProvenance } from "../src/lib/site-data";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

check("videos is an array", Array.isArray(videos));
check("posts is an array", Array.isArray(posts));
check("digitalServices is an array", Array.isArray(digitalServices));
check("mediaProvenance is non-empty", typeof mediaProvenance === "string" && mediaProvenance.length > 0);
check("mediaProvenance states the empty state honestly", /0 (video|post|digital)/.test(mediaProvenance) || mediaProvenance.includes("no media") || mediaProvenance.includes("holds 0"));
check("no fabricated rows (all empty today)", videos.length === 0 && posts.length === 0 && digitalServices.length === 0);

const page = read("src/app/media/page.tsx");
check("media page exists", page.length > 0);
check("media page renders Videos section", page.includes('"Videos"'));
check("media page renders Posts section", page.includes('"Posts"'));
check("media page renders Digital services section", page.includes('"Digital services"'));
check("media page uses EmptyState", page.includes("EmptyState"));
check("media page shows mediaProvenance", page.includes("mediaProvenance"));

const footer = read("src/components/layout/Footer.tsx");
check("footer links to /media", footer.includes('href: "/media"'));

console.log(`\nsmoke:media-p10: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
