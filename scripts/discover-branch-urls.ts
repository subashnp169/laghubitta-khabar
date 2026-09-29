// M3.4 step 2 (BRANCH URL DISCOVERY) - no branch assertions are written.
//
// WHY THIS EXISTS: the M3.4 shape inventory proved that the 35 committed
// BRANCH_DIRECTORY targets contain ZERO real branch pages. Ten of them are
// homepages and one is /contact-us, all backfilled via anchor=evidence-homepage.
// So before any extractor work, the real branch pages have to be FOUND.
//
// METHOD (deterministic, no AI, no browser/JS):
//   stage 1  sitemap discovery   robots.txt -> /sitemap.xml -> /wp-sitemap.xml
//   stage 2  candidate mining    parse <loc> from the sitemaps, ZERO page fetches,
//                                 then score branch-ness of each same-site path
//   stage 3  bounded verification fetch the best candidates and confirm them with
//                                 a STRUCTURAL gate, never vocabulary alone
//
// The stage 3 gate is the whole point. The shape inventory showed branch-html-v1
// asserting "Number of Branch Office" off a homepage, so a page is only reported
// as a branch directory when it has structural corroboration: repeatable rows or
// address/phone blocks. Branch vocabulary on its own is NEVER sufficient.
//
//   npx tsx scripts/discover-branch-urls.ts
//
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ControlledFetcher, nodeResolveHost } from "../lib/ingestion";
import { branchDirectoryExtractor } from "../lib/ingestion/structured";
import {
  classifyShape,
  countMatches,
  isUnreadable,
  signalsOf,
  textOf,
  type Shape,
} from "../lib/ingestion/shape-signals";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string) => {
  prepare(s: string): {
    run(...a: unknown[]): unknown;
    all(...a: unknown[]): Array<Record<string, unknown>>;
    get(...a: unknown[]): Record<string, unknown>;
  };
  exec(s: string): void;
  close(): void;
};

const DB = "data/pilot/evidence/pilot-branch-url-discovery-2026-09-27.db";
const OUT = "data/pilot/branch-url-discovery.json";

// --- bounds. This is a survey, not a crawl. ---
const MAX_SITEMAP_PROBES_PER_HOST = 3;
const MAX_CHILD_SITEMAPS = 6;
const MAX_LOCS_PER_SITEMAP = 20000;
const MAX_CANDIDATES_PER_SOURCE = 6;
const MAX_VERIFY_FETCHES = 30;
const TOTAL_FETCH_CAP = 500;

const NON_HTML_EXT =
  /\.(?:pdf|docx?|xlsx?|pptx?|csv|zip|rar|7z|gz|tar|jpe?g|png|gif|svg|webp|bmp|ico|mp4|mp3|avi|mov|wmv|json|xml|rss|atom)$/i;

/** Strong branch signal, in the path. */
const CORE_BRANCH_PATH =
  /(?:branch|branches|branch[-_]?network|branch[-_]?list|our[-_]?branch|branch[-_]?locator|शाखा|कार्यालय)/iu;

/** Weak branch signal: a location-ish word that is often a product, not a branch. */
const WEAK_BRANCH_PATH = /(?:network|outlet|locator|office|center|centre|atm|branch|शाखा)/iu;

/** Product words that make a "network"/"office" match a false positive. */
const PRODUCT_WORDS =
  /(?:banking|mobile|internet|remit|remittance|loan|savings|deposit|insurance|atm|card|net[-_]?banking|e[-_]?banking|account|खाता|ऋण|बचत|विमा)/iu;

/** Path segments that mean the page is about something other than branches. */
const OFF_TOPIC_SEGMENT =
  /\b(?:career|careers|jobs?|blog|news|press|pressroom|media|gallery|photo|photos|download|downloads|privacy|terms|disclaimer|notice|notices|tender|tenders|procurement|annual[-_]?report|financial|audited|share[-_]?price|agm|general[-_]?meeting|board|board[-_]?of[-_]?directors|director|management|governance|profile|profiles|team|staff|scholarship|internship|volunteer|faq|feedback|contact|about|history|vision|mission|objective|newsletter|event|events|achievement|achievements|impact|stories|story|service|services|product|products|login|register|signup|apply|application|form|forms|recruit|advertisement|public[-_]?notice|circular|guideline|guidelines|policy|policies|rate|rates|interest|exchange|news[-_]?update|updates|publication|publications|research|report|reports)\b/iu;

