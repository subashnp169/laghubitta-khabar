// ============================================================================
// Quality pass — performance budget (built output).
//
// Locks a coarse performance budget so a regression (a giant chunk, a page
// count collapse, a missing sitemap) is caught. Runs only when `out/` is
// present; otherwise skips with a note.
//
// Run: npm run smoke:perf
// ============================================================================
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}

const root = join(__dirname, "..");
const exists = (rel: string) => existsSync(join(root, rel));

if (!exists("out")) {
  console.log("  --  out/ not present; skipped (run `npm run build` first)");
  console.log(`\nsmoke:perf: ${pass} passed, ${fail} failed`);
  process.exit(0);
}

// --- Page count budget -------------------------------------------------------
function countHtml(dir: string): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) n += countHtml(p);
    else if (name.endsWith(".html")) n += 1;
  }
  return n;
}
const pages = countHtml(join(root, "out"));
check("at least 390 HTML pages shipped", pages >= 390);
check("fewer than 500 HTML pages (sanity)", pages < 500);

// --- Bundle budget -----------------------------------------------------------
function largestChunk(dir: string): { path: string; size: number } {
  let best = { path: "", size: 0 };
  function walk(d: string) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".js")) {
        if (st.size > best.size) best = { path: p.replace(root + "\\", ""), size: st.size };
      }
    }
  }
  walk(dir);
  return best;
}
const largest = largestChunk(join(root, "out", "_next", "static"));
check("largest JS chunk is under 300 KB", largest.size < 300 * 1024);
console.log(`  --  largest JS chunk: ${largest.path} (${(largest.size / 1024).toFixed(1)} KB)`);

// --- Sitemap / robots present -----------------------------------------------
check("sitemap.xml shipped", exists("out/sitemap.xml"));
check("robots.txt shipped", exists("out/robots.txt"));
check("_headers shipped", exists("out/_headers"));

const sitemap = readFileSync(join(root, "out/sitemap.xml"), "utf8");
const urlCount = (sitemap.match(/<loc>/g) ?? []).length;
check("sitemap lists at least 370 URLs", urlCount >= 370);
console.log(`  --  sitemap URLs: ${urlCount}`);

console.log(`\nsmoke:perf: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
