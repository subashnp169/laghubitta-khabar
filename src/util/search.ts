import { search as contractSearch } from "../../lib/api/repository";
import type { DocumentDto, InstitutionSummary, PersonDto } from "../../lib/repository/types";
import { nrbDocuments, nrbRegulatoryEvents } from "@/data/nrb";
import { jobs } from "@/data/jobs";
import { displayHost, humanize } from "./format";

/**
 * Unified search across everything the site publishes.
 *
 * Institutions, people and documents come from the existing repository search,
 * so the grouped results on this page can never drift from what `/v1/search`
 * returns for the same query. That endpoint does not group vacancies or
 * regulatory notices, so those two groups are matched here from the same
 * generated modules the rest of the site reads.
 *
 * The alternative — shipping every institution, person, vacancy and document to
 * the browser to filter client-side — would put hundreds of kilobytes of data on
 * the wire for a keystroke-driven feature, so the matching happens on the
 * server and only the matching rows travel.
 */

export interface JobHit {
  id: string;
  title: string;
  institution: string;
  location: string | null;
  type: string | null;
  deadline: string | null;
  lastSeenAt: string;
  kind: string;
  url: string | null;
  sourceName: string | null;
}

export interface NoticeHit {
  id: string;
  title: string;
  kind: "document" | "event";
  category: string;
  date: string | null;
  publisher: string;
  url: string | null;
  institution: string | null;
}

export interface UnifiedSearchResult {
  query: string;
  institutions: InstitutionSummary[];
  people: PersonDto[];
  documents: DocumentDto[];
  jobs: JobHit[];
  notices: NoticeHit[];
  total: number;
  /** True when the query was empty, so the page can show guidance instead. */
  empty: boolean;
}

const GROUP_LABEL: Record<string, string> = {
  institutions: "Institutions",
  people: "People",
  documents: "Documents",
  jobs: "Vacancies",
  notices: "Notices",
};

export { GROUP_LABEL };

function matches(needle: string, ...haystacks: Array<string | null | undefined>): boolean {
  return haystacks.some((h) => typeof h === "string" && h.toLowerCase().includes(needle));
}

export function unifiedSearch(rawQuery: string, perGroup = 8): UnifiedSearchResult {
  const query = rawQuery.trim();
  const needle = query.toLowerCase();

  const empty: UnifiedSearchResult = {
    query,
    institutions: [],
    people: [],
    documents: [],
    jobs: [],
    notices: [],
    total: 0,
    empty: true,
  };
  if (!needle) return empty;

  const response = contractSearch({ q: query });
  const groups =
    response.status === 200
      ? (response.body as { data?: { groups?: Partial<Record<keyof typeof GROUP_LABEL, unknown[]>> } }).data?.groups
      : undefined;

  const jobHits: JobHit[] = [];
  for (const job of jobs) {
    if (jobHits.length >= perGroup) break;
    if (!matches(needle, job.title, job.institution, job.location, job.type, job.description)) continue;
    jobHits.push({
      id: job.id,
      title: job.title,
      institution: job.institution,
      location: humanize(job.location),
      type: humanize(job.type),
      deadline: job.deadline,
      lastSeenAt: job.lastSeenAt,
      kind: job.kind,
      url: job.sourceDocument ?? null,
      sourceName: humanize(job.sourceName),
    });
  }

  const noticeHits: NoticeHit[] = [];
  for (const doc of nrbDocuments) {
    if (noticeHits.length >= perGroup) break;
    if (!matches(needle, doc.title, doc.docType, doc.topic, doc.sourceTitle)) continue;
    noticeHits.push({
      id: doc.id,
      title: doc.title,
      kind: "document",
      category: humanize(doc.topic) ?? humanize(doc.docType) ?? "Notice",
      date: doc.publishedAt,
      publisher: doc.sourceTitle,
      url: doc.officialUrl,
      institution: null,
    });
  }
  for (const event of nrbRegulatoryEvents) {
    if (noticeHits.length >= perGroup * 2) break;
    if (!matches(needle, event.title, event.description, event.institutionName, event.eventType)) continue;
    noticeHits.push({
      id: event.id,
      title: event.title,
      kind: "event",
      category: humanize(event.eventType) ?? "Regulatory event",
      date: event.occurredAt,
      publisher: "Nepal Rastra Bank",
      url: null,
      institution: event.institutionName,
    });
  }

  const institutions = ((groups?.institutions as InstitutionSummary[]) ?? []).slice(0, perGroup);
  const people = ((groups?.people as PersonDto[]) ?? []).slice(0, perGroup);
  const documents = ((groups?.documents as DocumentDto[]) ?? []).slice(0, perGroup);

  return {
    query,
    institutions,
    people,
    documents,
    jobs: jobHits,
    notices: noticeHits,
    total: institutions.length + people.length + documents.length + jobHits.length + noticeHits.length,
    empty: false,
  };
}

/** Host shown next to an external document, so a reader knows it leaves the site. */
export function noticeHost(url: string | null): string | null {
  return displayHost(url);
}
