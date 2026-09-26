// ============================================================================
// BrowserDiscovery (Phase F) — traceable, bounded target discovery.
// Never a whole-site crawl. Produces DiscoveredTarget[] where every URL carries
// method + parent + source + institution + timestamp provenance. Discovers from:
//   - KNOWN     configured capability URLs (capability.knownUrl)
//   - CONFIG    configured root paths under an allowed host
//   - ROBOTS    sitemap directive in robots.txt
//   - SITEMAP   <loc> entries in a sitemap
//   - LINK      same-host hyperlinks on a fetched page (per capability)
//   - REL       rel="canonical" link tag on a fetched page
// Trust is explicit: no foreign-host links are auto-added; nothing is followed
// beyond `maxTargets`; result of a single source+institution at a single time.
// ============================================================================

import type {
  FetchOptions,
  Fetcher,
  SourceRegistry,
} from "./contract";
import type {
  CapabilityKind,
  CapabilitySpec,
  DiscoveredTarget,
  DiscoveryMethod,
  IngestionSourceSpec,
} from "./types";

export interface DiscoveryRule {
  capability: CapabilityKind;
  /** Path prefix under the source host (e.g. "/reports"). Empty = root scope. */
  pathPrefix?: string;
  /** Match links whose href contains any of these path fragments. */
  hrefHint?: string;
  /** Follow robots.txt + sitemap for this capability. */
  prefersSitemap?: boolean;
}

export interface DiscoveryConfig {
  rules: DiscoveryRule[];
  /** Hard per-run cap. */
  maxTargets?: number;
  /** Only these capability kinds (default = the source's declared ones). */
  only?: ReadonlyArray<string>;
}

const MAX_TARGETS_DEFAULT = 50;

/**
 * Standard href-hint rule set used by both the live pilot BrowserDiscovery and
 * the Phase F backfill (single source of truth; ordering defines priority).
 */
export const DISCOVERY_HINT_RULES: DiscoveryRule[] = [
  { capability: "NEWS", hrefHint: "notice" },
  { capability: "NEWS", hrefHint: "news" },
  { capability: "REPORTS", hrefHint: "report" },
  { capability: "REPORTS", hrefHint: "annual" },
  { capability: "DOCUMENT_ARCHIVE", hrefHint: "document" },
  { capability: "DOCUMENT_ARCHIVE", hrefHint: "download" },
  { capability: "CAREER_PAGE", hrefHint: "career" },
  { capability: "CAREER_PAGE", hrefHint: "vacancy" },
  { capability: "BRANCH_DIRECTORY", hrefHint: "branch" },
  { capability: "BRANCH_DIRECTORY", hrefHint: "contact" },
  { capability: "WEBSITE", hrefHint: "" },
  { capability: "SITEMAP", prefersSitemap: true },
];

/**
 * Deterministic classification of a discovered URL into a specific (non
 * catch-all) capability. Used by the Phase F backfill to persist located
 * capability pages; skips the WEBSITE catch-all. Sitemap files are discovery
 * CARRIERS (never pages to extract), so sitemap detection outranks href hints:
 * a WordPress wp-sitemap-posts-branch-1.xml must classify SITEMAP, not BRANCH.
 */
export function isSitemapUrl(raw: string): boolean {
  const u = raw.toLowerCase();
  return u.includes("sitemap") || /\.xml$/.test(u);
}

export function locateCapabilityForUrl(raw: string): CapabilityKind | null {
  const u = raw.toLowerCase();
  if (isSitemapUrl(raw)) return "SITEMAP";
  for (const rule of DISCOVERY_HINT_RULES) {
    const hint = rule.hrefHint;
    if (!hint || hint === "") continue;
    if (u.includes(hint.toLowerCase())) return rule.capability;
  }
  return null;
}

/**
 * Asset URLs that are never link-discovery targets: styles, scripts, images,
 * fonts, media. Generic (not per-site): keeps bounded discovery from burning
 * budget on static assets during LINK/CONFIG/SITEMAP walks. PDF is NOT here —
 * documents are legitimate REPORT/DOCUMENT_ARCHIVE targets.
 */
const IGNORED_ASSET_RE =
  /\.(css|js|mjs|cjs|map|png|jpe?g|gif|svg|webp|ico|avif|woff2?|ttf|eot|otf|mp4|webm|mp3|zip|tar|gz)$/i;

function isIgnoredAsset(url: string): boolean {
  try {
    const u = new URL(url);
    return IGNORED_ASSET_RE.test(u.pathname);
  } catch {
    return false;
  }
}

