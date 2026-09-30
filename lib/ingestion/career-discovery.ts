// ============================================================================
// M3.5 — Generic career / vacancy target discovery.
//
// Discovery finds CANDIDATE career pages. It never publishes a vacancy, and it
// never fetches. A discovered target is a claim that a page is worth fetching,
// nothing more.
//
// The rule that shapes this module: URL text alone is not evidence. A link whose
// href happens to contain "career" is a weak signal, because so does a nav label
// on a page that only links to a third-party job board. A candidate needs
// COMBINED deterministic evidence — the href, the anchor text, where the link
// sits in the page, and what the link points at. Each contribution is recorded
// as a reason string so every score is auditable after the fact.
//
// Reused from the M1-era discovery module without editing it:
//   parseSitemapLocs, parseRobotsSitemap, isSitemapUrl, normalizeDiscoveredUrl
// Not reused, deliberately: extractSameHostLinks returns hrefs without anchor
// text, and anchor text is half the evidence. Re-implementing link extraction
// here is not duplication of a reusable seam; it is a different question.
// ============================================================================

import { isSitemapUrl, normalizeDiscoveredUrl, parseSitemapLocs } from "./discovery";
import type { CapabilityKind, DiscoveredTarget, DiscoveryMethod, EvidenceStatus } from "./types";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Path/URL fragments. Weighted low on their own — see careerLinkEvidence. */
export const CAREER_HREF_HINTS: readonly string[] = [
  "career", "careers", "vacancy", "vacancies", "job", "jobs",
  "recruitment", "recruiting", "opportunity", "opportunities", "hiring",
  "employment", "रोजगारी", "खाली", "पद",
];

/** Anchor/nav text that means "this link is about hiring". */
const CAREER_LINK_TEXT: readonly string[] = [
  "career", "careers", "vacancy", "vacancies", "job", "jobs", "recruitment",
  "recruit", "hiring", "we are hiring", "open positions", "current openings",
  "employment", "opportunit",
  "रोजगारी", "खाली पद", "भर्ती", "नियुक्ति",
];

/** Text that means "this page reports a finished process, not an opening". */
const RECRUIT_RESULT_TEXT: readonly string[] = [
  "result", "results", "merit list", "merit-list", "shortlist", "shortlisted",
  "selected candidate", "selected candidates", "successful applicant",
  "successful applicants", "interview result", "written exam result",
  "प्रकाशित नतिजा", "नतिजा", "छनोट",
];

/** Common career paths. Weak evidence on their own: they are guesses. */
export const CAREER_PATH_PATTERNS: readonly RegExp[] = [
  /^\/careers?\/?$/i,
  /^\/careers?\/(?:[a-z0-9-]+\/)?$/i,
  /^\/vacanc(?:y|ies)\/?$/i,
  /^\/job(?:s)?\/?$/i,
  /^\/recruit(?:ment|ing)?\/?$/i,
  /^\/career-opportunit(?:y|ies)\/?$/i,
  /^\/(?:np|en)\/careers?\/?$/i,
  /\/career[-_/]/i,
  /\/vacanc(?:y|ies)[-_/]/i,
];

// ---------------------------------------------------------------------------
// Candidate + evidence
// ---------------------------------------------------------------------------

export interface CareerLink {
  href: string;
  /** Visible anchor text, already entity-stripped. */
  text: string;
  /** Where the link sat in the document. */
  role: LinkRole;
  /** Resolved absolute URL, or null when the href is unusable. */
  url: string | null;
}

export type LinkRole = "nav" | "header" | "footer" | "body";

export interface CareerEvidence {
  score: number;
  reasons: string[];
  /** Hard disqualifiers. A non-empty list means "not a career candidate". */
  disqualifiers: string[];
}

/**
 * A career target: a `DiscoveredTarget` plus the score that produced it.
 *
 * Extends the existing discovery record rather than replacing it, so anything
 * consuming `DiscoveredTarget` keeps working unchanged.
 */
export interface CareerDiscoveryTarget extends DiscoveredTarget {
  confidence: number;
  evidence: string[];
}

/** Score at or above which a link is proposed as a career target. */
export const CAREER_DISCOVERY_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// URL facts
// ---------------------------------------------------------------------------

/**
 * True when a URL addresses the site root ("/", "", "/index.html", "/np").
 *
 * This is the single most important check in the module. Twelve of the 29
 * located CAREER_PAGE URLs in pilot-sources.json are bare domain roots, and a root
 * is never a career page — accepting one would report a homepage as a career page
 * with an unknown number of vacancies, which is a fabricated claim wearing a
 * measured label.
 */
