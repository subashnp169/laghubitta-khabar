// ============================================================================
// Phase 3 (M3.1) — read models over the generated modules. Pure layer: no I/O,
// no randomness, no AI. Every value traces to a deterministic module.
// The future DB-backed adapter keeps this same shape (see API-CONTRACT.md §2).
// ============================================================================

import type {
  CrawlSource, Document, Institution, Job, NrbDocument, NrbInstitutionLink, NrbRegulatoryEvent,
} from "@/types";
import { institutions } from "@/data/institutions";
import { crawlSources } from "@/data/pilot";
import { nrbDocuments, nrbInstitutionLinks, nrbRegulatoryEvents } from "@/data/nrb";
import { jobs } from "@/data/jobs";
import { documents } from "@/data/documents";
import { openPeopleConflicts, peopleAssertions } from "@/data/people";
import { peopleFromAssertionRows, type PersonAssertionRecord } from "../repository/projection";
import type { PersonDto } from "../repository/types";
import { slicePage, parsePagination, errorEnvelope, type ApiMeta, type CollectionEnvelope, type ResourceEnvelope, type ErrorEnvelope } from "./contract";

export interface InstitutionSummary {
  id: string;
  slug: string;
  name: string;
  license_class: string;
  operation_date: string;
  paid_up_capital_crore: number;
  head_office: string;
  working_area: string;
  coverage_type: string;
  official_website: string | null;
  website_status: string;
  aliases: string[];
  evidence: {
    runs: number;
    snapshots: number;
    branch_count: number;
    vacancy_count: number;
    document_count: number;
    source_status: string | null;
    is_due: boolean;
    paused: boolean;
  };
  nrb: {
    documents: number;
    events: number;
  };
}

export interface InstitutionDetail extends InstitutionSummary {
  source_name_raw: string;
  operation_date_status: string;
  operation_date_remark: string | null;
  operation_date_is_joint_after_merger: boolean;
  cadence: {
    minutes: number;
    bucket: "frequent" | "periodic" | "slow";
    next_due_at: string | null;
    last_run: string | null;
  };
  sourced_evidence: Institution["evidence"];
}

export interface NrbDocumentRecord extends NrbDocument {
  link_type: string | null;
  link_date: string | null;
}

interface InstLookup {
  inst: Institution;
  source: CrawlSource | undefined;
  links: NrbInstitutionLink[];
  events: NrbRegulatoryEvent[];
  matchedJobs: Job[];
}

function sourceByInst(id: string): CrawlSource | undefined {
  return crawlSources.find((s) => s.institutionId === id);
}

function linkByInst(id: string): NrbInstitutionLink[] {
  return nrbInstitutionLinks.filter((l) => l.institutionId === id);
}

function eventsByInst(inst: Institution): NrbRegulatoryEvent[] {
  return nrbRegulatoryEvents
    .filter((e) => e.institutionId === inst.id || e.institutionSlug === inst.slug)
    .sort((a, b) => ((a.occurredAt ?? "") < (b.occurredAt ?? "") ? 1 : -1));
}

/**
 * Vacancies for an institution, from the generated evidence module.
 *
 * Matching is on the institution slug that the generator recorded from the
 * `ingestion_sources` -> `institutions` join, not on a name prefix. A prefix match
 * is how a fabricated "Branch Manager at Nirdhan Utthan Laghubitta" row ended up on
 * an institution's page: the row existed, and its institution field merely started
 * with the same words. Slug matching can only return a row that was actually
 * observed from that institution's own site, because that is where the slug came
 * from.
 */
