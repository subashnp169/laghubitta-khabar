// ============================================================================
// M3.3-GENERIC-EXT-B - People URL SEED LAYER (research phase, "seed first").
//
//   51 MFB master registry
//     -> People URL seed manifest (this script's output)
//       -> controlled fetch
//         -> existing generic People extractor
//           -> evidence -> UNVERIFIED assertion -> review/conflict
//
// Generic discovery (scripts/smoke-people-discovery.ts + the LINK_PEOPLE pass
// in lib/ingestion/discovery.ts) is the FALLBACK for institutions where seeding
// finds nothing - it is not the primary mechanism any more.
//
// Hard rules honoured here:
//   * No institution-specific parsing, selectors, or URLs in the OUTPUT. The
//     only per-institution input is the master registry row (homepage) plus
//     research leads, which are treated as untrusted hypotheses to verify.
//   * A URL alone is NOT enough: a candidate becomes a seed only when the
//     EXISTING generic extractor returns >=1 person evidence from the fetched
//     page. Verification is done by extraction, never by pattern-matching the URL.
//   * Same official domain + HTTPS + the existing ControlledFetcher policy
//     (unchanged knobs) gate every fetch.
//   * Seed URLs are discovery provenance, NOT verified People data. Nothing
//     here writes assertions; that stays in the pilot/engine.
//   * Branch / career / contact pages are recorded as FUTURE CANDIDATES only
//     (M3.3 does not extract branch personnel - that is later Branch work).
//   * The research budget below is separate from, and does not modify,
//     data/pilot/pilot-budget.json.
//
// Run:
//   npx tsx scripts/seed-people-urls.ts                  # all 51, cached
//   npx tsx scripts/seed-people-urls.ts --only nirdhan-website
//   npx tsx scripts/seed-people-urls.ts --refresh       # ignore verdict cache
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  ControlledFetcher,
  nodeResolveHost,
  peopleExtractor,
  extractPeopleCandidates,
  normalizeDiscoveredUrl,
  PEOPLE_PARSER_ID,
} from "../lib/ingestion";
import { stripNavigation } from "../lib/ingestion/people";
import type { ExtractedEvidence } from "../lib/ingestion";

/** Human-readable text of any thrown value (fetch errors are plain objects). */
const msg = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e));

/**
 * Leadership-role vocabulary (M3.3-GENERIC-EXT-B §4 + §8). Generic English role
 * terms - no institution, no Nepali, no per-site terms.
 */
const LEADERSHIP_ROLES: readonly string[] = [
  "board of directors",
  "independent director",
  "board member",
  "chairperson",
  "chairman",
  "chair person",
  "director",
  "chief executive officer",
  "deputy chief executive",
  "deputy ceo",
  "managing director",
  "executive director",
  "general manager",
  "management team",
  "leadership team",
  "leadership",
  "chief executive",
  "ceo",
  "company secretary",
  "compliance officer",
  "information officer",
];

/**
 * Page-level roster proof.
 *
 * A person-listing page is recognised structurally, NOT by "does this heading look
 * like a name": neither a name regex nor the extractor's own `nameLike` can judge
 * a heading in isolation (both accept "Contact Us" / "Quick Links" /
 * "Information Officer", because inside a people block a name-shaped string is
 * already known to be a person). So the signal used here is the semantics of the
 * markup: a short heading immediately followed by a leadership role marker, and
 * at least two such DISTINCT headings - the universal <h3>Name</h3><p>Role</p>
 * roster card. Site chrome headings are never followed by a role marker, so
 * chairman messages, news items, careers pages and governance reports fail here.
 */
function detectRosterStructure(html: string): { roster: boolean; pairs: Array<{ name: string; role: string }> } {
  const body = stripNavigation(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const pairs: Array<{ name: string; role: string }> = [];
  for (const m of body.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    const name = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) continue;
    // A person's name is not a phrase that contains their own title: headings
    // like "Message From Chairman" or "Board of Directors" are page furniture,
    // not roster entries, and must not count towards the people-listing proof.
    const lowerName = name.toLowerCase();
    if (LEADERSHIP_ROLES.some((r) => lowerName.includes(r))) continue;
    const start = (m.index ?? 0) + m[0].length;
    const window = body.slice(start, start + 400).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const role = LEADERSHIP_ROLES.find((r) => window.includes(r));
    if (role) pairs.push({ name, role });
  }
  const distinct = new Set(pairs.map((p) => p.name.toLowerCase()));
  return { roster: distinct.size >= 2, pairs: pairs.slice(0, 12) };
}