type Verdict =
  | "VERIFIED_BRANCH_DIRECTORY"
  | "BRANCH_PAGE_NEEDS_JS"
  | "BRANCH_INTENT_NO_STRUCTURE"
  | "NOT_A_BRANCH_PAGE"
  | "UNREADABLE";

/**
 * Confirmation gate. STRUCTURAL corroboration required; branch vocabulary alone
 * is never enough, because that is exactly how "Number of Branch Office" got
 * asserted off a homepage in the shape inventory.
 *
 * Verified means EITHER the current parser reads >= 2 names off the page, OR the
 * page repeats address/phone-bearing rows. A table that merely exists, next to a
 * single contact address, is not a directory.
 */
function confirm(
  signals: ReturnType<typeof signalsOf>,
  dryRunBranchNames: number,
): Verdict {
  if (signals.branchVocabHits === 0 && signals.branchRows === 0) return "NOT_A_BRANCH_PAGE";
  // The current parser can actually read >= 2 rows off this page.
  if (dryRunBranchNames >= 2) return "VERIFIED_BRANCH_DIRECTORY";
  // Repeated rows that each carry an address / phone / district: a real
  // directory in markup branch-html-v1 cannot read.
  if (signals.branchRows >= 2) return "VERIFIED_BRANCH_DIRECTORY";
  // Branch intent with a map/select locator but no server-rendered rows.
  if (signals.locatorMarkers > 0 && signals.branchVocabHits > 0) return "BRANCH_PAGE_NEEDS_JS";
  // Branch vocabulary or a table, but nothing that repeats as a location record.
  return "BRANCH_INTENT_NO_STRUCTURE";
}

interface Candidate {
  url: string;
  path: string;
  score: number;
  why: string;
  via: string;
}

function apexOf(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

/**
 * Decide whether a same-site path is branch-shaped, and why. Explainable and
 * deterministic: CORE in the final segment wins outright, otherwise the path
 * must be off-topic-free and carry a WEAK location word that is not a product.
 */
function scoreCandidate(rawUrl: string, siteHost: string, via: string): Candidate | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!apexOf(u.hostname).endsWith(apexOf(siteHost))) return null;
  if (NON_HTML_EXT.test(u.pathname)) return null;

  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the encoded form */
  }
  const segments = path.split("/").filter(Boolean);
  const last = segments.length ? segments[segments.length - 1] : "";
  const hasCore = CORE_BRANCH_PATH.test(last) || CORE_BRANCH_PATH.test(path);
  const hasWeak = WEAK_BRANCH_PATH.test(path);
  if (!hasCore && !hasWeak) return null;
  // A core branch segment is decisive even under an /about-us/ prefix.
  if (!hasCore) {
    if (OFF_TOPIC_SEGMENT.test(path)) return null;
    if (PRODUCT_WORDS.test(path)) return null;
  }
  const score = hasCore ? 3 : 1;
  return {
    url: `${u.origin}${u.pathname}`,
    path,
    score,
    why: hasCore ? `core branch token in "${last || "/"}"` : "weak location token, off-topic-free",
    via,
  };
}

/** A candidate we could not read: recorded as unreadable, never as a negative. */
function unreadableEntry(c: Candidate, detail: string): VerifiedEntry {
  return {
    url: c.url,
    httpStatus: null,
    bytes: 0,
    contentHash: "",
    snapshotId: "",
    score: c.score,
    why: c.why,
    via: c.via,
    verdict: "UNREADABLE",
    shape: null,
    dryRunBranchNames: 0,
    parserOutput: nameQuality([]),
    titleSample: "",
    detail,
  };
}

function locsOf(xml: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].replace(/&amp;/g, "&").trim());
    if (out.length >= MAX_LOCS_PER_SITEMAP) break;
  }
  return out;
}

/**
 * Mine candidate URLs from the anchors of an already-fetched page. Sitemaps are
 * unreliable in the field: the skbbl/swbbl sitemaps are dev artifacts serving
 * http://localhost:8000/ with a hospital template, so the in-page nav is the
 * more trustworthy discovery surface. Link TEXT is corroborating evidence, so a
 * link is scored on its href and its label together.
 */
