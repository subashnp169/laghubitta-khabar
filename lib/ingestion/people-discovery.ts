// ============================================================================
// Generic People/leadership page DISCOVERY (M3.3-GENERIC-EXT-B).
//
// Purpose: let the existing capability-driven discovery find *likely* people
// pages on institutions that have no configured knownUrl, so that
// `PEOPLE = NOT_DISCOVERED` can become a real candidate instead of a permanent
// gap. Everything here is generic: no institution id, no institution URL, no
// institution-specific selector, no vendor class name.
//
// Safety posture (the milestone's hard rule — false People is worse than
// missing People):
//   - A candidate must earn its place with an UNAMBIGUOUS leadership phrase in
//     its anchor text or its URL path ("board of directors", "leadership", ...).
//   - Weaker leadership words ("team", "staff", "people") are accepted only when
//     the surrounding section also carries leadership context.
//   - Generic company words ("about us", "company profile", "organization",
//     "who we are") are NEVER sufficient on their own — not even with context.
//   - Navigation, footer and role="navigation" regions are removed before any
//     link is considered, so a menu can never manufacture a candidate.
//   - Same-host only: an external people-looking URL is dropped by the same
//     host rule the rest of discovery uses, so the fetcher's allow-list is the
//     only thing that can widen scope (it is never widened here).
//
// Scoring is deterministic: same input ⇒ same score, tier, signals and reason.
// No randomness, no thresholds learned from data, no per-site tuning.
// ============================================================================

import { normalizeDiscoveredUrl } from "./discovery";
import { stripNavigation } from "./people";

/** Unambiguous leadership phrases: enough on their own to accept a candidate. */
const LEADERSHIP_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ["board of director", "board-of-directors"],
  ["board of member", "board-of-directors"],
  ["board member", "board-of-directors"],
  ["our board", "board-of-directors"],
  ["board", "board-of-directors"],
  ["governance", "governance"],
  ["director", "director"],
  ["chairman", "chair"],
  ["chairperson", "chair"],
  ["vice chairman", "chair"],
  ["vice chairperson", "chair"],
  ["chair", "chair"],
  ["leadership", "leadership"],
  ["management team", "management-team"],
  ["senior management", "management-team"],
  ["executive team", "management-team"],
  ["management", "management-team"],
  ["our team", "our-team"],
];

/** Leadership *context* words: strengthen a weak signal, never create one. */
const LEADERSHIP_CONTEXT: ReadonlyArray<string> = [
  "chairman",
  "chairperson",
  "vice chairman",
  "chair",
  "ceo",
  "chief executive",
  "md",
  "director",
  "board",
  "management",
  "leadership",
  "president",
  "executive",
  "member",
];

/** Weak leadership nouns: need leadership context, on their own they are noise. */
const WEAK_LEADERSHIP_TERMS: ReadonlyArray<string> = [
  "our team",
  "team",
  "staff",
  "our people",
  "people",
  "person",
  "key people",
  "profile",
];

/**
 * Generic company words. A candidate whose ONLY evidence is one of these is
 * rejected: an "About Us" or "Company Profile" page is a company page, not a
 * people page, and treating it as one is exactly the over-expansion the
 * milestone forbids.
 */
const WEAK_GENERIC_TERMS: ReadonlyArray<string> = [
  "about us",
  "about",
  "company profile",
  "organization",
  "organisation",
  "who we are",
  "our story",
  "introduction",
  "company",
  "contact",
  "branch",
  "career",
  "notice",
  "news",
  "report",
  "history",
  "mission",
  "vision",
  "service",
  "product",
  "gallery",
  "faq",
];

export interface PeopleLinkInput {
  /** Visible anchor text (plus title/aria-label/image alt when present). */
  anchorText: string;
  /** Path of the link target, e.g. "/board-of-directors". */
  path: string;
  /** Nearest preceding heading/section text on the page, may be "". */
  sectionHeading: string;
}

