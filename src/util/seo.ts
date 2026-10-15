// ============================================================================
// P15 - SEO / information graph (pure).
//
// One place owns the deployment base URL, the set of indexable routes, and the
// structured-data shape, so `app/sitemap.ts`, `app/robots.ts`, `app/layout.tsx`
// and every institution page cannot drift from each other. No I/O, no
// randomness: a smoke can call all of it without a socket or a build.
//
// Indexability rule: the sitemap lists only routes whose content is a stable
// read of the directory. `/search` is excluded because results depend on the
// query (it is also `robots: { index: false }`). Superseded institution slugs
// are excluded: they redirect to the canonical slug, which is already listed.
// ============================================================================

import { directorySource, institutions, nrbDocuments, nrbRegulatoryEvents } from "@/lib/site-data";

/**
 * The deployed origin + base path. Next sets `basePath: "/laghubitta-khabar"`
 * and `trailingSlash: true`, so every canonical URL below ends in "/".
 * `app/layout.tsx` reads this for `metadataBase`, so the value lives here once.
 */
export const SITE_BASE_URL = "https://laghubitta.sennaplatform.com/laghubitta-khabar";

export type ChangeFrequency = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export interface SitemapEntry {
  url: string;
  lastModified: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}

/** Absolute, trailing-slash canonical URL for a route path ("" or "/" = home). */
export function absoluteUrl(path: string): string {
  if (path === "" || path === "/") return `${SITE_BASE_URL}/`;
  const clean = path.startsWith("/") ? path.slice(1) : path;
  const trimmed = clean.endsWith("/") ? clean.slice(0, -1) : clean;
  return `${SITE_BASE_URL}/${trimmed}/`;
}

interface StaticPage {
  path: string;
  priority: number;
  changeFrequency: ChangeFrequency;
}

/** Human-indexable static pages, most important first. No `/search` (query-dependent). */
export const STATIC_PAGES: StaticPage[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/institutions", priority: 0.9, changeFrequency: "weekly" },
  { path: "/interest-rates", priority: 0.7, changeFrequency: "weekly" },
  { path: "/documents", priority: 0.7, changeFrequency: "weekly" },
  { path: "/jobs", priority: 0.7, changeFrequency: "weekly" },
  { path: "/news", priority: 0.7, changeFrequency: "weekly" },
  { path: "/nrb", priority: 0.7, changeFrequency: "weekly" },
  { path: "/people", priority: 0.7, changeFrequency: "weekly" },
  { path: "/compare", priority: 0.6, changeFrequency: "monthly" },
  { path: "/research", priority: 0.6, changeFrequency: "monthly" },
  { path: "/reports", priority: 0.6, changeFrequency: "monthly" },
  { path: "/alerts", priority: 0.5, changeFrequency: "weekly" },
  { path: "/ingestion", priority: 0.4, changeFrequency: "monthly" },
];

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Every indexable URL, in a deterministic order: static pages, then institutions,
 * then regulatory records / documents (as `/news/{id}`), then people. `asOf` from
 * the directory is used as `lastModified` everywhere: it is the vintage of the
 * data every page renders, and it is a real date, not a build timestamp.
 */
export function buildSitemapEntries(personSlugs: string[] = []): SitemapEntry[] {
  const lastModified = directorySource.asOf;
  const entries: SitemapEntry[] = [];

  for (const page of STATIC_PAGES) {
    entries.push({
      url: absoluteUrl(page.path),
      lastModified,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    });
  }

  for (const inst of institutions) {
    entries.push({
      url: absoluteUrl(`/institutions/${inst.slug}`),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    });
  }

  for (const event of [...nrbRegulatoryEvents].sort(byId)) {
    entries.push({
      url: absoluteUrl(`/news/${event.id}`),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    });
  }
  for (const doc of [...nrbDocuments].sort(byId)) {
    entries.push({
      url: absoluteUrl(`/news/${doc.id}`),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    });
  }

  for (const slug of [...new Set(personSlugs)].sort()) {
    entries.push({
      url: absoluteUrl(`/people/${slug}`),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    });
  }

  return entries;
}

export interface RobotsRules {
  rules: { userAgent: string; allow: string };
  sitemap: string;
}

/**
 * The intent, as data. `app/robots.ts` renders this to `robots.txt`, which Next
 * emits at `<basePath>/robots.txt`. Note for ops: a crawler reads `/robots.txt`
 * at the domain root, which is outside this app's basePath; the file is still the
 * source of truth to copy to the root when the host is configured.
 */
export function buildRobots(): RobotsRules {
  return {
    rules: { userAgent: "*", allow: "/" },
    // A file, not a route: no trailing slash (absoluteUrl is for page routes).
    sitemap: `${SITE_BASE_URL}/sitemap.xml`,
  };
}

export interface InstitutionJsonLdInput {
  name: string;
  slug: string;
  websiteUrl?: string | null;
  websiteVerified?: boolean;
  headOffice?: string | null;
}

/**
 * Minimal, honest Organization node. It asserts only what the directory holds:
 * the name, the canonical profile URL, the slug as identifier, and the head
 * office when present. `sameAs` (the official website) is included ONLY when the
 * website is verified - a candidate/unverified URL is a guess and linking a
 * search engine to a guess is exactly the kind of claim this directory avoids.
 */
export function institutionJsonLd(input: InstitutionJsonLdInput): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    url: absoluteUrl(`/institutions/${input.slug}`),
    identifier: input.slug,
  };
  if (input.websiteVerified && input.websiteUrl) node.sameAs = input.websiteUrl;
  if (input.headOffice) node.address = input.headOffice;
  return node;
}