function jobsByInst(inst: Institution): Job[] {
  const prefix = `${inst.slug}-`;
  return jobs
    .filter((j) => j.slug.startsWith(prefix))
    .map((j) => ({
      id: j.id,
      title: j.title,
      institution: j.institution,
      location: j.location,
      type: j.type,
      // The API envelope types `deadline` as a required string, so an unobserved
      // deadline becomes empty rather than a guessed date. The public page renders
      // null as "No deadline observed".
      deadline: j.deadline ?? "",
      description: j.description,
      slug: j.slug,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function lookup(inst: Institution): InstLookup {
  const source = sourceByInst(inst.id);
  const links = linkByInst(inst.id);
  return { inst, source, links, events: eventsByInst(inst), matchedJobs: jobsByInst(inst) };
}

function sourceStatus(source: CrawlSource | undefined): string | null {
  return source ? source.status : null;
}

function summaryFor({ inst, source, links, events }: InstLookup): InstitutionSummary {
  return {
    id: inst.id,
    slug: inst.slug,
    name: inst.name,
    license_class: inst.licenseClass,
    operation_date: inst.operationDate,
    paid_up_capital_crore: inst.paidUpCapitalCrore,
    head_office: inst.headOffice,
    working_area: inst.workingArea,
    coverage_type: inst.coverageType,
    official_website: inst.officialWebsite,
    website_status: inst.websiteStatus,
    aliases: inst.aliases,
    evidence: {
      runs: source?.runs ?? 0,
      snapshots: source?.snapshots ?? 0,
      branch_count: source?.branchCount ?? 0,
      vacancy_count: source?.vacancyCount ?? 0,
      document_count: source?.documentCount ?? 0,
      source_status: sourceStatus(source),
      is_due: source?.isDue ?? false,
      paused: source?.paused ?? false,
    },
    nrb: {
      documents: links.length,
      events: events.length,
    },
  };
}

export function metaFor(inst: Institution): ApiMeta {
  const id = inst.evidence.identity;
  const source = id?.sourceId ?? "nrb-bfi-mid-may-2026";
  return {
    source,
    sources: [source],
    last_verified_at: id?.verifiedOn ?? null,
    verification_status: "UNVERIFIED",
  };
}

function detailFor(l: InstLookup): InstitutionDetail {
  const s = summaryFor(l);
  const src = l.source;
  return {
    ...s,
    source_name_raw: l.inst.sourceNameRaw,
    operation_date_status: l.inst.operationDateStatus,
    operation_date_remark: l.inst.operationDateNote ?? null,
    operation_date_is_joint_after_merger: l.inst.operationDateIsJointAfterMerger,
    cadence: {
      minutes: src?.cadenceMinutes ?? 0,
      bucket: src?.cadenceBucket ?? "periodic",
      next_due_at: src?.nextDueAt ?? null,
      last_run: src?.lastRun ?? null,
    },
    sourced_evidence: l.inst.evidence,
  };
}

export interface SearchGroups {
  institutions: InstitutionSummary[];
  people: PersonDto[];
  documents: Document[];
}

export interface SearchResult {
  query: string;
  groups: SearchGroups;
}

// ---------------------------------------------------------------------------
// Endpoint operations (pure over modules)
// ---------------------------------------------------------------------------

export function listInstitutions(params: {
  q?: string;
  province?: string;
  status?: string;
  page?: string | null;
  limit?: string | null;
}): { status: number; body: CollectionEnvelope<InstitutionSummary> } {
  const pagination = parsePagination(
    new URLSearchParams(
      `${params.page != null ? `page=${encodeURIComponent(params.page)}` : ""}&${params.limit != null ? `limit=${encodeURIComponent(params.limit)}` : ""}`,
    ),
  );
  const q = (params.q ?? "").trim().toLowerCase();
  const province = (params.province ?? "").trim().toLowerCase();
  const status = (params.status ?? "").trim().toLowerCase();

  const items = institutions
    .map(lookup)
    .filter(({ inst }) => {
      if (q && !inst.name.toLowerCase().includes(q) && !inst.sourceNameRaw.toLowerCase().includes(q) && !inst.aliases.some((a) => a.toLowerCase().includes(q))) return false;
      if (province && !`${inst.workingArea} ${inst.headOffice}`.toLowerCase().includes(province)) return false;
      if (status && inst.websiteStatus !== status) return false;
      return true;
    })
    .map(summaryFor);

  return { status: 200, body: slicePage(items, pagination) };
}

export function getInstitution(
  slug: string,
): { status: number; body: ResourceEnvelope<InstitutionDetail> | ErrorEnvelope } {
  const inst = institutions.find((i) => i.slug === slug);
  if (!inst) return errorEnvelope("NOT_FOUND", `No institution with slug '${slug}'`);
  return { status: 200, body: { data: detailFor(lookup(inst)), meta: metaFor(inst) } };
}

export function institutionDocuments(
  slug: string,
  requested: { page?: string | null; limit?: string | null },
): { status: number; body: CollectionEnvelope<NrbDocumentRecord> | ErrorEnvelope } {
  const inst = institutions.find((i) => i.slug === slug);
  if (!inst) return errorEnvelope("NOT_FOUND", `No institution with slug '${slug}'`);
  const docById = new Map(nrbDocuments.map((d) => [d.id, d]));
  const records: NrbDocumentRecord[] = [];
  for (const l of linkByInst(inst.id)) {
    const doc = l.nrbDocumentId ? docById.get(l.nrbDocumentId) : undefined;
    if (doc) records.push({ ...doc, link_type: l.linkType, link_date: l.linkDate });
  }
  const p = parsePagination(new URLSearchParams(`${requested.page != null ? `page=${encodeURIComponent(requested.page)}` : ""}&${requested.limit != null ? `limit=${encodeURIComponent(requested.limit)}` : ""}`));
  return { status: 200, body: slicePage(records, p) };
}

export function institutionEvents(
  slug: string,
  requested: { page?: string | null; limit?: string | null },
): { status: number; body: CollectionEnvelope<NrbRegulatoryEvent> | ErrorEnvelope } {
  const inst = institutions.find((i) => i.slug === slug);
  if (!inst) return errorEnvelope("NOT_FOUND", `No institution with slug '${slug}'`);
  const p = parsePagination(new URLSearchParams(`${requested.page != null ? `page=${encodeURIComponent(requested.page)}` : ""}&${requested.limit != null ? `limit=${encodeURIComponent(requested.limit)}` : ""}`));
  return { status: 200, body: slicePage(eventsByInst(inst), p) };
}

export function institutionJobs(
  slug: string,
  requested: { page?: string | null; limit?: string | null },
): { status: number; body: CollectionEnvelope<Job> | ErrorEnvelope } {
  const inst = institutions.find((i) => i.slug === slug);
  if (!inst) return errorEnvelope("NOT_FOUND", `No institution with slug '${slug}'`);
  const p = parsePagination(new URLSearchParams(`${requested.page != null ? `page=${encodeURIComponent(requested.page)}` : ""}&${requested.limit != null ? `limit=${encodeURIComponent(requested.limit)}` : ""}`));
  return { status: 200, body: slicePage(jobsByInst(inst), p) };
}

export function emptyPhaseEnvelope(page?: string | null, limit?: string | null): CollectionEnvelope<never> {
  const p = parsePagination(new URLSearchParams(`${page != null ? `page=${encodeURIComponent(page)}` : ""}&${limit != null ? `limit=${encodeURIComponent(limit)}` : ""}`));
  return { data: [], pagination: { page: p.page, limit: p.limit, total: 0 } };
}

// ---------------------------------------------------------------------------
// People / leadership read models (M3.3) — pure projection over the generated
// src/data/people.ts evidence module. Same PersonDto shape the repository
// adapters produce (lib/repository/projection.ts), so the B2B API, the local
// adapter, and the D1 adapter all mean the same thing.
// ---------------------------------------------------------------------------

const peopleOpenConflictKeys = () =>
  new Set(
    openPeopleConflicts.flatMap((c) =>
      String(c.field_name)
        .split("|")
        .map((field) => `${c.institution_id}|${field}`),
    ),
  );

function allPeople(): PersonDto[] {
  return peopleFromAssertionRows(peopleAssertions as unknown as PersonAssertionRecord[], {
    openConflictKeys: peopleOpenConflictKeys(),
  });
}

export function institutionLeadership(
  slug: string,
  requested: { page?: string | null; limit?: string | null },
): { status: number; body: CollectionEnvelope<PersonDto> | ErrorEnvelope } {
  const inst = institutions.find((i) => i.slug === slug);
  if (!inst) return errorEnvelope("NOT_FOUND", `No institution with slug '${slug}'`);
  const p = parsePagination(new URLSearchParams(`${requested.page != null ? `page=${encodeURIComponent(requested.page)}` : ""}&${requested.limit != null ? `limit=${encodeURIComponent(requested.limit)}` : ""}`));
  const people = allPeople().filter((person) => person.institution_slug === slug);
  return { status: 200, body: slicePage(people, p) };
}

export function getPerson(
  slug: string,
): { status: number; body: ResourceEnvelope<PersonDto> | ErrorEnvelope } {
  const person = allPeople().find((p) => p.slug === slug);
  if (!person) return errorEnvelope("NOT_FOUND", `No person with slug '${slug}'`);
  return {
    status: 200,
    body: {
      data: person,
      meta: {
        source: person.meta.source,
        sources: person.meta.sources,
        last_verified_at: person.meta.last_verified_at,
        verification_status: person.meta.verification_status,
      },
    },
  };
}

export function search(query: { q?: string | null }): { status: number; body: ResourceEnvelope<SearchResult> | ErrorEnvelope } {
  const q = (query.q ?? "").trim();
  if (!q) return errorEnvelope("VALIDATION", "Query parameter 'q' is required and must be non-empty");
  const needle = q.toLowerCase();

  const matches: SearchGroups = {
    institutions: institutions
      .map(lookup)
      .filter(({ inst }) =>
        inst.name.toLowerCase().includes(needle) ||
        inst.sourceNameRaw.toLowerCase().includes(needle) ||
        inst.aliases.some((a) => a.toLowerCase().includes(needle)),
      )
      .slice(0, 20)
      .map(summaryFor),
    people: allPeople()
      .filter((p) => p.name.toLowerCase().includes(needle))
      .slice(0, 20),
    documents: [...documents, ...nrbDocuments.map((d) => ({ id: `nrb-${d.id}`, title: d.title, type: d.docType, institution: d.sourceTitle, date: d.publishedAt ?? "", size: d.size ?? "", url: d.officialUrl }))]
      .filter((d) => d.title.toLowerCase().includes(needle))
      .slice(0, 20),
  };

  return {
    status: 200,
    body: {
      data: {
        query: q,
        groups: matches,
      },
      meta: { source: "generated-modules", sources: ["generated-modules"], last_verified_at: null, verification_status: "UNVERIFIED" },
    },
  };
}