function navCandidates(html: string, pageUrl: string, siteHost: string, via: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const label = textOf(m[2]);
    if (!href || href.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(href)) continue;
    let abs: string;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(abs).pathname);
    } catch {
      path = new URL(abs).pathname;
    }
    const last = path.split("/").filter(Boolean).pop() ?? "";
    const hrefCore = CORE_BRANCH_PATH.test(last) || CORE_BRANCH_PATH.test(path);
    const hrefWeak = WEAK_BRANCH_PATH.test(path);
    const textCore = CORE_BRANCH_PATH.test(label);
    const textWeak = /\b(?:branch|branches|network|outlet|locator|office|शाखा|कार्यालय)\b/iu.test(label);
    if (!hrefCore && !hrefWeak && !textCore && !textWeak) continue;
    const c = scoreCandidate(abs, siteHost, via);
    if (!c) continue;
    // A branch-worded link label is real evidence; promote it.
    if (textCore && c.score < 3) {
      c.score = 3;
      c.why = `link label "${label.slice(0, 40)}"`;
    } else if (c.why.startsWith("weak") && textWeak) {
      c.why = `link label "${label.slice(0, 40)}"`;
    }
    out.push(c);
  }
  return out;
}

/**
 * Is the parser's own output usable, or did it latch onto a repeated column
 * header? Observed in the field: on a genuine 24-branch page, branch-html-v1
 * emitted "Branch Manager" seventeen times, because that header column repeats
 * once per branch. A "directory" verdict is about the PAGE; this is about
 * whether we could actually read it, and the two must not be conflated.
 */
function nameQuality(names: string[]): {
  quality: "NONE" | "CLEAN" | "REPEATED_HEADER";
  distinct: number;
  topName: string | null;
  topCount: number;
} {
  if (names.length === 0) return { quality: "NONE", distinct: 0, topName: null, topCount: 0 };
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  let topName: string | null = null;
  let topCount = 0;
  for (const [n, c] of counts) {
    if (c > topCount) {
      topName = n;
      topCount = c;
    }
  }
  const quality = topCount >= 3 && topCount >= names.length / 2 ? "REPEATED_HEADER" : "CLEAN";
  return { quality, distinct: counts.size, topName, topCount };
}

interface VerifiedEntry {
  url: string;
  httpStatus: number | null;
  bytes: number;
  contentHash: string;
  snapshotId: string;
  score: number;
  why: string;
  via: string;
  verdict: Verdict;
  shape: Shape | null;
  dryRunBranchNames: number;
  parserOutput: ReturnType<typeof nameQuality>;
  titleSample: string;
  detail?: string;
}

interface SourceResult {
  sourceId: string;
  institutionId: string | null;
  committedUrl: string;
  host: string;
  sitemapVia: string | null;
  sitemapsRead: string[];
  sitemapAnomaly: string | null;
  locsScanned: number;
  candidatesKept: Candidate[];
  verified: VerifiedEntry[];
  note: string | null;
}

interface Row {
  sourceId: string;
  institutionId: string | null;
  url: string;
}

function policyFor(url: string, budget: Record<string, number>) {
  const host = new URL(url).hostname;
  const apex = apexOf(host);
  return {
    allowedHosts: apex === host ? [host] : [host, apex],
    allowSubdomainsOf: [apex],
    maxBytes: budget.maxBytes,
    maxRedirects: budget.maxRedirects,
    maxRetries: budget.maxRetries,
    timeoutMs: 15000,
    minIntervalMs: 250,
    resolveHost: nodeResolveHost,
  };
}

