// ============================================================================
// P15 — SEO / information graph contract.
//
// Locks the properties that keep the machine surface honest and self-consistent:
//   * one base URL (@/util/seo), used by the sitemap, robots, layout and the
//     institution JSON-LD, so they cannot drift;
//   * the sitemap lists only stable, human-indexable routes — never `/search`
//     (query-dependent) and never a superseded institution slug (it redirects);
//   * every sitemap URL is absolute, trailing-slash, and unique;
//   * `lastModified` is the real directory vintage (`asOf`), never a build time;
//   * the Organization JSON-LD links the official site (sameAs) ONLY when the
//     website is verified — a candidate URL is a guess and must not be asserted;
//   * the routes actually wire the tested core.
//
// Run: npm run smoke:seo-p15
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { institutions, nrbDocuments, nrbRegulatoryEvents, directorySource } from "../src/lib/site-data";
import { SITE_BASE_URL, absoluteUrl, buildSitemapEntries, buildRobots, institutionJsonLd } from "../src/util/seo";

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

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const FREQ = ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"];

// --- Base URL ----------------------------------------------------------------
check("SITE_BASE_URL carries the basePath exactly once", SITE_BASE_URL.endsWith("/laghubitta-khabar") && !SITE_BASE_URL.endsWith("/"));
check("absoluteUrl(root) is the bare base + slash", absoluteUrl("/") === `${SITE_BASE_URL}/`);
check("absoluteUrl adds a single trailing slash", absoluteUrl("/institutions") === `${SITE_BASE_URL}/institutions/`);
check("absoluteUrl is idempotent on an already-slashed path", absoluteUrl("/institutions/") === `${SITE_BASE_URL}/institutions/`);

// --- Sitemap -----------------------------------------------------------------
const entries = buildSitemapEntries();
const urls = entries.map((e) => e.url);

check("sitemap is non-empty", entries.length > 0);
check("every sitemap URL is absolute under the base", urls.every((u) => u.startsWith(`${SITE_BASE_URL}/`)));
check("every sitemap URL ends with a slash", urls.every((u) => u.endsWith("/")));
check("sitemap is unique (no duplicate URLs)", new Set(urls).size === urls.length);
check("sitemap never lists the query-dependent /search", !urls.some((u) => u.includes("/search")));
check("sitemap home entry is first", entries[0].url === `${SITE_BASE_URL}/`);
check("every priority is within [0,1]", entries.every((e) => e.priority >= 0 && e.priority <= 1));
check("every changeFrequency is a schema value", entries.every((e) => FREQ.includes(e.changeFrequency)));
check(
  `lastModified is the directory vintage (${directorySource.asOf}), not a build time`,
  entries.every((e) => e.lastModified === directorySource.asOf),
);

const urlSet = new Set(urls);
const missingInst = institutions.filter((i) => !urlSet.has(absoluteUrl(`/institutions/${i.slug}`)));
check(`every institution has a profile URL (${institutions.length} institutions)`, missingInst.length === 0);
check(
  `every regulatory record has a news URL (${nrbRegulatoryEvents.length})`,
  nrbRegulatoryEvents.every((e) => urlSet.has(absoluteUrl(`/news/${e.id}`))),
);
check(
  `every NRB document has a news URL (${nrbDocuments.length})`,
  nrbDocuments.every((d) => urlSet.has(absoluteUrl(`/news/${d.id}`))),
);

// Deterministic: the same inputs produce byte-identical output.
check("buildSitemapEntries is deterministic", JSON.stringify(buildSitemapEntries()) === JSON.stringify(entries));

// People are supplied by the caller (the published projection), and are deduped.
const withPeople = buildSitemapEntries(["alfa", "beta", "alfa"]);
const peopleUrls = withPeople.map((e) => e.url).filter((u) => u.includes("/people/"));
check("caller-supplied people slugs are added", peopleUrls.includes(absoluteUrl("/people/alfa")));
check("duplicate people slugs are collapsed", peopleUrls.filter((u) => u.endsWith("/people/alfa/")).length === 1);
check("adding people does not drop the base sitemap", withPeople.length === entries.length + 2);

// --- Robots ------------------------------------------------------------------
const robots = buildRobots();
check("robots allows the configured user-agent", robots.rules.userAgent === "*" && robots.rules.allow === "/");
check("robots points at the sitemap (no route trailing slash)", robots.sitemap === `${SITE_BASE_URL}/sitemap.xml`);

// --- Organization JSON-LD ----------------------------------------------------
const baseLd = institutionJsonLd({ name: "Example MFI", slug: "example-mfi" });
check("JSON-LD is a schema.org Organization", baseLd["@context"] === "https://schema.org" && baseLd["@type"] === "Organization");
check("JSON-LD carries the name and canonical profile URL", baseLd.name === "Example MFI" && baseLd.url === absoluteUrl("/institutions/example-mfi"));
check("JSON-LD carries the slug as identifier", baseLd.identifier === "example-mfi");

const unverified = institutionJsonLd({ name: "X", slug: "x", websiteUrl: "https://guess.example", websiteVerified: false });
check("a candidate website is NOT asserted (no sameAs)", !("sameAs" in unverified));
const verified = institutionJsonLd({ name: "X", slug: "x", websiteUrl: "https://x.example", websiteVerified: true });
check("a verified website is linked via sameAs", verified.sameAs === "https://x.example");

const withOffice = institutionJsonLd({ name: "X", slug: "x", headOffice: "Naxal, Kathmandu" });
check("a held head office is included as address", withOffice.address === "Naxal, Kathmandu");
check("an absent head office adds no address", !("address" in baseLd));
check(
  "JSON-LD asserts only the allowed keys",
  Object.keys(verified).every((k) => ["@context", "@type", "name", "url", "identifier", "sameAs", "address"].includes(k)),
);

// --- Routes wire the tested core ---------------------------------------------
const sitemapTs = read("src/app/sitemap.ts");
const robotsTs = read("src/app/robots.ts");
check("app/sitemap.ts uses buildSitemapEntries", sitemapTs.includes("buildSitemapEntries"));
check("app/sitemap.ts feeds people from the published projection", sitemapTs.includes("allPublishedPeople"));
check("app/robots.ts uses buildRobots", robotsTs.includes("buildRobots"));

const layoutTs = read("src/app/layout.tsx");
check("layout.tsx imports SITE_BASE_URL", layoutTs.includes("SITE_BASE_URL"));
check("layout.tsx no longer hardcodes the base URL", !layoutTs.includes("https://laghubitta.sennaplatform.com"));

const profile = read("src/app/institutions/[slug]/page.tsx");
check("institution page imports institutionJsonLd", profile.includes("institutionJsonLd"));
check("institution page emits application/ld+json", profile.includes('type="application/ld+json"') && profile.includes("JSON.stringify(jsonLd)"));

console.log(`\nsmoke:seo-p15: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
