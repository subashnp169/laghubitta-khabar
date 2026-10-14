// ============================================================================
// Search index builder (P4-2).
//
// The static site has no request-time endpoint, so the /search page compiles an
// index and filters it in the browser. Building it here — not inside the page —
// keeps the mapping testable and keeps the client component free of any data
// import: the page passes the built entries down.
//
// Coverage is deliberately wider than institutions/people/documents: branches
// carry the geography a reader actually searches by, and the compare metrics are
// indexed so a reader can find "paid-up capital" or "NRB docs matched" and land
// on the comparison. Every entry links to the page that holds its sources; none
// fabricates a value that page does not already show.
// ============================================================================
import { institutions, nrbRegulatoryEvents, jobs } from "@/lib/site-data";
import { allPublishedPeople } from "../../lib/repository/static-people";
import { allPublishedFinancials } from "../../lib/repository/static-financials";
import { allPublishedBranches } from "../../lib/repository/static-branches";
import { COMPARABILITY, COMPARE_METRICS } from "../../lib/compare";
import { distinctNrbDocuments } from "@/util/activity";
import { displayHost, formatDate, humanize, NOT_AVAILABLE } from "@/util/format";
import type { IndexEntry, IndexKind } from "@/util/search-kinds";

/**
 * People and branches carry an institution slug, not a name. Resolving slugs
 * once here keeps the index honest — a reader searching an institution name
 * should see that name on the row, and a slug would read as initials.
 */
const nameByInstitutionSlug = new Map(institutions.map((i) => [i.slug, i.name]));

/**
 * A branch slug is `<institution-slug>-<branch>` (see projection.branchSlug), so
 * the institution is the longest known slug that prefixes it. Longest first so
 * a slug that is itself a prefix of another (e.g. "abc" vs "abc-finance") never
 * claims the wrong institution.
 */
const institutionsBySlugLength = [...institutions].sort((a, b) => b.slug.length - a.slug.length);
function institutionForBranchSlug(branchSlug: string) {
  return (
    institutionsBySlugLength.find(
      (inst) => branchSlug === inst.slug || branchSlug.startsWith(`${inst.slug}-`),
    ) ?? null
  );
}

/** Builds the full search index. Deterministic for a given dataset. */
export function buildSearchEntries(): IndexEntry[] {
  return [
    ...institutions.map((inst) => ({
      id: inst.id,
      kind: "institution" as const,
      label: inst.name,
      meta: [inst.workingArea, inst.headOffice].join(" · "),
      href: `/institutions/${inst.slug}`,
      // Aliases and the raw source name are searchable but never displayed, so a
      // reader typing "MITHILA" finds the record without the row looking cluttered.
      keywords: [...inst.aliases, inst.sourceNameRaw].join(" "),
    })),
    ...allPublishedBranches().flatMap((branch) => {
      const inst = institutionForBranchSlug(branch.slug);
      // A branch whose institution is not in the directory has no page to link
      // to, so it is not indexed rather than shown as a dead row.
      if (!inst) return [];
      const place = [branch.district, branch.municipality].filter(Boolean).join(", ");
      return [
        {
          id: branch.id,
          kind: "branch" as const,
          label: branch.name,
          meta: [inst.name, place].filter(Boolean).join(" · "),
          href: `/institutions/${inst.slug}#branches`,
          keywords: `${branch.district} ${branch.municipality} ${branch.address ?? ""} ${inst.name}`,
        },
      ];
    }),
    ...allPublishedPeople().map((person) => {
      const position = person.positions.find((p) => p.is_current) ?? person.positions[0];
      const title = position ? humanize(position.title) : null;
      return {
        id: person.id,
        kind: "person" as const,
        label: person.name,
        meta: `${title ?? NOT_AVAILABLE} · ${
          nameByInstitutionSlug.get(person.institution_slug) ?? person.institution_slug
        }`,
        href: `/people/${person.slug}`,
        keywords: person.institution_slug.replace(/-/g, " "),
      };
    }),
    ...jobs.map((job) => ({
      id: job.id,
      kind: "job" as const,
      label: job.title,
      meta: `${job.institution} · ${job.kind === "POSTING" ? "parsed posting" : "unread notice"}`,
      href: null,
      keywords: `${humanize(job.location) ?? ""} ${displayHost(job.sourceDocument) ?? ""}`,
    })),
    // Compare metrics: one entry per metric, so a reader can search by what a
    // column measures ("paid-up capital", "branches") and reach the comparison.
    ...COMPARE_METRICS.map((metric) => ({
      id: `metric-${metric.key}`,
      kind: "metric" as const,
      label: metric.label,
      meta: `Compare · ${COMPARABILITY[metric.comparability].label}`,
      href: "/compare",
      keywords: `${metric.key} ${metric.source}`,
    })),
    ...nrbRegulatoryEvents.map((evt) => ({
      id: evt.id,
      kind: "event" as const,
      label: evt.description,
      meta: `${evt.institutionName} · ${humanize(evt.eventType) ?? ""}`.trim(),
      href: `/news/${evt.id}`,
      keywords: `${evt.institutionName} ${evt.eventType} ${formatDate(evt.occurredAt) ?? ""}`,
    })),
    ...distinctNrbDocuments().map((doc) => ({
      id: doc.id,
      kind: "document" as const,
      label: doc.title,
      meta: `${doc.sourceTitle} · ${distinctDate(doc.publishedAt)}`,
      href: doc.officialUrl,
      keywords: `${doc.docType} ${doc.topic ?? ""}`,
    })),
    ...allPublishedFinancials().map((doc) => ({
      id: doc.id,
      kind: "document" as const,
      label: doc.title,
      meta: `${doc.institution} · ${
        humanize(doc.reportType) ?? humanize(doc.rateKind) ?? "financial document"
      }`,
      href: doc.sourceDocument,
      keywords: `${doc.institution} ${doc.kind} ${displayHost(doc.sourceDocument) ?? ""}`,
    })),
  ];
}

function distinctDate(value: string | null): string {
  return formatDate(value) ?? "undated";
}

/** Number of indexed entries per entity type. */
export function searchKindCounts(entries: readonly IndexEntry[]): Record<IndexKind, number> {
  const counts = {
    institution: 0,
    branch: 0,
    person: 0,
    job: 0,
    metric: 0,
    event: 0,
    document: 0,
  } as Record<IndexKind, number>;
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}