/** Extract same-host absolute URLs from an <a href> / <link rel> document. */
export function extractSameHostLinks(html: string, baseHost: string): string[] {
  const hostRe = new RegExp(`(^|\\.)${escapeRegExp(baseHost)}$`, "i");
  const hrefRe = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;
    if (raw.includes("${")) continue; // JS template literal — not a URL
    try {
      const u = new URL(raw, `https://${baseHost}/`);
      if (!(u.protocol === "https:" || u.protocol === "http:")) continue;
      if (!hostRe.test(u.hostname)) continue; // foreign host → skip
      if (isIgnoredAsset(u.href)) continue; // css/js/img/font/media → skip
      u.hash = "";
      out.add(u.href.replace(/\/$/, "") || u.href);
    } catch {
      /* malformed href — skip */
    }
  }
  return [...out];
}

/** Parse <loc> entries out of a sitemap (xml or sitemap:index). */
export function parseSitemapLocs(xml: string): string[] {
  const locRe = /<loc[^>]*>([\s\S]*?)<\/loc>/gi;
  const urls = [];
  let m: RegExpExecArray | null;
  while ((m = locRe.exec(xml)) !== null) {
    const raw = m[1].replace(/[\s\n]+/g, "").trim();
    if (raw && /^https?:\/\//i.test(raw)) urls.push(raw);
  }
  return urls;
}

/** Parse sitemap directive out of robots.txt. */
export function parseRobotsSitemap(text: string): string[] {
  const sitemapRe = /^sitemap:\s*(https?:\/\/\S+)/gim;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = sitemapRe.exec(text)) !== null) out.push(m[1]);
  return out;
}

export class BrowserDiscovery {
  private readonly registry: SourceRegistry;
  private readonly fetcher: Fetcher;
  private readonly config: DiscoveryConfig;

  constructor(registry: SourceRegistry, fetcher: Fetcher, config: DiscoveryConfig) {
    this.registry = registry;
    this.fetcher = fetcher;
    this.config = config;
  }

  async discover(
    source: IngestionSourceSpec,
  ): Promise<DiscoveredTarget[]> {
    const now = new Date().toISOString();
    const host = hostOf(source.url);
    if (!host) return [];
    const max = this.config.maxTargets ?? MAX_TARGETS_DEFAULT;
    const targets: DiscoveredTarget[] = [];

    // Capability set to consider: config.only, else the declared ones.
    // Zero declared capabilities ⇒ zero discovery targets (deterministic).
    const capabilities = this.config.only
      ? source.capabilities.filter((c) => this.config.only!.includes(c.kind))
      : source.capabilities;
    const declared = (kind: CapabilityKind): boolean => capabilities.some((c) => c.kind === kind);

    // --- KNOWN: configured capability URLs ---
    for (const cap of capabilities) {
      if (cap.knownUrl) {
        targets.push({
          capability: cap.kind,
          // A KNOWN capability URL is an evidence-backed official page; its
          // query string is part of that page (e.g. NRB's `?department=mfd`
          // filter), so it is preserved — never stripped like walk/sitemap hrefs.
          url: normalizeKeepSearch(cap.knownUrl),
          method: "KNOWN",
          parentUrl: source.url,
          sourceId: source.id,
          institutionId: source.institutionId,
          discoveredAt: now,
          status: cap.status,
        });
      }
    }
    if (targets.length >= max) return targets.slice(0, max);

    // --- CONFIG: rule pathPrefix roots ---
    for (const rule of this.config.rules) {
      if (rule.pathPrefix === undefined || rule.pathPrefix === "") continue;
      if (!declared(rule.capability)) continue; // capability must be declared
      const url = new URL(rule.pathPrefix, `https://${host}/`).href;
      targets.push({
        capability: rule.capability,
        url: normalize(url),
        method: "CONFIG",
        parentUrl: source.url,
        sourceId: source.id,
        institutionId: source.institutionId,
        discoveredAt: now,
        status: "CANDIDATE",
      });
    }
    if (targets.length >= max) return targets.slice(0, max);

    // --- ROBOTS / SITEMAP: follow only when rules opt in ---
    const wantsSitemap = this.config.rules.some((r) => r.prefersSitemap);
    if (wantsSitemap) {
      const robotsText = await this.fetchText(`https://${host}/robots.txt`, { timeoutMs: 8000 });
      if (robotsText) {
        const sitemaps = parseRobotsSitemap(robotsText);
        for (const sm of sitemaps) await this.addSitemapTargets(sm, source, targets, now, max, host, capabilities);
      }
    }
    if (targets.length >= max) return targets.slice(0, max);

    // --- LINK: only same-host page URLs, per rule hrefHint ---
    const page = await this.fetchText(source.url, { expectHtml: true, timeoutMs: 10000 });
    if (page) {
      for (const raw of extractSameHostLinks(page, host)) {
        const rule = this.matchRule(raw, capabilities);
        if (!rule) continue;
        // A sitemap link is a discovery CARRIER, not a page to extract: resolve
        // its <loc> pages here (recursively) so the pipeline never fetches the
        // xml itself (engine deref stays as a safety net for KNOWN/CONFIG).
        if (rule.capability === "SITEMAP") {
          await this.addSitemapTargets(raw, source, targets, now, max, host, capabilities);
        } else {
          targets.push({
            capability: rule.capability,
            url: normalize(raw),
            method: "LINK",
            parentUrl: source.url,
            sourceId: source.id,
            institutionId: source.institutionId,
            discoveredAt: now,
            status: "CANDIDATE",
          });
        }
        if (targets.length >= max) return targets.slice(0, max);
      }
    }

    // --- REL canonical: single authoritative URL for the source root ---
    if (page && declared("WEBSITE")) {
      const canonical = pickCanonical(page, host);
      if (canonical && canonical !== source.url) {
        targets.push({
          capability: "WEBSITE",
          url: normalize(canonical),
          method: "REL_CANONICAL",
          parentUrl: source.url,
          sourceId: source.id,
          institutionId: source.institutionId,
          discoveredAt: now,
          status: "CANDIDATE",
        });
      }
    }

    return targets.slice(0, max);
  }

