// ============================================================================
// P11 — contribution / auth / moderation contract.
//
// The frozen spec fixes a read-only public surface with no write path. This
// smoke locks that invariant plus the read-only intake surface:
//   * every API route is GET (no write methods anywhere in the contract);
//   * no write endpoints in lib/api/routes.ts;
//   * /contribute page exists and states the read-only rule;
//   * footer links to /contribute.
//
// Run: npm run smoke:contribute-p11
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

const routes = read("lib/api/routes.ts");
check("every API route is GET", !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(routes));
check("no write verbs in routes", !/\b(POST|PUT|PATCH|DELETE)\b/.test(routes.replace(/\/\/.*/g, "")));

const page = read("src/app/contribute/page.tsx");
check("contribute page exists", page.length > 0);
check("contribute page states read-only", page.includes("read-only") || page.includes("read only"));
check("contribute page links to GitHub", page.includes("github.com"));

const footer = read("src/components/layout/Footer.tsx");
check("footer links to /contribute", footer.includes('href: "/contribute"'));

console.log(`\nsmoke:contribute-p11: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
