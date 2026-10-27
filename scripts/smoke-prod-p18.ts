// ============================================================================
// P18 — Production hardening contract (deploy surface).
//
// Production runs a static export on Cloudflare Pages (headers) with a GitHub
// Pages staging mirror. That surface is easy to break silently — a header dropped
// from `_headers`, a global robots rule re-added, a `middleware.ts` that never
// executes under `output: export`. This locks the invariants that keep a build
// safe to ship:
//   * `public/_headers` carries the full security-header set (and a CSP with
//     `default-src 'self'` + `frame-ancestors 'none'`);
//   * NO global `robots` in the root layout — it collided with the 404's noindex;
//   * a real, on-brand `not-found.tsx`, and `/search` still the only noindex page;
//   * the deploy contract in `next.config.ts` (export + basePath + trailingSlash);
//   * the CI workflow builds; no dead `middleware.ts`;
//   * the generated `sitemap.xml` / `robots.txt` routes exist;
//   * when a build output is present, the built 404 carries exactly one robots
//     meta and it is `noindex`.
//
// Run: npm run smoke:prod-p18
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log("  ok  ", name);
  } else {
    fail += 1;
    console.log("  FAIL", name);
  }
}
function note(message: string): void {
  console.log("  --  ", message);
}

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const exists = (rel: string) => existsSync(join(root, rel));

// --- Security headers (_headers) ---------------------------------------------
const headers = read("public/_headers");
const REQUIRED_HEADERS = [
  "Content-Security-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
  "Cross-Origin-Resource-Policy",
];
for (const h of REQUIRED_HEADERS) {
  check(`_headers sets ${h}`, headers.includes(`${h}:`));
}
check("the CSP is self-first (default-src 'self')", /default-src 'self'/.test(headers));
check("the CSP forbids framing (frame-ancestors 'none')", /frame-ancestors 'none'/.test(headers));
check("the CSP forbids plugins (object-src 'none')", /object-src 'none'/.test(headers));
check("HSTS is long-lived with preload", /Strict-Transport-Security:.*max-age=31536000/.test(headers) && headers.includes("preload"));

// --- No global robots rule in the layout -------------------------------------
const layout = read("src/app/layout.tsx");
check("root layout declares NO global robots rule (avoids the 404 meta clash)", !/robots:\s*\{/.test(layout));
check("layout documents why the robots rule was removed", layout.includes("conflicting"));
check("/search keeps its own noindex", read("src/app/search/page.tsx").includes("robots: { index: false"));

// --- Custom 404 --------------------------------------------------------------
check("a custom not-found page exists", exists("src/app/not-found.tsx"));
const notFound = exists("src/app/not-found.tsx") ? read("src/app/not-found.tsx") : "";
check("the 404 renders a single h1", (notFound.match(/<h1/g) ?? []).length === 1);
check("the 404 offers a way back (Links)", notFound.includes("<Link") && notFound.includes('href: "/"'));
check("the 404 does not try to export metadata (not allowed here)", !notFound.includes("export const metadata"));

// --- Deploy contract (next.config.ts) ----------------------------------------
const nextConfig = read("next.config.ts");
check("next.config.ts exports statically", nextConfig.includes('output: "export"'));
check("next.config.ts pins basePath", nextConfig.includes('basePath: "/laghubitta-khabar"'));
check("next.config.ts uses trailing slashes", nextConfig.includes("trailingSlash: true"));
check("next.config.ts disables image optimization (static host)", nextConfig.includes("unoptimized: true"));

// --- CI + no dead middleware -------------------------------------------------
check("CI workflow exists and builds", exists(".github/workflows/deploy.yml") && read(".github/workflows/deploy.yml").includes("npm run build"));
check("no dead src/middleware.ts (never runs under export)", !exists("src/middleware.ts"));

// --- Generated crawl routes --------------------------------------------------
check("app/robots.ts exists", exists("src/app/robots.ts"));
check("app/sitemap.ts exists", exists("src/app/sitemap.ts"));

// --- Built output (only when present; the export dir is gitignored) ----------
if (exists("out/404.html")) {
  const html = read("out/404.html");
  const robotsMetas = html.match(/<meta name="robots"/g) ?? [];
  check("built 404 carries exactly one robots meta", robotsMetas.length === 1);
  check("built 404's robots meta is noindex", /<meta name="robots" content="noindex"/.test(html));
  check("built 404 no longer claims index, follow", !html.includes("index, follow"));
  check("built 404 keeps on-brand markup (h1 present)", html.includes("Page not found"));
  check("_headers is copied to the export root", exists("out/_headers"));
  check("robots.txt is emitted", exists("out/robots.txt"));
  check("sitemap.xml is emitted", exists("out/sitemap.xml"));
} else {
  note("out/ not present; skipped the built-output checks (source checks above still apply)");
}

console.log(`\nsmoke:prod-p18: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