  private matchRule(raw: string, caps: CapabilitySpec[]): DiscoveryRule | null {
    const u = raw.toLowerCase();
    // Sitemap files are discovery carriers: classify them SITEMAP when the
    // capability is declared (engine then derefs their <loc> pages); when not
    // declared, fall through to href hints so coverage is still preserved.
    if (isSitemapUrl(raw) && caps.some((c) => c.kind === "SITEMAP")) {
      const sm = this.config.rules.find((r) => r.capability === "SITEMAP");
      if (sm) return sm;
    }
    for (const rule of this.config.rules) {
      if (!caps.some((c) => c.kind === rule.capability)) continue;
      const hint = rule.hrefHint;
      if (hint && u.includes(hint.toLowerCase())) return rule;
      const prefix = rule.pathPrefix?.toLowerCase();
      if (prefix && u.includes(prefix)) return rule;
    }
    return null;
  }

  private async addSitemapTargets(
    sitemapUrl: string,
    source: IngestionSourceSpec,
    targets: DiscoveredTarget[],
    now: string,
    max: number,
    host: string,
    caps: CapabilitySpec[],
    depth = 0,
  ): Promise<void> {
    if (depth > 2) return; // index → sub → posts; never deeper
    const sm = await this.fetchText(sitemapUrl, { timeoutMs: 10000 });
    if (!sm) return;
    for (const loc of parseSitemapLocs(sm)) {
      if (targets.length >= max) return;
      try {
        const u = new URL(loc);
        if (u.hostname.toLowerCase() !== host) continue; // foreign sitemap → skip
      } catch {
        continue;
      }
      // Nested sitemap (WordPress wp-sitemap index/roll-up): dereference it in
      // discovery so the real pages — not the xml file — become targets.
      if (isSitemapUrl(loc)) {
        if (!caps.some((c) => c.kind === "SITEMAP")) continue; // gated
        await this.addSitemapTargets(loc, source, targets, now, max, host, caps, depth + 1);
        continue;
      }
      const rule = (this.matchRule(loc, caps) ?? this.config.rules[0]) ?? undefined;
      if (!rule || !caps.some((c) => c.kind === rule.capability)) continue; // gated on declared capability
      targets.push({
        capability: rule.capability,
        url: normalize(loc),
        method: "SITEMAP",
        parentUrl: sitemapUrl,
        sourceId: source.id,
        institutionId: source.institutionId,
        discoveredAt: now,
        status: "CANDIDATE",
      });
    }
  }

  private async fetchText(url: string, opts?: FetchOptions): Promise<string | null> {
    try {
      const r = await this.fetcher.fetch(url, opts);
      if (!r.httpStatus || r.httpStatus >= 400 || r.bodyBytes === 0) return null;
      if (!r.contentType || !/text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml/i.test(r.contentType)) {
        return null;
      }
      if (r.bodyBytes > 4 * 1024 * 1024) return null; // discovery only reads small pages
      return new TextDecoder().decode(r.body);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalize(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  return u.href.replace(/\/$/, "");
}

/**
 * Like `normalize` but PRESERVES the query string. Used for KNOWN capability
 * URLs where the search params are part of the evidence-backed official page
 * (e.g. NRB `?department=mfd`). Fragment is still dropped; the trailing slash
 * is still normalized.
 */
function normalizeKeepSearch(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.href.replace(/\/$/, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickCanonical(html: string, baseHost: string): string | null {
  const m = /<link[^>]+rel\s*=\s*["']canonical["'][^>]*>/i.exec(html) ?? /<link[^>]+rel\s*=\s*["']canonical["']/i.exec(html);
  if (!m) return null;
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[0]);
  if (!href) return null;
  try {
    const u = new URL(href[1], `https://${baseHost}/`);
    return u.href;
  } catch {
    return null;
  }
}