/**
 * §4 classification gate, in two parts:
 *   1. leadership context  - role vocabulary (§4/§8) present outside nav/footer;
 *   2. people-listing proof - the page actually LISTS people, either because the
 *      generic extractor found someone, or because the markup is a roster (§ above).
 *
 * A URL alone is never enough, and a role word in prose is never enough.
 */
function detectLeadershipContext(
  html: string,
  peopleFromExtractor: number,
): {
  hasContext: boolean;
  roleSignals: string[];
  leadershipHeadings: string[];
  rosterPairs: Array<{ name: string; role: string }>;
} {
  const body = stripNavigation(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const lower = body.toLowerCase();
  const hasRole = (t: string) => LEADERSHIP_ROLES.some((r) => t.includes(r));

  const roleSignals = LEADERSHIP_ROLES.filter((r) => lower.includes(r));
  const leadershipHeadings = (body.match(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi) ?? [])
    .map((h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0 && hasRole(t.toLowerCase()));
  const { roster, pairs } = detectRosterStructure(html);

  return {
    hasContext: roleSignals.length >= 1 && (peopleFromExtractor >= 1 || roster),
    roleSignals,
    leadershipHeadings: leadershipHeadings.slice(0, 8),
    rosterPairs: pairs,
  };
}

type SeedKind =
  | "BOARD"
  | "MANAGEMENT"
  | "EXECUTIVE"
  | "LEADERSHIP"
  | "CORPORATE_TEAM"
  | "ORGANIZATIONAL_CHART"
  | "CAREER_CONTACT"
  | "BRANCH_MANAGEMENT";

/** Future-only kinds: recorded, never turned into People evidence in M3.3. */
const FUTURE_ONLY: ReadonlySet<SeedKind> = new Set<SeedKind>(["CAREER_CONTACT", "BRANCH_MANAGEMENT"]);

interface SeedEntry {
  url: string;
  kind: SeedKind;
  confidence: number;
  source: string;
  discovery_method: string;
  observed_at: string;
  priority: 1 | 2 | 3 | 4;
  http_status: number;
  content_type: string;
  /** §4 leadership-role evidence found on the page (why it counts as PEOPLE). */
  leadership_role_signals: string[];
  /** What the existing generic extractor could pull from it today (may be 0). */
  people_found: number;
  roles: string[];
  verified_by: string;
  note?: string;
}

interface FutureCandidate {
  url: string;
  reason: string;
  observed_at: string;
}

interface ManifestInstitution {
  institution_slug: string;
  institution_id: string;
  official_homepage: string;
  seeds: SeedEntry[];
  future_candidates: FutureCandidate[];
}

interface Verdict {
  httpStatus: number | null;
  contentType: string | null;
  /** sha-256 of the fetched body: identical hashes mean an identical document. */
  contentHash: string;
  people: number;
  roles: string[];
  names: string[];
  futureOnly: boolean;
  /** §4 leadership-context evidence, independent of extractor output. */
  hasContext: boolean;
  roleSignals: string[];
  leadershipHeadings: string[];
  rosterPairs: Array<{ name: string; role: string }>;
  error?: string;
  checkedAt: string;
  verdictVersion: number;
}

/** Bump when the verification logic changes so cached verdicts are discarded. */
const VERDICT_VERSION = 10;

// ---------------------------------------------------------------------------
// Research inputs (untrusted hypotheses supplied during research, NOT seeds).
// Each is verified by fetch+extract before it can enter the manifest. Leads on
// a different official domain than the registry row are reported, never seeded.
// ---------------------------------------------------------------------------
const RESEARCH_LEADS: Record<string, string[]> = {
  "nirdhan-website": ["https://www.nirdhan.com.np/about-us/board-of-directors/"],
  "chhimek-website": ["https://www.chhimekbank.org/all-members/board-of-directors"],
  "swbbl-website": ["https://www.swbbl.com.np/board-management/board-of-directors"],
  "nationalmicrofinance-website": ["https://nationalmicrofinance.com.np/management-team"],
  "jeevanbikasmf-website": ["https://www.mf.jeevanbikas.org.np/about/about-board"],
  "manushilbs-website": ["https://www.manushilbs.com/directors"],
  "matribhumi-website": ["https://www.matribhumimf.com.np/team/board"],
  "cyc-website": ["https://cycnlbsl.org.np/board-of-directors/"],
  "aviyan-website": ["https://www.aviyanlaghubitta.com.np/director"],
  "aarambha-website": ["https://aarambhachautari.com/news/newly-elected-board-of-directors"],
  "swastiklbs-website": ["https://swastiklbs.com.np/board-of-directors"],
  "nadeplaghubitta-website": ["https://nadeplaghubitta.com/board-of-directors"],
};

/**
 * Generic candidate vocabulary (M3.3-GENERIC-EXT-B §3), ordered by expected
 * yield. No institution appears here - these are the standard MFB path shapes.
 * /about* is probed LAST and only counts WITH leadership evidence in the page.
 */
const CANDIDATE_PATHS: ReadonlyArray<{ path: string; kind: SeedKind; weak: boolean }> = [
  { path: "/board-of-directors", kind: "BOARD", weak: false },
  { path: "/board", kind: "BOARD", weak: false },
  { path: "/board-management/board-of-directors", kind: "BOARD", weak: false },
  { path: "/board-management", kind: "BOARD", weak: false },
  { path: "/about-us/board-of-directors", kind: "BOARD", weak: false },
  { path: "/board-members", kind: "BOARD", weak: false },
  { path: "/directors", kind: "BOARD", weak: false },
  { path: "/our-board", kind: "BOARD", weak: false },
  { path: "/management-team", kind: "MANAGEMENT", weak: false },
  { path: "/management", kind: "MANAGEMENT", weak: false },
  { path: "/central-office-management", kind: "MANAGEMENT", weak: false },
  { path: "/executive-team", kind: "EXECUTIVE", weak: false },
  { path: "/management-staff", kind: "MANAGEMENT", weak: false },
  { path: "/leadership", kind: "LEADERSHIP", weak: false },
  { path: "/leadership-team", kind: "LEADERSHIP", weak: false },
  { path: "/governance", kind: "LEADERSHIP", weak: false },
  { path: "/our-team", kind: "CORPORATE_TEAM", weak: false },
  { path: "/corporate-team", kind: "CORPORATE_TEAM", weak: false },
  { path: "/team", kind: "CORPORATE_TEAM", weak: false },
  { path: "/organizational-chart", kind: "ORGANIZATIONAL_CHART", weak: false },
  { path: "/organization-chart", kind: "ORGANIZATIONAL_CHART", weak: false },
  { path: "/organogram", kind: "ORGANIZATIONAL_CHART", weak: false },
  { path: "/about-us", kind: "CORPORATE_TEAM", weak: true },
  { path: "/about", kind: "CORPORATE_TEAM", weak: true },
];

/** Research-phase budget. Deliberately tighter than the production crawl. */
const RESEARCH_BUDGET = {
  maxBytes: 4_000_000,
  maxRedirects: 4,
  maxRetries: 1,
  timeoutMs: 12_000,
  minIntervalMs: 400,
  maxFetchesPerInstitution: 12,
  maxLinkCandidates: 4,
  maxSeedsPerInstitution: 3,
  concurrency: 3,
};

/** Identifier for the existing official domain: host minus a www. prefix. */
function apexOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
}

/** Same rule the production fetcher policy uses: own host + own subdomains. */
function sameOfficialDomain(url: string, homepage: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  const apex = apexOf(homepage);
  return host === apex || host.endsWith(`.${apex}`);
}

function policyFor(url: string) {
  const host = new URL(url).hostname;
  const apex = apexOf(url);
  return {
    allowedHosts: [...new Set(apex === host ? [host] : [host, apex])],
    allowSubdomainsOf: [apex],
    maxBytes: RESEARCH_BUDGET.maxBytes,
    maxRedirects: RESEARCH_BUDGET.maxRedirects,
    maxRetries: RESEARCH_BUDGET.maxRetries,
    timeoutMs: RESEARCH_BUDGET.timeoutMs,
    minIntervalMs: RESEARCH_BUDGET.minIntervalMs,
    resolveHost: nodeResolveHost,
  };
}

/** Kind hint from the URL path only. Generic shape matching, no per-site logic. */
function kindFromPath(pathname: string): SeedKind | null {
  const p = pathname.toLowerCase();
  if (/\/branch/.test(p)) return "BRANCH_MANAGEMENT";
  if (/\/(career|jobs?|vacanc|contact)/.test(p)) return "CAREER_CONTACT";
  if (/(org(aniz|anis)(ational)?[-_/]?chart|organogram)/.test(p)) return "ORGANIZATIONAL_CHART";
  if (/\/board|\/director/.test(p)) return "BOARD";
  if (/\/(executive|ceo)/.test(p)) return "EXECUTIVE";
  if (/\/(management|staff)/.test(p)) return "MANAGEMENT";
  if (/leadership|governance/.test(p)) return "LEADERSHIP";
  if (/\/team|\/members?/.test(p)) return "CORPORATE_TEAM";
  return null;
}

/**
 * Priority 1 = exact Board, 2 = exact Management/Leadership, 3 = team/org page
 * with leadership evidence, 4 = left to generic discovery.
 */
function priorityFor(kind: SeedKind): 1 | 2 | 3 | 4 {
  if (kind === "BOARD") return 1;
  if (kind === "MANAGEMENT" || kind === "EXECUTIVE" || kind === "LEADERSHIP") return 2;
  if (kind === "ORGANIZATIONAL_CHART" || kind === "CORPORATE_TEAM") return 3;
  return 4;
}

/**
 * Confidence is deterministic and never "feels right".
 *   leadership context + name-like structure  -> 1.0 / 0.9
 *   leadership context only                    -> 0.8
 *   extractor corroborates the page            -> never lowers, may reach 1.0
 *   news-shaped or /about* URL                 -> capped (less durable evidence)
 *   no leadership context                      -> 0 (never a seed)
 */
function confidenceFor(v: Verdict, pathKind: SeedKind | null, pathname: string): number {
  if (!v.hasContext) return 0;
  let c = v.rosterPairs.length >= 2 ? 1.0 : v.leadershipHeadings.length >= 1 ? 0.9 : 0.8;
  if (v.people >= 2) c = 1.0;
  else if (v.people === 1) c = Math.max(c, 0.9);
  if (!pathKind) c -= 0.1;
  if (/\/(news|notice|blog|press)\b/.test(pathname.toLowerCase())) c = Math.min(c, 0.6);
  return Math.round(c * 100) / 100;
}

/** Run the EXISTING generic extractor: the only accepted proof of a People page. */
async function verifyWithExtractor(
  body: Uint8Array,
  contentHash: string,
  url: string,
  sourceId: string,
  institutionId: string,
): Promise<{ people: number; roles: string[]; names: string[] }> {
  const out: ExtractedEvidence[] = await peopleExtractor.extract({
    sourceId,
    institutionId,
    sourceType: "MFB_WEBSITE",
    capability: "PEOPLE",
    url,
    parserId: PEOPLE_PARSER_ID,
    contentHash,
    body,
  });
  // Field names are emitted uppercase (PEOPLE_CHAIR / PEOPLE_DIRECTOR / ...);
  // the project's own audits match them with a case-insensitive LIKE, so this
  // filter must be case-insensitive too.
  const peopleFields = out.filter((e) => typeof e.field === "string" && /^people/i.test(e.field));
  // Low-confidence evidence must not become an assertion, so it must not make a
  // page a People page either.
  const usable = peopleFields.filter((e) => (e.confidence ?? 0) >= 0.5);
  return {
    people: usable.length,
    roles: [...new Set(usable.map((e) => e.field as string))].sort(),
    names: usable.map((e) => e.text ?? "").filter(Boolean).slice(0, 25),
  };
}

const argv = process.argv.slice(2);
const has = (n: string) => argv.includes(`--${n}`);
const only = (() => {
  const i = argv.indexOf("--only");
  return i >= 0 ? argv[i + 1] : undefined;
})();

const PILOT_JSON = join(process.cwd(), "data", "pilot", "pilot-sources.json");
const MANIFEST_JSON = join(process.cwd(), "data", "pilot", "people-url-seeds.json");
const CACHE_JSON = join(process.cwd(), "data", "pilot", "people-url-seed-cache.json");

interface PilotRecord {
  id: string;
  institution_id: string;
  url: string;
  domain: string;
  capabilities: Array<{ capability: string; known_url: string | null }>;
}

interface CacheShape {
  verdictVersion: number;
  homepages: Record<string, { status: number | null; candidates: string[]; people: number; checkedAt: string }>;
  urls: Record<string, Verdict>;
}

function loadCache(): CacheShape {
  if (has("refresh") || !existsSync(CACHE_JSON)) return { verdictVersion: VERDICT_VERSION, homepages: {}, urls: {} };
  try {
    const c = JSON.parse(readFileSync(CACHE_JSON, "utf8")) as CacheShape;
    if (c.verdictVersion !== VERDICT_VERSION) return { verdictVersion: VERDICT_VERSION, homepages: {}, urls: {} };
    return c;
  } catch {
    return { verdictVersion: VERDICT_VERSION, homepages: {}, urls: {} };
  }
}

async function main(): Promise<void> {
  const pilot = JSON.parse(readFileSync(PILOT_JSON, "utf8")) as { sources: PilotRecord[] };
  const cache = loadCache();
  const sources = pilot.sources.filter((s) => !only || s.id === only);
  console.log(`seeding universe: ${sources.length} of ${pilot.sources.length} Class-D MFB sources`);
  console.log(
    `research budget (separate from pilot-budget.json): ${RESEARCH_BUDGET.maxFetchesPerInstitution} fetches/institution, ` +
      `${RESEARCH_BUDGET.maxBytes} bytes, ${RESEARCH_BUDGET.timeoutMs}ms, concurrency ${RESEARCH_BUDGET.concurrency}`,
  );

  const manifest: ManifestInstitution[] = [];
  const rejectedLeads: Array<{ slug: string; url: string; verdict: string }> = [];
  const notes: Array<{ slug: string; url: string; note: string }> = [];
  let totalFetches = 0;

  const pool = [...sources];
  const worker = async (): Promise<void> => {
    while (pool.length > 0) {
      const s = pool.shift();
      if (!s) return;
      const fetcher = new ControlledFetcher(policyFor(s.url));
      const entry: ManifestInstitution = {
        institution_slug: s.id,
        institution_id: s.institution_id,
        official_homepage: s.url,
        seeds: [],
        future_candidates: [],
      };
      const seen = new Set<string>();
      /** Names already covered by an accepted seed - used to drop duplicate rosters. */
      const keptNames = new Set<string>();
      /** Content hashes of accepted seeds - identical documents are redundant. */
      const keptHashes = new Set<string>();
      const tried: Array<{ url: string; verdict: Verdict }> = [];
      let fetches = 0;

      const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

      /** Verify one candidate URL (cached), enforcing the official-domain rule. */
      const check = async (rawUrl: string, discoveryMethod: string, source: string): Promise<Verdict | null> => {
        let url: string;
        try {
          const u = new URL(rawUrl);
          if (u.protocol !== "https:") {
            rejectedLeads.push({ slug: s.id, url: rawUrl, verdict: "REJECTED_NOT_HTTPS" });
            return null;
          }
          url = normalizeDiscoveredUrl(u.href);
        } catch {
          rejectedLeads.push({ slug: s.id, url: rawUrl, verdict: "REJECTED_BAD_URL" });
          return null;
        }
        if (!sameOfficialDomain(url, s.url)) {
          rejectedLeads.push({
            slug: s.id,
            url,
            verdict: `REJECTED_DIFFERENT_HOST (registry: ${apexOf(s.url)}, lead: ${new URL(url).hostname})`,
          });
          return null;
        }
        if (seen.has(url)) return null;
        seen.add(url);
        if (fetches >= RESEARCH_BUDGET.maxFetchesPerInstitution) return null;

        const cached = cache.urls[url];
        if (cached && !has("refresh")) {
          totalFetches += 0;
          return cached;
        }

        fetches += 1;
        totalFetches += 1;
        let verdict: Verdict;
        try {
          const f = await fetcher.fetch(url);
          const pathname = new URL(f.finalUrl).pathname;
          const ct = (f.contentType ?? "").toLowerCase();
          if (f.error || (f.httpStatus ?? 0) >= 400 || f.httpStatus === null) {
            verdict = {
              httpStatus: f.httpStatus,
              contentType: f.contentType,
              contentHash: f.contentHash ?? "",
              people: 0,
              roles: [],
              names: [],
              futureOnly: false,
              hasContext: false,
              roleSignals: [],
              leadershipHeadings: [],
              rosterPairs: [],
              error: f.error?.type ?? `HTTP_${f.httpStatus}`,
              checkedAt: new Date().toISOString(),
              verdictVersion: VERDICT_VERSION,
            };
          } else if (ct.includes("pdf") || !ct.includes("html")) {
            // A PDF is a real fetch but not an HTML People page. Recorded, and it
            // never becomes a People seed silently.
            verdict = {
              httpStatus: f.httpStatus,
              contentType: f.contentType,
              contentHash: f.contentHash ?? "",
              people: 0,
              roles: [],
              names: [],
              futureOnly: false,
              hasContext: false,
              roleSignals: [],
              leadershipHeadings: [],
              rosterPairs: [],
              error: `NOT_HTML (${ct || "unknown"})`,
              checkedAt: new Date().toISOString(),
              verdictVersion: VERDICT_VERSION,
            };
            if (pathname.toLowerCase().endsWith(".pdf")) {
              notes.push({ slug: s.id, url, note: `PDF document (${ct}); not an HTML People page, not seeded` });
            }
          } else {
            const html = new TextDecoder().decode(f.body);
            const v = await verifyWithExtractor(f.body, f.contentHash || createHash("sha256").update(f.body).digest("hex"), f.finalUrl, s.id, s.institution_id);
            const ctx = detectLeadershipContext(html, v.people);
            const pathKind = kindFromPath(pathname);
            verdict = {
              httpStatus: f.httpStatus,
              contentType: f.contentType,
              contentHash: f.contentHash ?? "",
              people: v.people,
              roles: v.roles,
              names: v.names,
              futureOnly: pathKind !== null && FUTURE_ONLY.has(pathKind),
              hasContext: ctx.hasContext,
              roleSignals: ctx.roleSignals,
              leadershipHeadings: ctx.leadershipHeadings,
              rosterPairs: ctx.rosterPairs,
              checkedAt: new Date().toISOString(),
              verdictVersion: VERDICT_VERSION,
            };
          }
        } catch (e) {
          verdict = {
            httpStatus: null,
            contentType: null,
            contentHash: "",
            people: 0,
            roles: [],
            names: [],
            futureOnly: false,
            hasContext: false,
            roleSignals: [],
            leadershipHeadings: [],
            rosterPairs: [],
            error: msg(e),
            checkedAt: new Date().toISOString(),
            verdictVersion: VERDICT_VERSION,
          };
        }
        cache.urls[url] = verdict;
        // A 200 with neither leadership context nor extractable people is the
        // classic soft-404 / SPA-catch-all case - the reason a URL alone is never
        // accepted as a People page. Counted per institution for §10 metrics.
        if (verdict.httpStatus === 200 && !verdict.error && verdict.people < 1 && !verdict.hasContext) {
          notes.push({
            slug: s.id,
            url,
            note: `http 200 but no leadership context and no extractable people (soft-404, SPA catch-all, or a non-People page)`,
          });
        }
        return verdict;
      };

      const addSeed = (url: string, kindHint: SeedKind, verdict: Verdict, method: string, source: string, weak: boolean) => {
        // §4 gate: leadership context in the fetched page, never the URL alone.
        if (!verdict.hasContext) return;
        if (FUTURE_ONLY.has(kindHint)) return;
        const pathname = new URL(url).pathname;
        // A news/notice/press item is a transient announcement, not a standing
        // People page. It may well contain a real elected-board list, but it is
        // not a durable seed and it over-reads badly (a chairman's appointment
        // news page yields every name in its sidebar). Recorded as a future
        // candidate instead of being seeded.
        if (/\/(news|notice|blog|press|jucnews)\b/.test(pathname.toLowerCase())) {
          addFuture(url, "news/announcement item, not a durable People page");
          return;
        }
        const kind = kindFromPath(pathname) ?? kindHint;
        const conf = confidenceFor(verdict, kindFromPath(pathname), pathname);
        if (conf <= 0) return;
        if (entry.seeds.some((x) => x.url === url)) return;

        // Same page on the apex and its www host is one page, not two.
        if (entry.seeds.some((x) => new URL(x.url).pathname === pathname)) {
          notes.push({ slug: s.id, url, note: "same path already seeded on another host variant; skipped to save crawl budget" });
          return;
        }

        // Identical-document guard: /board, /board-of-directors and
        // /board-management/board-of-directors frequently serve the very same
        // bytes, and catch-all SPAs return one document for every path. Seeding
        // those repeatedly burns crawl budget for no new evidence.
        if (verdict.contentHash && keptHashes.has(verdict.contentHash)) {
          notes.push({ slug: s.id, url, note: "identical document to an already-seeded URL (same content hash); skipped" });
          return;
        }

        // Duplicate-roster guard: distinct documents that publish the same people
        // (e.g. a mirrored board page) are equally redundant.
        const names = verdict.names.map(nameKey).filter((n) => n.length > 1);
        if (names.length > 0 && names.every((n) => keptNames.has(n))) {
          notes.push({ slug: s.id, url, note: "same roster as an already-seeded URL; skipped to save crawl budget" });
          return;
        }

        const base: SeedEntry = {
          url,
          kind,
          confidence: weak ? Math.min(conf, 0.7) : conf,
          source,
          discovery_method: method,
          observed_at: verdict.checkedAt,
          priority: priorityFor(kind),
          http_status: verdict.httpStatus ?? 0,
          content_type: verdict.contentType ?? "",
          leadership_role_signals: verdict.roleSignals.slice(0, 6),
          people_found: verdict.people,
          roles: verdict.roles,
          verified_by: "CONTROLLED_FETCH+LEADERSHIP_CONTEXT",
        };
        const notesForSeed: string[] = [];
        if (weak) notesForSeed.push("/about* page accepted only because the page itself carried leadership context");
        if (/\/(news|notice|blog|press)\b/.test(pathname.toLowerCase())) {
          notesForSeed.push("news-shaped URL, not a durable People page");
        }
        if (verdict.people < 1) {
          // §10 counts "People pages found" and "people extracted" separately, so
          // a confirmed People page with an extractor gap stays visible instead of
          // being dropped. The gap is generic (name+role card layouts the current
          // roster logic does not recognise) and is reported, not patched here.
          notesForSeed.push("People page confirmed by leadership context; generic extractor found no people yet (extraction gap for EXT-C)");
        }
        if (notesForSeed.length) base.note = notesForSeed.join("; ");
        entry.seeds.push(base);
        for (const n of names) keptNames.add(n);
        if (verdict.contentHash) keptHashes.add(verdict.contentHash);
      };

      const addFuture = (url: string, reason: string) => {
        if (entry.future_candidates.some((x) => x.url === url)) return;
        entry.future_candidates.push({ url, reason, observed_at: new Date().toISOString() });
      };

      // --- Priority 0: the registry's own PEOPLE known_url (already verified) ---
      const configPeople = s.capabilities.find((c) => c.capability === "PEOPLE")?.known_url;
      if (configPeople) {
        const v = await check(configPeople, "CONFIG_KNOWN_URL", "PILOT_REGISTRY");
        if (v) addSeed(configPeople, "BOARD", v, "CONFIG_KNOWN_URL", "PILOT_REGISTRY", false);
        else entry.future_candidates.push({ url: configPeople, reason: "config people url produced no extractable people", observed_at: new Date().toISOString() });
      }

      // --- Research leads (untrusted; verified like anything else) ---
      for (const lead of RESEARCH_LEADS[s.id] ?? []) {
        const v = await check(lead, "RESEARCH_LEAD", "RESEARCH_LEAD");
        if (!v) continue;
        tried.push({ url: lead, verdict: v });
        const pathKind = kindFromPath(new URL(lead).pathname);
        if (v.hasContext) addSeed(lead, pathKind ?? "CORPORATE_TEAM", v, "RESEARCH_LEAD", "RESEARCH_LEAD", false);
        else if (pathKind && FUTURE_ONLY.has(pathKind)) addFuture(lead, `kind=${pathKind} (branch/career work, not M3.3 People)`);
        else notes.push({ slug: s.id, url: lead, note: `lead fetched but no leadership context (${v.error ?? `role signals: ${v.roleSignals.length}`})` });
      }

      // --- Phase 1: homepage + generic link discovery (reuses the fallback module) ---
      let home = cache.homepages[s.id];
      if (!home || has("refresh")) {
        const hFetcher = new ControlledFetcher(policyFor(s.url));
        try {
          const f = await hFetcher.fetch(s.url);
          totalFetches += 1;
          if (!f.error && f.httpStatus === 200 && (f.contentType ?? "").toLowerCase().includes("html")) {
            const html = new TextDecoder().decode(f.body);
            const cands = extractPeopleCandidates(html, s.url, RESEARCH_BUDGET.maxLinkCandidates).map((c) => c.url);
            const v = await verifyWithExtractor(f.body, f.contentHash || "", f.finalUrl, s.id, s.institution_id);
            home = { status: 200, candidates: cands, people: v.people, checkedAt: new Date().toISOString() };
            if (v.people >= 1) {
              notes.push({ slug: s.id, url: s.url, note: `homepage itself yielded ${v.people} people (${v.roles.join(",")}) - source root, not seeded as a separate People url` });
            }
          } else {
            home = { status: f.httpStatus, candidates: [], people: 0, checkedAt: new Date().toISOString() };
          }
        } catch (e) {
          home = { status: null, candidates: [], people: 0, checkedAt: new Date().toISOString() };
          notes.push({ slug: s.id, url: s.url, note: `homepage fetch failed: ${msg(e)}` });
        }
        cache.homepages[s.id] = home;
      }

      // --- Phase 2: link-discovered candidates, then generic path probes ---
      for (const c of home?.candidates ?? []) {
        if (entry.seeds.length >= RESEARCH_BUDGET.maxSeedsPerInstitution) break;
        const v = await check(c, "LINK_DISCOVERY", "HOMEPAGE_LINK");
        if (!v) continue;
        const k = kindFromPath(new URL(c).pathname);
        if (v.hasContext) addSeed(c, k ?? "CORPORATE_TEAM", v, "LINK_DISCOVERY", "HOMEPAGE_LINK", false);
        else if (k && FUTURE_ONLY.has(k)) addFuture(c, `kind=${k} (branch/career work, not M3.3 People)`);
      }

      if (entry.seeds.length < RESEARCH_BUDGET.maxSeedsPerInstitution) {
        for (const cand of CANDIDATE_PATHS) {
          if (entry.seeds.length >= RESEARCH_BUDGET.maxSeedsPerInstitution) break;
          const url = new URL(cand.path, s.url).href;
          const v = await check(url, "PATH_PROBE", "GENERIC_PATH_VOCABULARY");
          if (!v) continue;
          if (v.hasContext) addSeed(url, cand.kind, v, "PATH_PROBE", "GENERIC_PATH_VOCABULARY", cand.weak);
          else if (FUTURE_ONLY.has(cand.kind)) addFuture(url, `kind=${cand.kind} (branch/career work, not M3.3 People)`);
        }
      }

      // Deterministic ordering: priority, then confidence, then URL.
      entry.seeds.sort((a, b) => a.priority - b.priority || b.confidence - a.confidence || a.url.localeCompare(b.url));
      entry.future_candidates.sort((a, b) => a.url.localeCompare(b.url));
      manifest.push(entry);

      const summary = entry.seeds.length === 0 ? "NO SEED" : entry.seeds.map((x) => `${x.kind}@${x.confidence}`).join(",");
      console.log(
        ` [seed] ${s.id.padEnd(30)} seeds=${String(entry.seeds.length).padEnd(2)} fetches=${String(fetches).padEnd(2)} ${summary}`,
      );
      for (const n of notes.filter((n) => n.slug === s.id).slice(-2)) console.log(`      note: ${n.note}`);
      for (const r of rejectedLeads.filter((r) => r.slug === s.id)) console.log(`      rejected lead: ${r.url} -> ${r.verdict}`);
    }
  };

  await Promise.all(Array.from({ length: Math.min(RESEARCH_BUDGET.concurrency, sources.length) }, () => worker()));

  // ------------------------------------------------------------- write output
  manifest.sort((a, b) => a.institution_slug.localeCompare(b.institution_slug));
  const covered = manifest.filter((m) => m.seeds.length > 0);
  writeFileSync(
    MANIFEST_JSON,
    JSON.stringify(
      {
        $schema: "people-url-seeds/v1",
        generated_at: new Date().toISOString(),
        milestone: "M3.3-GENERIC-EXT-B",
        universe: pilot.sources.length,
        covered: covered.length,
        uncovered: manifest.length - covered.length,
        total_seeds: manifest.reduce((n, m) => n + m.seeds.length, 0),
        research_fetches: totalFetches,
        note:
          "Seeds are discovery provenance, not verified people data. Every seed was verified by " +
          "controlled fetch + the existing generic extractor; a URL alone was never accepted. " +
          "Generic discovery remains the fallback for institutions with no seed.",
        // Serialised per the milestone spec: each institution exposes
        // `people_urls` (the internal field is `seeds`).
        institutions: manifest.map(({ seeds, ...rest }) => ({ ...rest, people_urls: seeds })),
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(CACHE_JSON, JSON.stringify(cache, null, 2) + "\n");

  const boardSeeds = manifest.flatMap((m) => m.seeds.filter((x) => x.kind === "BOARD"));
  const execSeeds = manifest.flatMap((m) => m.seeds.filter((x) => x.kind === "MANAGEMENT" || x.kind === "EXECUTIVE" || x.kind === "LEADERSHIP"));
  const otherSeeds = manifest.flatMap((m) => m.seeds.filter((x) => x.kind === "CORPORATE_TEAM" || x.kind === "ORGANIZATIONAL_CHART"));
  const gapSeeds = manifest.flatMap((m) => m.seeds.filter((x) => x.people_found < 1).map((x) => `${m.institution_slug} ${new URL(x.url).pathname}`));
  const peopleFound = manifest.reduce((n, m) => n + m.seeds.reduce((k, x) => k + x.people_found, 0), 0);

  console.log("\n== seeding result");
  console.log(`institutions with >=1 verified People page: ${covered.length}/${manifest.length}`);
  console.log(`People pages found (seeds): ${manifest.reduce((n, m) => n + m.seeds.length, 0)}`);
  console.log(`  BOARD ${boardSeeds.length} | MGMT/EXEC/LEADERSHIP ${execSeeds.length} | TEAM/ORG-CHART ${otherSeeds.length}`);
  console.log(`people extracted today by the existing generic extractor: ${peopleFound}`);
  console.log(`People pages with an extraction gap (EXT-C candidate): ${gapSeeds.length}`);
  for (const g of gapSeeds) console.log(`  gap: ${g}`);
  console.log(`future branch/career candidates recorded: ${manifest.reduce((n, m) => n + m.future_candidates.length, 0)}`);
  console.log(`rejected research leads: ${rejectedLeads.length}`);
  for (const r of rejectedLeads) console.log(`  ${r.slug}: ${r.url} -> ${r.verdict}`);
  console.log(`no seed (generic discovery fallback): ${manifest.filter((m) => m.seeds.length === 0).map((m) => m.institution_slug).join(", ") || "none"}`);
  const soft = notes.filter((n) => n.note.startsWith("http 200 but no leadership context"));
  console.log(`\nsoft-404 / non-People 200s observed: ${soft.length}`);
  for (const m of manifest) {
    const mine = soft.filter((n) => n.slug === m.institution_slug).map((n) => new URL(n.url).pathname);
    if (mine.length) console.log(`  ${m.institution_slug}: ${mine.join(" ")}`);
  }
  console.log(`manifest written: ${MANIFEST_JSON}`);
}

main().catch((e) => {
  console.error("People URL seeding failed:", e);
  process.exit(1);
});