export function isRootUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const p = u.pathname.toLowerCase().replace(/\/+$/, "");
    return p === "" || p === "/index.html" || p === "/index.htm" || p === "/index.php" || p === "/default.aspx";
  } catch {
    return false;
  }
}

function hrefHints(href: string): string[] {
  const u = href.toLowerCase();
  return CAREER_HREF_HINTS.filter((h) => u.includes(h));
}

function textHints(text: string): string[] {
  const t = text.toLowerCase();
  return CAREER_LINK_TEXT.filter((h) => t.includes(h));
}

function looksLikeRecruitResult(text: string): boolean {
  const t = text.toLowerCase();
  return RECRUIT_RESULT_TEXT.some((h) => t.includes(h));
}

function pathMatches(text: string): boolean {
  return CAREER_PATH_PATTERNS.some((re) => re.test(text));
}

function isDocumentUrl(href: string): boolean {
  return /\.pdf(?:$|[?#])/i.test(href);
}

// ---------------------------------------------------------------------------
// Link extraction (keeps anchor text and position, which the M1 extractor drops)
// ---------------------------------------------------------------------------

/** Strip tags and collapse whitespace, without executing anything. */
function anchorText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;?/gi, "&")
    .replace(/&#\d+;?/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Which structural region a link sits in, found by scanning backwards for the
 * nearest container tag. Deliberately crude: it only has to separate "listed in
 * the site chrome" from "buried in body copy", and a crude answer that is
 * deterministic beats a precise answer that is not.
 */
function roleAt(html: string, index: number): LinkRole {
  const before = html.slice(Math.max(0, index - 6000), index).toLowerCase();
  const last = (tag: string): number => before.lastIndexOf(`<${tag}`);
  const nav = last("nav");
  const header = last("header");
  const footer = last("footer");
  const best = Math.max(nav, header, footer);
  if (best < 0) return "body";
  if (best === nav) return "nav";
  if (best === header) return "header";
  return "footer";
}

/** Every same-host link with its text and region. Foreign hosts are dropped. */
export function extractCareerLinks(html: string, baseHost: string): CareerLink[] {
  const hostRe = new RegExp(`(^|\\.)${baseHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/gi;
  const out: CareerLink[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    if (raw.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(raw)) continue;
    if (raw.includes("${")) continue; // JS template literal, not a URL
    // Anchor text: from the end of the href attribute to the closing tag.
    const tail = html.slice(m.index, m.index + 600);
    const close = tail.indexOf("</a");
    const gt = tail.indexOf(">");
    let text = "";
    if (gt >= 0) {
      const inner = close >= 0 && close > gt ? tail.slice(gt + 1, close) : "";
      text = anchorText(inner);
    }
    let url: string | null = null;
    try {
      const u = new URL(raw, `https://${baseHost}/`);
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      if (!hostRe.test(u.hostname)) continue; // foreign host → skip
      url = u.href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ href: raw, text, role: roleAt(html, m.index), url });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Combined evidence
// ---------------------------------------------------------------------------

/**
 * Score a link as a career candidate.
 *
 * Weights are chosen so that no single signal can reach the threshold on its
 * own. Href hint alone tops out at 0.35, anchor text alone at 0.3: either can be
 * combined with position or document evidence, but a bare `/career` href in body
 * copy with no supporting text stays below threshold and is not chased.
 */
export function careerLinkEvidence(link: CareerLink): CareerEvidence {
  const reasons: string[] = [];
  const disqualifiers: string[] = [];
  let score = 0;

  if (link.url === null) disqualifiers.push("unresolvable href");
  if (link.url !== null && isRootUrl(link.url)) disqualifiers.push("site root is not a career page");

  const hrefs = hrefHints(link.href);
  if (hrefs.length > 0) {
    score += 0.35;
    reasons.push(`href hint: ${hrefs.join(",")}`);
  }

  const texts = textHints(link.text);
  if (texts.length > 0) {
    score += 0.3;
    reasons.push(`anchor text: ${texts.join(",")}`);
  }

  // A recruitment RESULT page is about a finished process. Following it as a
  // career page would report a published merit list as an open vacancy.
  if (looksLikeRecruitResult(link.text) || looksLikeRecruitResult(link.href)) {
    disqualifiers.push("recruitment result/merit list, not a vacancy page");
  }

  if (pathMatches(link.href)) {
    score += 0.15;
    reasons.push("common career path");
  }

  if (isDocumentUrl(link.href) && texts.length > 0) {
    score += 0.2;
    reasons.push("document link with recruitment vocabulary");
  }

  if (link.role === "nav" || link.role === "header" || link.role === "footer") {
    score += 0.1;
    reasons.push(`listed in site ${link.role}`);
  }

  if (link.text.length === 0 && hrefs.length === 0) {
    disqualifiers.push("no career signal in href or anchor text");
  }

  // Deterministic clamp so the output is stable across runs.
  const bounded = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  return { score: bounded, reasons, disqualifiers };
}

export function isCareerCandidate(link: CareerLink): boolean {
  const ev = careerLinkEvidence(link);
  return ev.disqualifiers.length === 0 && ev.score >= CAREER_DISCOVERY_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface CareerDiscoveryInput {
  /** Source id (the `sources.id` the snapshots will be written under). */
  sourceId: string;
  institutionId: string | null;
  /** Host to stay on, e.g. "nirdhan.com.np". */
  host: string;
  /** Pages already fetched, keyed by the URL they came from. */
  pages: readonly { url: string; html: string }[];
  /** Sitemap XML bodies, if any were fetched. */
  sitemaps?: readonly string[];
  /** robots.txt body, if fetched. */
  robots?: string | null;
  /** Direct URL from capability config, if one is evidence-backed. */
  knownUrl?: string | null;
  observedAt: string;
  /** Hard cap on returned targets. */
  maxTargets?: number;
}

/**
 * Propose career targets from already-fetched material. Performs no network
 * access of its own — sitemaps and robots are passed in.
 */
export function discoverCareerTargets(input: CareerDiscoveryInput): CareerDiscoveryTarget[] {
  const out: CareerDiscoveryTarget[] = [];
  const seen = new Set<string>();
  const push = (t: CareerDiscoveryTarget): void => {
    if (seen.has(t.url)) return;
    if (isRootUrl(t.url)) return;
    seen.add(t.url);
    out.push(t);
  };

  const make = (
    url: string,
    method: DiscoveryMethod,
    parentUrl: string | null,
    confidence: number,
    evidence: string[],
    title: string,
    capability: CapabilityKind = "CAREER_PAGE",
  ): CareerDiscoveryTarget => ({
    capability,
    url,
    method,
    parentUrl,
    sourceId: input.sourceId,
    ...(input.institutionId ? { institutionId: input.institutionId } : {}),
    discoveredAt: input.observedAt,
    title,
    reason: evidence.join("; "),
    status: "CANDIDATE" as EvidenceStatus,
    confidence,
    evidence,
  });

  // 1. A configured, evidence-backed URL wins outright. Still rejected if it is
  //    a root: 12 of the 29 located career URLs are, and they must be re-found
  //    or cleared rather than trusted.
  if (input.knownUrl) {
    const evidence: string[] = [];
    let ok = true;
    try {
      if (isRootUrl(input.knownUrl)) {
        evidence.push("configured known_url is a site root; rejected as a career page");
        ok = false;
      }
    } catch {
      ok = false;
    }
    if (ok) {
      push(make(normalizeDiscoveredUrl(input.knownUrl), "KNOWN", null, 1, ["capability config known_url"], "configured career page"));
    }
  }

  // 2. Links on fetched pages, scored on combined evidence.
  for (const page of input.pages) {
    for (const link of extractCareerLinks(page.html, input.host)) {
      const ev = careerLinkEvidence(link);
      if (ev.disqualifiers.length > 0) continue;
      if (ev.score < CAREER_DISCOVERY_THRESHOLD) continue;
      push(make(link.url as string, "LINK", page.url, ev.score, ev.reasons, link.text || "career page"));
    }
  }

  // 3. Sitemaps. Sitemaps carry <loc> only, so a sitemap entry is scored on its
  //    path alone and therefore rarely clears the threshold on its own. That is
  //    intentional: a sitemap is a carrier, not proof.
  //
  //    A robots.txt sitemap directive is a carrier *location*, not a career page,
  //    so it is deliberately not turned into a target here. The caller fetches it
  //    and passes the body in as one of `sitemaps`.
  for (const xml of input.sitemaps ?? []) {
    for (const loc of parseSitemapLocs(xml)) {
      if (isRootUrl(loc)) continue;
      let u: URL;
      try {
        u = new URL(loc);
      } catch {
        continue;
      }
      if (u.hostname !== input.host && !u.hostname.endsWith(`.${input.host}`)) continue;
      const hrefs = hrefHints(loc);
      if (hrefs.length === 0 && !pathMatches(u.pathname)) continue;
      push(make(loc, "SITEMAP", null, 0.5, [`sitemap entry matching: ${hrefs.join(",") || "career path"}`], "sitemap career entry"));
    }
  }

  // Deterministic order: strongest evidence first, then URL, so two runs over the
  // same input produce byte-identical output.
  out.sort((a, b) => (b.confidence - a.confidence) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const cap = input.maxTargets ?? 50;
  return out.slice(0, cap);
}

/** Exposed for the sitemap carrier decision, and for tests. */
export function isSitemapCarrier(raw: string): boolean {
  return isSitemapUrl(raw);
}

/**
 * What kind of document a link points at, read from its own name.
 *
 * A recruitment result and a vacancy notice are opposite facts, and an
 * application form is neither, so a document's name has to be classified before
 * a page that links it can be called empty. The live pilot forced this: one
 * source published its openings only as files named `vacancy-*.PDF` and as
 * `/images/gallery/vacancy-*.jpg`, with no vacancy anywhere in its HTML, while
 * others linked `slbsl_finalresultlist.pdf` — a closed round. Both were being
 * recorded as pages with no current vacancy, which is a claim about the present
 * that only one of them supports.
 *
 * This reads filenames and paths only. It never opens a document.
 */
export type DocumentRole = "VACANCY" | "RESULT" | "FORM" | "ROUTINE";
/**
 * Terms are plain string literals checked with `includes`, not a regex alternation.
 *
 * Two real pilot links disagree with the regex version of this rule on paths that
 * differ only by an unrelated directory segment, and a shorter, obviously-correct
 * formulation is worth more here than a clever one. The Devanagari terms are written
 * with `\u` escapes so the source stays ASCII: rikt = empty, pad = post, asar =
 * opportunity, suchidarta = selected, nitala = result, faram = form, avedan = apply.
 */
export const DOC_RESULT_TERMS: readonly string[] = [
  "shortlist",
  "short list",
  "short_list",
  "short-list",
  "result",
  "suchidarta",
  "merit",
  "selected",
  "final list",
  "\u0935\u093f\u091c\u092f",
  "\u091b\u0928\u094b\u091f",
  "\u0928\u0924\u093e\u0932\u093e",
];

export const DOC_VACANCY_TERMS: readonly string[] = [
  "vacanc",
  "recruit",
  "career",
  "job",
  "job post",
  "job-post",
  "\u0930\u093f\u0915\u094d\u0924",
  "\u092a\u0926",
  "\u0905\u0935\u0938\u0930",
];

export const DOC_FORM_TERMS: readonly string[] = [
  "form",
  "\u092b\u093e\u0930\u092e",
  "\u0906\u0935\u0947\u0926\u0928",
];

/**
 * Classify a document link by what its own name declares.
 *
 * A recruitment result and a vacancy notice are opposite facts, and an application
 * form is neither, so a document's name has to be classified before a page that
 * links it can be called empty. The live pilot forced this: one source published its
 * openings only as files named `vacancy-*.PDF` and as `/images/gallery/vacancy-*.jpg`
 * with no vacancy anywhere in its HTML, while others linked
 * `slbsl_finalresultlist.pdf` — a closed round. Both were being recorded as pages
 * with no current vacancy, which is a claim about the present that only one of them
 * supports.
 *
 * The query and fragment are dropped, and a percent-encoded name is decoded so that
 * `Short%20List` is recognised as a shortlist. This reads names only; it never opens
 * a document. A name that cannot be decoded is matched as-is rather than guessed at.
 *
 * The whole PATH is read, not just the last segment, because a real cooperative
 * publishes its vacancy notice as `/public/storage/careers/August2026/erlQ7KqXU9
 * HhYc4jN9ug.pdf` — a directory that says careers and a filename that says nothing.
 * A result or form is still checked first, so `/career/2082-83/Short List of
 * Internal Vacancy.pdf` remains a result rather than becoming a vacancy.
 */
export function classifyDocumentLink(raw: string): DocumentRole {
  const withoutFragment = raw.split("#")[0] ?? raw;
  const withoutQuery = withoutFragment.split("?")[0] ?? withoutFragment;
  const name = tryDecode(withoutQuery).toLowerCase();
  if (DOC_RESULT_TERMS.some((t) => name.includes(t))) return "RESULT";
  const isVacancy = DOC_VACANCY_TERMS.some((t) => name.includes(t));
  const isForm = DOC_FORM_TERMS.some((t) => name.includes(t));
  if (isVacancy) return isForm ? "FORM" : "VACANCY";
  if (isForm) return "FORM";
  return "ROUTINE";
}

function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
