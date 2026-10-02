import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { SearchIndex, type IndexEntry } from "@/components/search/SearchIndex";
import { institutions } from "@/data/institutions";
import { nrbRegulatoryEvents } from "@/data/nrb";
import { distinctNrbDocuments } from "@/util/activity";
import { jobs } from "@/data/jobs";
import { financials } from "@/data/financials";
import { allPublishedPeople } from "../../../lib/repository/static-people";
import { displayHost, formatDate, humanize, NOT_AVAILABLE } from "@/util/format";

/**
 * Search.
 *
 * The site is a static export, so this page cannot read a query string at build
 * time and there is no runtime endpoint to ask. The index below is compiled into
 * the page and filtered in the browser by `SearchIndex`.
 *
 * That forces a trade-off worth being explicit about: the index carries a label
 * and one short line of context per record, not the whole record. It is a finding
 * aid — every entry links to the page that holds the detail and the sources.
 * Shipping full records to the client would be the alternative, and it would put
 * roughly 50 KB of institution and document data into this one page's payload to
 * avoid clicking through.
 *
 * With JavaScript off the page still lists everything, so search degrades to
 * browsing rather than to a blank screen.
 */

export const metadata: Metadata = {
  title: "Search",
  description:
    "Search across Nepal's licensed microfinance institutions, their leadership, documents, vacancies and regulatory activity.",
  robots: { index: false, follow: true },
};

const people = allPublishedPeople();

/**
 * People records carry an institution *slug*, not a name. Resolving it once here
 * keeps the search index honest — a reader searching an institution name should
 * see that name on the person row, and a slug would show as initials.
 */
const nameByInstitutionSlug = new Map(institutions.map((i) => [i.slug, i.name]));

const ENTRIES: IndexEntry[] = [
  ...institutions.map((inst) => ({
    id: inst.id,
    kind: "institution" as const,
    label: inst.name,
    meta: [inst.workingArea, inst.headOffice].join(" · "),
    href: `/institutions/${inst.slug}`,
    // Aliases and the raw source name are searchable but never displayed, so a
    // reader typing "MITHILA" finds the record without the card looking cluttered.
    keywords: [...inst.aliases, inst.sourceNameRaw].join(" "),
  })),
  ...people.map((person) => {
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
  ...nrbRegulatoryEvents.map((event) => ({
    id: event.id,
    kind: "event" as const,
    label: `${humanize(event.eventType) ?? "Change"} — ${event.title}`,
    meta: `${event.institutionName} · ${formatDate(event.occurredAt) ?? "undated"}`,
    href: `/news/${event.id}`,
    keywords: `${event.institutionName} ${event.eventType} merger acquisition rename`,
  })),
  ...distinctNrbDocuments().map((doc) => ({
    id: doc.id,
    kind: "document" as const,
    label: doc.title,
    meta: `${doc.sourceTitle} · ${formatDate(doc.publishedAt) ?? "undated"}`,
    href: doc.officialUrl,
    keywords: `${doc.docType} ${doc.topic ?? ""}`,
  })),
  ...financials.map((doc) => ({
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

export default function SearchPage() {
  return (
    <>
      <PageHeader
        eyebrow="Search"
        title="Search the record"
      >
        <p className="max-w-2xl text-base leading-relaxed text-mfi-600">
          Searches {institutions.length} institutions and their recorded aliases,{" "}
          {people.length} published people, {jobs.length} vacancy records,{" "}
          {nrbRegulatoryEvents.length} recorded changes and{" "}
          {distinctNrbDocuments().length + financials.length} documents. Every result links to the page that holds its
          sources.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <SearchIndex entries={ENTRIES} />
      </Container>
    </>
  );
}