export interface PeopleLinkScore {
  /** True only when the candidate clears the leadership-context bar. */
  accepted: boolean;
  /** Deterministic 0..100 score; higher is a stronger leadership signal. */
  score: number;
  /** "leadership-phrase" | "weak-term-with-context" | "rejected". */
  tier: "leadership-phrase" | "weak-term-with-context" | "rejected";
  /** Every term that fired, in vocabulary order. */
  signals: string[];
  /** Human-readable, auditable explanation of the accept/reject decision. */
  reason: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Does `hay` contain `needle` as a whole-word-ish phrase? */
function hasPhrase(hay: string, needle: string): boolean {
  const n = norm(needle);
  if (!n) return false;
  const idx = hay.indexOf(n);
  if (idx < 0) return false;
  const before = idx === 0 ? " " : hay[idx - 1];
  const afterIdx = idx + n.length;
  const after = afterIdx >= hay.length ? " " : hay[afterIdx];
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

export function scorePeopleLink(input: PeopleLinkInput): PeopleLinkScore {
  const anchor = norm(input.anchorText);
  const path = norm(input.path);
  const heading = norm(input.sectionHeading);
  const signals: string[] = [];

  // 1. Unambiguous leadership phrase in the anchor text or the URL path.
  for (const [phrase, signal] of LEADERSHIP_PHRASES) {
    if (hasPhrase(anchor, phrase) || hasPhrase(path, phrase)) {
      signals.push(signal);
      const where = hasPhrase(anchor, phrase) && hasPhrase(path, phrase) ? "anchor+path" : hasPhrase(anchor, phrase) ? "anchor" : "path";
      return {
        accepted: true,
        score: where === "anchor+path" ? 100 : 90,
        tier: "leadership-phrase",
        signals,
        reason: `explicit leadership phrase "${phrase}" in ${where}`,
      };
    }
  }

  // 2. Weak leadership noun + leadership context in the anchor or section.
  const weakHit = WEAK_LEADERSHIP_TERMS.find((t) => hasPhrase(anchor, t) || hasPhrase(path, t));
  if (weakHit) {
    const ctx = LEADERSHIP_CONTEXT.find((c) => hasPhrase(anchor, c) || hasPhrase(heading, c));
    if (ctx) {
      signals.push(weakHit, `context:${ctx}`);
      return {
        accepted: true,
        score: 60,
        tier: "weak-term-with-context",
        signals,
        reason: `leadership term "${weakHit}" with leadership context "${ctx}" nearby`,
      };
    }
    signals.push(weakHit);
    return {
      accepted: false,
      score: 20,
      tier: "rejected",
      signals,
      reason: `leadership term "${weakHit}" without any leadership context — not enough to call this a people page`,
    };
  }

  // 3. Generic company words are never sufficient.
  const generic = WEAK_GENERIC_TERMS.find((t) => hasPhrase(anchor, t) || hasPhrase(path, t));
  if (generic) {
    signals.push(`generic:${generic}`);
    return {
      accepted: false,
      score: 5,
      tier: "rejected",
      signals,
      reason: `generic company term "${generic}" is never sufficient for a people page`,
    };
  }

  return {
    accepted: false,
    score: 0,
    tier: "rejected",
    signals,
    reason: "no leadership signal in anchor text, URL path or section heading",
  };
}

export interface PeopleCandidate {
  /** Normalized, same-host URL (hash/query stripped, no trailing slash). */
  url: string;
  anchorText: string;
  sectionHeading: string;
  score: PeopleLinkScore;
}

/** Per-source cap: a bounded work queue, never a site crawl. */
export const MAX_PEOPLE_CANDIDATES = 3;

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract scored people candidates from an already-fetched page.
 *
 * The caller has already paid for this page (discovery fetches the source root
 * once for its LINK pass), so this costs no extra fetch and no extra budget.
 */
export function extractPeopleCandidates(
  html: string,
  baseUrl: string,
  maxCandidates = MAX_PEOPLE_CANDIDATES,
): PeopleCandidate[] {
  const base = new URL(baseUrl);
  const hostRe = new RegExp(`(^|\\.)${base.hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

  // Same navigation/footer boundary the extractor uses (M3.3-GENERIC-EXT-A):
  // a menu or footer region can never produce a candidate.
  const scoped = stripNavigation(html);

  // Headings with positions, so each anchor knows its nearest section heading.
  const headings: Array<{ start: number; text: string }> = [];
  const hRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = hRe.exec(scoped)) !== null) headings.push({ start: m.index, text: textOf(m[2]) });
  headings.sort((a, b) => a.start - b.start);
  const headingBefore = (pos: number): string => {
    let out = "";
    for (const h of headings) {
      if (h.start >= pos) break;
      out = h.text;
    }
    return out;
  };

  const byUrl = new Map<string, PeopleCandidate>();
  const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  while ((m = aRe.exec(scoped)) !== null) {
    const attrs = m[1] ?? "";
    const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!hrefMatch) continue;
    const raw = hrefMatch[1].trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;
    let u: URL;
    try {
      u = new URL(raw, base);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    if (!hostRe.test(u.hostname)) continue; // foreign host → never a candidate
    if (/\.(css|js|mjs|cjs|map|png|jpe?g|gif|svg|webp|ico|avif|woff2?|ttf|eot|otf|mp4|webm|mp3|zip|tar|gz)$/i.test(u.pathname)) continue;

    const url = normalizeDiscoveredUrl(u.href);
    const titleAttr = /(?:title|aria-label)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
    const altAttr = /alt\s*=\s*["']([^"']+)["']/i.exec(m[2])?.[1] ?? "";
    const anchorText = textOf(`${m[2]} ${titleAttr} ${altAttr}`);
    const score = scorePeopleLink({ anchorText, path: u.pathname, sectionHeading: headingBefore(m.index) });
    if (!score.accepted) continue;

    const existing = byUrl.get(url);
    if (existing) {
      // Deterministic: keep the strongest signal seen for the same URL.
      if (score.score > existing.score.score) byUrl.set(url, { url, anchorText, sectionHeading: headingBefore(m.index), score });
      continue;
    }
    byUrl.set(url, { url, anchorText, sectionHeading: headingBefore(m.index), score });
  }

  return [...byUrl.values()]
    .sort((a, b) => (b.score.score - a.score.score) || a.url.localeCompare(b.url))
    .slice(0, maxCandidates);
}
