// ============================================================================
// Quality pass — accessibility contract (source + built output).
//
// Locks the invariants that keep the site usable with a keyboard / screen
// reader. Source-level checks always run; built-output checks run only when
// `out/` is present (it is gitignored, so CI without a build skips them).
//
// Run: npm run smoke:a11y
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
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const exists = (rel: string) => existsSync(join(root, rel));

// --- Source invariants --------------------------------------------------------
const layout = read("src/app/layout.tsx");
check("root layout sets lang=\"en\"", /<html lang="en">/.test(layout));
check("header provides a skip link to #main", read("src/components/layout/Header.tsx").includes('href="#main"') && read("src/components/layout/Header.tsx").includes("sr-only"));
check("root layout renders a <main id=\"main\"> landmark", layout.includes('<main id="main"'));
check("root layout renders a <footer>", layout.includes("<Footer />"));
check("header nav has an aria-label", read("src/components/layout/Header.tsx").includes('aria-label="Primary"') || read("src/components/layout/Header.tsx").includes('aria-label="primary"'));

const css = read("src/app/globals.css");
check("globals.css keeps a visible focus style", /focus-visible|:focus/.test(css));

const notFound = exists("src/app/not-found.tsx") ? read("src/app/not-found.tsx") : "";
check("404 page renders a single h1", (notFound.match(/<h1/g) ?? []).length === 1);

// --- Built output (only when present) ----------------------------------------
if (exists("out")) {
  const samplePages = [
    "out/index.html",
    "out/institutions/index.html",
    "out/institutions/nirdhan-utthan-laghubitta-bittiya-sanstha-ltd/index.html",
  ];
  for (const p of samplePages) {
    if (!exists(p)) continue;
    const html = read(p);
    check(`${p}: skip link present`, html.includes('href="#main"') || html.includes("Skip to content") || html.includes("sr-only"));
    check(`${p}: main landmark present`, html.includes('<main') || html.includes("id=\"main\""));
    check(`${p}: single h1`, (html.match(/<h1[\s>]/g) ?? []).length === 1);
    check(`${p}: lang attribute present`, /<html[^>]*lang="en"/.test(html));
  }

  // robots meta sanity: no page should carry BOTH noindex and index,follow.
  const idx = read("out/index.html");
  // Home carries no robots meta at all now (the global rule was removed to avoid
  // clashing with the 404's noindex); absence of noindex means indexable by default.
  check("home is indexable (no noindex meta)", !/content="noindex"/.test(idx));
  const nf = read("out/404.html");
  check("404 is noindex", /content="noindex"/.test(nf));
} else {
  console.log("  --  out/ not present; skipped built-output checks");
}

console.log(`\nsmoke:a11y: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
