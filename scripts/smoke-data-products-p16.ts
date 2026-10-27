// ============================================================================
// P16 — data products / research contract.
//
// Run: npm run smoke:data-products-p16
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

const page = read("src/app/data-products/page.tsx");
check("data-products page exists", page.length > 0);
check("lists /search", page.includes('href: "/search"') || page.includes('href="/search"'));
check("lists /api", page.includes("/api"));
check("states no paid products", page.includes("None are built yet") || page.includes("No paid"));
check("demand gate stated", page.includes("demand is validated") || page.includes("demand"));
check("links to GitHub issue", page.includes("github.com"));

const footer = read("src/components/layout/Footer.tsx");
check("footer links to /data-products", footer.includes('href: "/data-products"'));

console.log(`\nsmoke:data-products-p16: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
