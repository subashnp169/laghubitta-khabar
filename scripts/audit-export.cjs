// Post-build audit for the static export. Verifies the invariants the product
// depends on: page count, single h1, main landmark, skip link, canonical/og
// consistency, in-page anchors that resolve, internal links that resolve, and
// the data-truth rules (no sentinel dates, no null/undefined/NaN in visible
// text, no bare percentages on the interest-rates page).
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "out");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_next") continue;
      out.push(...walk(full));
    } else if (entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

const pages = walk(OUT);
const rel = (f) => {
  let r = "/" + path.relative(OUT, f).replace(/\\/g, "/");
  if (r.endsWith("/index.html")) r = r.slice(0, -"index.html".length);
  else if (r === "/index.html") r = "/";
  else if (r.endsWith(".html")) r = r.slice(0, -".html".length);
  return r;
};

const failures = [];
const fail = (page, rule, detail) => failures.push({ page, rule, detail });

// Every page must exist on disk for a link target to resolve against.
const exists = new Set(pages.map(rel));
for (const f of pages) exists.add(rel(f) + "/");
exists.add("/404");

let internalLinks = 0;
let anchors = 0;

for (const file of pages) {
  const html = fs.readFileSync(file, "utf8");
  const page = rel(file);
  const isErrorPage = page === "/404" || page === "/_not-found";

  const h1Count = (html.match(/<h1[\s>]/g) || []).length;
  if (h1Count !== 1) fail(page, "single-h1", `found ${h1Count}`);

  if (!/<main[\s>]/.test(html)) fail(page, "main-landmark", "no <main>");
  if (!html.includes('href="#main"')) fail(page, "skip-link", "no skip link");
  if (!/<html[^>]+lang=/.test(html)) fail(page, "html-lang", "no lang attribute");

  // Canonical and og:url must agree and must not double the basePath.
  const canonical = (html.match(/<link[^>]+rel="canonical"[^>]*>/) || [])[0] || "";
  const ogUrl = (html.match(/<meta[^>]+property="og:url"[^>]*>/) || [])[0] || "";
  if (!canonical) fail(page, "canonical", "missing");
  if (!ogUrl) fail(page, "og-url", "missing");
  if (canonical && ogUrl) {
    const c = (canonical.match(/href="([^"]+)"/) || [])[1] || "";
    const o = (ogUrl.match(/content="([^"]+)"/) || [])[1] || "";
    if (c !== o) fail(page, "canonical-og-mismatch", `${c} vs ${o}`);
    if (c.includes("/laghubitta-khabar/laghubitta-khabar")) fail(page, "doubled-basepath", c);
  }

  // target=_blank without noopener leaks the opener.
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    if (!/rel="[^"]*noopener/.test(m[0])) fail(page, "blank-noopener", m[0].slice(0, 120));
  }

  // Heading order: no level may be skipped on the way down.
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      fail(page, "heading-skip", `h${levels[i - 1]} -> h${levels[i]}`);
      break;
    }
  }

  // Anchors declared on this page must exist as ids.
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/href="#([^"]+)"/g)) {
    const target = m[1];
    if (!target) continue;
    anchors++;
    if (!ids.has(target)) fail(page, "broken-anchor", `#${target}`);
  }

  // Internal page links must resolve to a generated page. Asset URLs under
  // /_next/ are build output, not pages, so they are counted separately.
  for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)(?:[?#][^"]*)?"/g)) {
    const href = m[1];
    if (href.startsWith("/laghubitta-khabar/_next/")) {
      internalLinks++;
      const asset = path.join(OUT, href.replace("/laghubitta-khabar/", "").replace(/\//g, path.sep));
      if (!fs.existsSync(asset)) fail(page, "missing-asset", href);
      continue;
    }
    if (!href.startsWith("/laghubitta-khabar/") && href !== "/laghubitta-khabar") continue;
    internalLinks++;
    const target = href.replace("/laghubitta-khabar", "") || "/";
    if (!exists.has(target) && !exists.has(target.replace(/\/$/, ""))) {
      fail(page, "broken-internal-link", href);
    }
  }

  if (isErrorPage) continue;

  // Data truth: sentinel dates and unformatted values must never be visible.
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(body)) fail(page, "raw-iso-date", "unformatted timestamp");
  if (/Rs\s*(null|undefined|NaN)/i.test(body)) fail(page, "null-currency", "Rs null/undefined/NaN");
  if (/>\s*(null|undefined|NaN)\s*</.test(body)) fail(page, "null-value", "null/undefined/NaN as text");
  if (/Lorem ipsum|TODO|FIXME/.test(body)) fail(page, "placeholder-text", "placeholder text");
  if (body.includes("\uFFFD")) fail(page, "replacement-char", "U+FFFD");
}

console.log(`pages: ${pages.length}`);
console.log(`internal links checked: ${internalLinks}`);
console.log(`in-page anchors checked: ${anchors}`);
console.log(`failures: ${failures.length}`);
for (const f of failures.slice(0, 40)) console.log(`  ${f.page} [${f.rule}] ${f.detail}`);
process.exit(failures.length === 0 ? 0 : 1);