async function main(): Promise<void> {
  const pilot = JSON.parse(readFileSync("data/pilot/pilot-sources.json", "utf8")) as {
    sources: Array<{
      id: string;
      institution_id?: string;
      capabilities: Array<{ capability: string; known_url: string | null }>;
    }>;
  };
  const budget = (
    JSON.parse(readFileSync("data/pilot/pilot-budget.json", "utf8")) as {
      defaults: Record<string, number>;
    }
  ).defaults;

  const targets: Row[] = [];
  for (const s of pilot.sources) {
    for (const c of s.capabilities) {
      if (c.capability === "BRANCH_DIRECTORY" && c.known_url) {
        targets.push({ sourceId: s.id, institutionId: s.institution_id ?? null, url: c.known_url });
      }
    }
  }

  const db = new Database(DB);
  db.exec(fsSchema());

  // --verify-only: reuse the candidates already mined, and re-run only the
  // confirmation stage. Gate changes must not cost another 150 site requests.
  const verifyOnly = process.argv.includes("--verify-only");
  const reuse = verifyOnly
    ? ((JSON.parse(readFileSync(OUT, "utf8")) as { results: SourceResult[] }).results ?? [])
    : [];
  if (verifyOnly) console.log(`verify-only: reusing ${reuse.length} mined candidate sets\n`);

  const bySource: SourceResult[] = [];
  let fetches = 0;
  let sitemapFetches = 0;
  let verifyFetches = 0;
  let navFetches = 0;
  const budgetExhausted = (): boolean => fetches >= TOTAL_FETCH_CAP;

  for (const [i, t] of targets.entries()) {
    if (verifyOnly) {
      const prior = reuse.find((r) => r.sourceId === t.sourceId);
      if (prior) {
        prior.verified = [];
        bySource.push(prior);
      } else {
        bySource.push({
          sourceId: t.sourceId,
          institutionId: t.institutionId,
          committedUrl: t.url,
          host: new URL(t.url).hostname,
          sitemapVia: null,
          sitemapsRead: [],
          sitemapAnomaly: null,
          locsScanned: 0,
          candidatesKept: [],
          verified: [],
          note: "not present in the reused candidate set",
        });
      }
      continue;
    }
    const siteHost = new URL(t.url).hostname;
    const origin = new URL(t.url).origin;
    const fetcher = new ControlledFetcher(policyFor(t.url, budget));
    const perSource: SourceResult = {
      sourceId: t.sourceId,
      institutionId: t.institutionId,
      committedUrl: t.url,
      host: siteHost,
      sitemapVia: null,
      sitemapsRead: [],
      sitemapAnomaly: null,
      locsScanned: 0,
      candidatesKept: [],
      verified: [],
      note: null,
    };

    db.prepare(
      `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, is_active, created_at)
       VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, 1, ?)`,
    ).run(
      t.sourceId,
      t.url,
      siteHost,
      `${t.sourceId} branch url discovery`,
      new Date().toISOString(),
    );

    // ---- stage 1: find a sitemap -------------------------------------------
    const sitemapUrls: Array<{ url: string; via: string }> = [];
    if (!budgetExhausted()) {
      fetches++;
      sitemapFetches++;
      try {
        const out = await fetcher.fetchControlled({
          url: `${origin}/robots.txt`,
          requestId: `m34-disc-${i}-robots`,
        });
        const txt = new TextDecoder().decode(out.result.body);
        let m: RegExpExecArray | null;
        const re = /^\s*sitemap\s*:\s*(\S+)/gim;
        while ((m = re.exec(txt)) !== null) {
          if (/^https?:/i.test(m[1])) sitemapUrls.push({ url: m[1], via: "robots.txt" });
        }
        perSource.sitemapVia = sitemapUrls.length ? "robots.txt" : null;
      } catch {
        /* no robots.txt is normal */
      }
    }
    if (sitemapUrls.length === 0) {
      for (const guess of ["/sitemap.xml", "/wp-sitemap.xml"]) {
        if (budgetExhausted()) break;
        fetches++;
        sitemapFetches++;
        try {
          const out = await fetcher.fetchControlled({
            url: `${origin}${guess}`,
            requestId: `m34-disc-${i}-sm${guess.length}`,
          });
          const r = out.result;
          if (r.httpStatus === 200 && r.bodyBytes > 0) {
            const txt = new TextDecoder().decode(r.body);
            if (/<(?:urlset|sitemapindex)\b/i.test(txt)) {
              sitemapUrls.push({ url: `${origin}${guess}`, via: `probe ${guess}` });
              perSource.sitemapVia = perSource.sitemapVia ?? `probe ${guess}`;
            }
          }
        } catch {
          /* try the next guess */
        }
        if (sitemapUrls.length > 0) break;
      }
    }

    // ---- stage 2: mine candidate URLs from sitemaps, zero page fetches ------
    const seenSitemap = new Set<string>();
    const queue = [...sitemapUrls];
    const locs: Array<{ loc: string; via: string }> = [];
    let children = 0;
    while (queue.length > 0 && !budgetExhausted()) {
      const next = queue.shift();
      if (!next || seenSitemap.has(next.url)) continue;
      seenSitemap.add(next.url);
      if (children >= MAX_CHILD_SITEMAPS) break;
      children++;
      try {
        fetches++;
        sitemapFetches++;
        const out = await fetcher.fetchControlled({
          url: next.url,
          requestId: `m34-disc-${i}-map${children}`,
        });
        const r = out.result;
        if (r.httpStatus !== 200 || r.bodyBytes === 0) continue;
        const xml = new TextDecoder().decode(r.body);
        perSource.sitemapsRead.push(next.url);
        const isIndex = /<sitemapindex\b/i.test(xml);
        for (const loc of locsOf(xml)) {
          if (isIndex) {
            if (!seenSitemap.has(loc)) queue.push({ url: loc, via: `child of ${next.url}` });
          } else {
            locs.push({ loc, via: next.via });
          }
        }
      } catch {
        /* unreadable sitemap */
      }
    }
    perSource.locsScanned = locs.length;

    // Flag sitemaps that point off-site. Observed in the field: skbbl/swbbl
    // publish http://localhost:8000/ dev artifacts carrying a hospital template,
    // so their sitemap is worthless for discovery. Recorded, never trusted.
    for (const { loc } of locs) {
      try {
        const h = new URL(loc).hostname.toLowerCase();
        if (h === "localhost" || /^(?:127\.|0\.)/.test(h) || h === "::1") {
          perSource.sitemapAnomaly = `sitemap loc points at ${h} (dev artifact, not usable)`;
          break;
        }
      } catch {
        /* ignore */
      }
    }

    // ---- score + cap candidates ----
    const byUrl = new Map<string, Candidate>();
    for (const { loc, via } of locs) {
      const c = scoreCandidate(loc, siteHost, via);
      if (!c) continue;
      const prev = byUrl.get(c.url);
      if (!prev || c.score > prev.score) byUrl.set(c.url, c);
    }
    perSource.candidatesKept = [...byUrl.values()]
      .sort((a, b) => b.score - a.score || a.url.length - b.url.length || a.url.localeCompare(b.url))
      .slice(0, MAX_CANDIDATES_PER_SOURCE);

    // ---- stage 2b: in-page nav mining, the reliable surface in the field ----
    // One fetch of the site entry page, then score its anchors. Done for every
    // source, not only the sitemap-less ones, because even a valid sitemap can
    // omit the branch page.
    if (!budgetExhausted()) {
      try {
        fetches++;
        navFetches++;
        const out = await fetcher.fetchControlled({
          url: `${origin}/`,
          requestId: `m34-disc-${i}-nav`,
        });
        const r = out.result;
        if (r.httpStatus === 200 && r.bodyBytes > 0) {
          const html = new TextDecoder().decode(r.body);
          for (const c of navCandidates(html, r.finalUrl, siteHost, "site nav")) {
            const prev = byUrl.get(c.url);
            if (!prev || c.score > prev.score) byUrl.set(c.url, c);
          }
        }
      } catch {
        /* nav mining is best-effort */
      }
    }
    perSource.candidatesKept = [...byUrl.values()]
      .sort((a, b) => b.score - a.score || a.url.length - b.url.length || a.url.localeCompare(b.url))
      .slice(0, MAX_CANDIDATES_PER_SOURCE);

    bySource.push(perSource);
  }

  // ---- stage 3: bounded verification, ROUND ROBIN over sources ------------
  // A single global cap consumed in source order would spend the whole budget on
  // whichever sources sort first, so the first candidate of every source is
  // verified before any source gets a second.
  const planned = new Map<SourceResult, Candidate[]>();
  for (const s of bySource) planned.set(s, s.candidatesKept);
  const depth = Math.max(0, ...[...planned.values()].map((c) => c.length));
  const order: Array<{ s: SourceResult; c: Candidate }> = [];
  for (let d = 0; d < depth; d++) {
    for (const s of bySource) {
      const c = planned.get(s)?.[d];
      if (c) order.push({ s, c });
    }
  }

  for (const { s, c } of order) {
    if (verifyFetches >= MAX_VERIFY_FETCHES || budgetExhausted()) {
      for (const other of bySource) {
        if ((other.verified as VerifiedEntry[]).length === 0 && other.candidatesKept.length > 0) {
          other.note = other.note ?? `verify cap reached (${MAX_VERIFY_FETCHES}); unverified`;
        }
      }
      break;
    }
    const t = targets.find((x) => x.sourceId === s.sourceId);
    if (!t) continue;
    const fetcher = new ControlledFetcher(policyFor(t.url, budget));
    const perSource = s;
    {
      verifyFetches++;
      fetches++;
      let r: {
        body: Uint8Array;
        bodyBytes: number;
        httpStatus: number | null;
        contentType: string | null;
        contentHash: string | null;
        fetchedAt: string;
        finalUrl: string;
        redirectCount: number;
      };
      try {
        r = (await fetcher.fetchControlled({
          url: c.url,
          requestId: `m34-disc-v${verifyFetches}`,
        })).result;
      } catch (e) {
        perSource.verified.push(unreadableEntry(c, (e as Error).message));
        continue;
      }
      const snapId = `snap-m34disc-${createHash("sha256").update(c.url).digest("hex").slice(0, 12)}`;
      const contentHash = r.contentHash || createHash("sha256").update(r.body).digest("hex");
      db.prepare(
        `INSERT OR REPLACE INTO source_snapshots (id, source_id, fetched_at, content_hash, http_status, mime_type, parser_version, extraction_status)
         VALUES (?, ?, ?, ?, ?, ?, 'branch-url-discovery-v1', 'PENDING')`,
      ).run(snapId, t.sourceId, r.fetchedAt, contentHash, r.httpStatus, r.contentType);

      const html = new TextDecoder().decode(r.body);
      const unreadable = isUnreadable(r.httpStatus, r.bodyBytes);
      const isHtml = (r.contentType ?? "").toLowerCase().includes("html");
      let shape: Shape = "NOT_A_BRANCH_PAGE";
      let dryNames = 0;
      let dryNameList: string[] = [];
      let verdict: Verdict = "UNREADABLE";
      if (unreadable || !isHtml) {
        verdict = "UNREADABLE";
      } else {
        const sig = signalsOf(html);
        const dry = await branchDirectoryExtractor.extract({
          sourceId: t.sourceId,
          institutionId: t.institutionId ?? undefined,
          sourceType: "MFB_WEBSITE",
          capability: "BRANCH_DIRECTORY",
          url: r.finalUrl,
          parserId: "branch-url-discovery",
          contentHash,
          body: r.body,
        });
        dryNameList = dry.filter((e) => e.field === "BRANCH_NAME").map((e) => String(e.text));
        dryNames = dryNameList.length;
        shape = classifyShape(sig, dryNames, 0);
        verdict = confirm(sig, dryNames);
      }
      perSource.verified.push({
        url: c.url,
        httpStatus: r.httpStatus,
        bytes: r.bodyBytes,
        contentHash,
        snapshotId: snapId,
        score: c.score,
        why: c.why,
        via: c.via,
        verdict,
        shape,
        dryRunBranchNames: dryNames,
        parserOutput: nameQuality(dryNameList),
        titleSample: textOf(html).slice(0, 110),
      });
    }
  }

  for (const s of bySource) {
    const verified = s.verified.filter((v) => v.verdict === "VERIFIED_BRANCH_DIRECTORY").length;
    const js = s.verified.filter((v) => v.verdict === "BRANCH_PAGE_NEEDS_JS").length;
    console.log(
      `  ${s.sourceId.padEnd(28)} locs=${String(s.locsScanned).padStart(5)} cand=${String(s.candidatesKept.length).padStart(2)} verified=${verified} needsJS=${js}${s.sitemapAnomaly ? "  [bad sitemap]" : ""}`,
    );
  }

  // ---- summary ------------------------------------------------------------
  const allVerified = bySource.flatMap((s) => s.verified.map((v) => ({ sourceId: s.sourceId, institutionId: s.institutionId, ...v })));
  const tally = (k: Verdict): number => allVerified.filter((v) => v.verdict === k).length;
  const summary = {
    targets: targets.length,
    totalFetches: fetches,
    sitemapFetches,
    navFetches,
    verifyFetches,
    sourcesWithSitemap: bySource.filter((s) => s.sitemapVia).length,
    sourcesWithCandidates: bySource.filter((s) => s.candidatesKept.length > 0).length,
    sourcesWithVerifiedBranchDirectory: bySource.filter((s) => s.verified.some((v) => v.verdict === "VERIFIED_BRANCH_DIRECTORY")).length,
    sourcesNeedingJs: bySource.filter((s) => s.verified.some((v) => v.verdict === "BRANCH_PAGE_NEEDS_JS")).length,
    candidateUrlsChecked: allVerified.length,
    parserReadablePages: allVerified.filter(
      (v) => v.parserOutput.quality === "CLEAN" && v.dryRunBranchNames >= 2,
    ).length,
    parserUnreadableRealDirectories: allVerified.filter(
      (v) =>
        v.verdict === "VERIFIED_BRANCH_DIRECTORY" &&
        !(v.parserOutput.quality === "CLEAN" && v.dryRunBranchNames >= 2),
    ).length,
    verdictTally: {
      VERIFIED_BRANCH_DIRECTORY: tally("VERIFIED_BRANCH_DIRECTORY"),
      BRANCH_PAGE_NEEDS_JS: tally("BRANCH_PAGE_NEEDS_JS"),
      BRANCH_INTENT_NO_STRUCTURE: tally("BRANCH_INTENT_NO_STRUCTURE"),
      NOT_A_BRANCH_PAGE: tally("NOT_A_BRANCH_PAGE"),
      UNREADABLE: tally("UNREADABLE"),
    },
  };

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        $schema: "branch-url-discovery/v1",
        generated_at: new Date().toISOString(),
        mode: verifyOnly ? "verify-only (candidates reused from a previous mine)" : "full mine + verify",
        purpose:
          "Discover REAL branch page URLs for the committed BRANCH_DIRECTORY sources. No assertions written, no schema change, pilot-sources.json NOT modified.",
        method:
          "stage1 robots.txt -> /sitemap.xml -> /wp-sitemap.xml; stage2 mine+score <loc> paths (zero page fetches); stage3 bounded fetch and confirm with a STRUCTURAL gate (vocabulary alone is never sufficient)",
        bounds: {
          maxSitemapProbesPerHost: MAX_SITEMAP_PROBES_PER_HOST,
          maxChildSitemaps: MAX_CHILD_SITEMAPS,
          maxCandidatesPerSource: MAX_CANDIDATES_PER_SOURCE,
          maxVerifyFetches: MAX_VERIFY_FETCHES,
          totalFetchCap: TOTAL_FETCH_CAP,
        },
        summary,
        results: bySource,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const counts = (db.prepare("SELECT COUNT(*) c FROM source_snapshots").get() as { c: number }).c;
  const asserts = (db.prepare("SELECT COUNT(*) c FROM data_assertions").get() as { c: number }).c;
  db.close();

  console.log("\nsummary:");
  for (const [k, v] of Object.entries(summary)) {
    if (typeof v === "object") continue;
    console.log(`  ${k.padEnd(38)} ${v}`);
  }
  for (const [k, v] of Object.entries(summary.verdictTally)) console.log(`  ${k.padEnd(38)} ${v}`);
  console.log(`\nsource_snapshots ${counts}  data_assertions ${asserts} (must be 0)`);
  console.log(`report: ${OUT}`);
  console.log(`evidence db: ${DB} (snapshots only)`);
}

function fsSchema(): string {
  return `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_scope TEXT NOT NULL,
  source_grade TEXT NOT NULL, url TEXT NOT NULL, domain TEXT NOT NULL, title TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_snapshots (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, fetched_at TEXT NOT NULL,
  content_hash TEXT NOT NULL, http_status INTEGER, mime_type TEXT, r2_key TEXT,
  parser_version TEXT, extraction_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (extraction_status IN ('PENDING','EXTRACTED','FAILED','SKIPPED')));
CREATE TABLE IF NOT EXISTS data_assertions (id TEXT PRIMARY KEY, source_snapshot_id TEXT, assertion_type TEXT, field TEXT, value_text TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS data_conflicts (id TEXT PRIMARY KEY, created_at TEXT);
CREATE TABLE IF NOT EXISTS validation_results (id TEXT PRIMARY KEY, created_at TEXT);
`;
}

void main();
