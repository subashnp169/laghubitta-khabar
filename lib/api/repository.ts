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
import { nrbDocuments, nrbInstitutionLinks, nrbRegulatoryEvents, nrbSummary } from "@/data/nrb";
import { jobs } from "@/data/jobs";
import { newsRecords, type NewsRecord } from "@/util/activity";
import { allPublishedPeople } from "../repository/static-people";
import { allPublishedBranches } from "../repository/static-branches";
import { allPublishedFinancials } from "../repository/static-financials";
import { allPublishedDocuments } from "../repository/static-documents";
import type {
  BranchDto,
  DocumentDto,
  FinancialDocumentDto,
  FinancialReportDto,
  InterestRateDto,
  NewsItemDto,
  NewsScope,
  NewsTier,
  PersonDto,
  SourceMeta,
} from "../repository/types";
import { slicePage, parsePagination, errorEnvelope, type ApiMeta, type CollectionEnvelope, type ResourceEnvelope, type ErrorEnvelope } from "./contract";

export interface InstitutionSummary {
  id: string;
  slug: string;
  name: string;
  license_class: string;
  operation_date: string;
  /** null when no grade-A source attributes a figure to this institution. */
  paid_up_capital_crore: number | null;
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
  timeline: Array<{
    event_type: string;
    title: string;
    occurred_at: string | null;
    summary: string | null;
  }>;
  coverage: { province_count: number; district_count: number; branch_count: number } | null;
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
 * Matching is on the canonical `institutionSlug` COLUMN the builder wrote from
 * the source's publisher -> registry resolution (P2-D) — not on a name prefix
 * and not on a prefix of a slug built from an id. A prefix match is how a
 * fabricated "Branch Manager at Nirdhan Utthan Laghubitta" row ended up on an
 * institution's page: the row existed, and its institution field merely started
 * with the same words. Column matching can only return a row that was actually
 * observed from that institution's own site, because that is where the column
 * came from — and it cannot mis-attribute an institution whose pilot numbering
 * disagrees with the registry, which three did before P2-D.
 */
function jobsByInst(inst: Institution): Job[] {
  return jobs
    .filter((j) => j.institutionSlug === inst.slug)
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
      // Deliberately null. `source` here is an evidence-document reference (an
      // NRB filing), not a web page, so there is no raw URL to follow. The
      // institution's official website is a different thing entirely; pairing
      // the two would assert the website is where this evidence came from.
      source_url: null,
      last_verified_at: id?.verifiedOn ?? null,
      verification_status: "UNVERIFIED",
    };
}

function detailFor(l: InstLookup): InstitutionDetail {
  const s = summaryFor(l);
  const src = l.source;
  const timeline = l.events
    .map((e) => ({
      event_type: e.eventType || "EVENT",
      title: e.title,
      occurred_at: e.occurredAt ?? null,
      summary: e.description ?? null,
    }));
  const branchCount = src?.branchCount ?? 0;
  const districtCount = 0;
  const provinceCount = 0;
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
    timeline,
    coverage: {
      province_count: provinceCount,
      district_count: districtCount,
      branch_count: branchCount,
    },
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

// ---------------------------------------------------------------------------
// Financial documents + interest-rate notices (P2-C) — the single shared
// FinancialDocumentDto projection (lib/repository/projection.ts) over the
// generated src/data/financials.ts evidence snapshot. A record is a document URL
// asserted from an institution's own site; its body was never read, so no metric
// and no numeric rate is ever derived here. The owning institution is a COLUMN on
// the record (resolved by the builder from the source's publisher), never
// re-parsed from the id — which is what let a pilot-numbered id drift onto the
// wrong company before P2-C.
// ---------------------------------------------------------------------------

export type { FinancialDocumentDto } from "../repository/types";

function financialMeta(r: FinancialDocumentDto): SourceMeta {
  return {
    source: "generated-modules",
    sources: ["generated-modules"],
    source_url: r.sourceDocument ?? null,
    last_verified_at: r.lastSeenAt,
    verification_status: r.status === "CONFLICT" ? "CONFLICT" : "UNVERIFIED",
  };
}

function financialReportDto(r: FinancialDocumentDto): FinancialReportDto {
  return {
    id: r.id,
    institution: r.institution,
    institution_slug: r.institution_slug || "(unresolved)",
    title: r.title,
    report_type: r.reportType,
    period_start: null,
    period_end: null,
    report_date: null,
    metrics: {},
    // The document URL is the evidence; JSON of a title never gets promoted
    // into a number, so metrics stays empty even when a title looks numeric.
    source_url: r.sourceDocument,
    meta: financialMeta(r),
  };
}

function interestRateDto(r: FinancialDocumentDto): InterestRateDto {
  return {
    id: r.id,
    rate_kind: r.rateKind ?? "INTEREST_RATE",
    institution: r.institution,
    institution_slug: r.institution_slug || "(unresolved)",
    title: r.title,
    url: r.sourceDocument,
    source_url: r.sourceName,
    rate_pct: null,
    period_start: null,
    period_end: null,
    meta: financialMeta(r),
  };
}

/** Every currently published financial document, reports and rate notices alike. */
export function allFinancialDocuments(): FinancialDocumentDto[] {
  return allPublishedFinancials();
}

export function institutionFinancials(
  slug: string,
  requested: { page?: string | null; limit?: string | null },
): { status: number; body: CollectionEnvelope<FinancialReportDto> | ErrorEnvelope } {
  const inst = institutions.find((i) => i.slug === slug);
  if (!inst) return errorEnvelope("NOT_FOUND", `No institution with slug '${slug}'`);
  const p = parsePagination(new URLSearchParams(`${requested.page != null ? `page=${encodeURIComponent(requested.page)}` : ""}&${requested.limit != null ? `limit=${encodeURIComponent(requested.limit)}` : ""}`));
  const reports = allPublishedFinancials()
    .filter((r) => r.kind === "REPORT" && r.institution_slug === slug)
    .map(financialReportDto)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { status: 200, body: slicePage(reports, p) };
}

export function institutionInterestRates(
  slug: string,
  requested: { page?: string | null; limit?: string | null },
): { status: number; body: CollectionEnvelope<InterestRateDto> | ErrorEnvelope } {
  const inst = institutions.find((i) => i.slug === slug);
  if (!inst) return errorEnvelope("NOT_FOUND", `No institution with slug '${slug}'`);
  const p = parsePagination(new URLSearchParams(`${requested.page != null ? `page=${encodeURIComponent(requested.page)}` : ""}&${requested.limit != null ? `limit=${encodeURIComponent(requested.limit)}` : ""}`));
  const rates = allPublishedFinancials()
    .filter((r) => r.kind === "RATE" && r.institution_slug === slug)
    .map(interestRateDto)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { status: 200, body: slicePage(rates, p) };
}

export function allInterestRates(
  requested: { page?: string | null; limit?: string | null },
): { status: number; body: CollectionEnvelope<InterestRateDto> } {
  const p = parsePagination(new URLSearchParams(`${requested.page != null ? `page=${encodeURIComponent(requested.page)}` : ""}&${requested.limit != null ? `limit=${encodeURIComponent(requested.limit)}` : ""}`));
  const rates = allPublishedFinancials()
    .filter((r) => r.kind === "RATE")
    .map(interestRateDto)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { status: 200, body: slicePage(rates, p) };
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

// Single source of truth for the published people set, shared with the static
// person routes. Delegating here guarantees a person page and
// `GET /api/people/{slug}` can never disagree about the same slug.
function allPeople(): PersonDto[] {
  return allPublishedPeople();
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

// Single source of truth for the published branch set, shared with any static
// branch route. Delegating here guarantees a branch page and a future
// `GET /institutions/{slug}/branches` can never disagree about the same record.
function allBranches(): BranchDto[] {
  return allPublishedBranches();
}

export function institutionBranches(
  slug: string,
  requested: { page?: string | null; limit?: string | null },
): { status: number; body: CollectionEnvelope<BranchDto> | ErrorEnvelope } {
  const inst = institutions.find((i) => i.slug === slug);
  if (!inst) return errorEnvelope("NOT_FOUND", `No institution with slug '${slug}'`);
  const p = parsePagination(new URLSearchParams(`${requested.page != null ? `page=${encodeURIComponent(requested.page)}` : ""}&${requested.limit != null ? `limit=${encodeURIComponent(requested.limit)}` : ""}`));
  const branches = allBranches().filter((b) => b.slug.startsWith(`${inst.slug}-`));
  return { status: 200, body: slicePage(branches, p) };
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
          source_url: person.meta.source_url,
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
    // Only real NRB documents. The eight placeholder documents this used to
    // merge in (invented titles such as "Financial Stability Report 2025" and
    // "Monetary Policy 2025/26", every one with `url: "#"`) were being returned
    // by the published search endpoint, where a caller had no way to tell them
    // apart from the 97 real ones. The contract shape is unchanged — only the
    // fabricated rows are gone.
    documents: nrbDocuments
      .map((d) => ({ id: `nrb-${d.id}`, title: d.title, type: d.docType, institution: d.sourceTitle, date: d.publishedAt ?? "", size: d.size ?? "", url: d.officialUrl }))
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
        meta: { source: "generated-modules", sources: ["generated-modules"], source_url: null, last_verified_at: null, verification_status: "UNVERIFIED" },
    },
  };
}

// ---------------------------------------------------------------------------
// News / content layer (P2-E) — `GET /api/news`.
//
// The canonical content iteration lives in src/util/activity.ts (`newsRecords`).
// This endpoint maps those records to the repository's NewsItemDto shape and
// applies the frozen API-CONTRACT.md filters:
//
//   ?scope=INSTITUTION|NRB|MARKET|MEDIA  what the item is about
//   ?tier=OFFICIAL|NRB|KHABAR|MEDIA      who published it
//   ?page&limit                           default 20, max 100
//
// Both filters are derived from the record's registered source publisher, never
// guessed from ids or titles. meta.tier holds counts over the scope-filtered
// set, computed BETWEEN the scope and tier filter — the facet semantics a
// grouped list needs — and every tier counts, including the ones that are
// honestly zero today.
// ---------------------------------------------------------------------------

/** The tier vocabulary, in contract order. */
const NEWS_TIERS: readonly NewsTier[] = ["OFFICIAL", "NRB", "KHABAR", "MEDIA"];
/** The scope vocabulary, in contract order. */
const NEWS_SCOPES: readonly NewsScope[] = ["INSTITUTION", "NRB", "MARKET", "MEDIA"];

/**
 * The publisher → tier / scope classification. Every registered NRB source is
 * published by "Nepal Rastra Bank" (measured over all 9 of nrbSummary.sources),
 * so everything maps to NRB/NRB and OFFICIAL/KHABAR/MEDIA count honestly as 0.
 * An unmapped publisher throws rather than silently collapsing into a plausible
 * tier — a new publisher class must be classified consciously, never defaulted.
 */
const TIER_BY_PUBLISHER: Readonly<Record<string, NewsTier>> = { "Nepal Rastra Bank": "NRB" };
const SCOPE_BY_PUBLISHER: Readonly<Record<string, NewsScope>> = { "Nepal Rastra Bank": "NRB" };

interface NewsClassification {
  tier: NewsTier;
  scope: NewsScope;
}

function classify(record: NewsRecord): NewsClassification {
  const source = nrbSummary.sources.find((s) => s.id === record.sourceId);
  if (!source) throw new Error(`listNews: unregistered source id: ${record.sourceId}`);
  const tier = TIER_BY_PUBLISHER[source.publisher];
  const scope = SCOPE_BY_PUBLISHER[source.publisher];
  if (!tier || !scope) throw new Error(`listNews: no tier/scope mapping for publisher '${source.publisher}' (source ${record.sourceId})`);
  return { tier, scope };
}

function toNewsItem(record: NewsRecord, { tier, scope }: NewsClassification): NewsItemDto {
  return {
    id: record.id,
    // The /news/{slug} route already serves these ids as static paths, so the
    // API slug is the same id — a consumer can follow either surface.
    slug: record.id,
    title: record.title,
    tier,
    scope,
    published_at: record.occurredAt,
    // The feed's detail line, verbatim: the feed says the same thing the API
    // says, and neither claims more than the record carries.
    snippet: record.detail,
    institution_slug: record.institutionSlug,
    source_id: record.sourceId,
    meta: {
      source: record.sourceTitle,
      sources: [record.sourceTitle],
      source_url: record.sourceUrl,
      // The snapshot's build instant, dated — the last moment the evidence was
      // regenerated. The same for every item: this is a property of the frozen
      // snapshot, not of any single observation.
      last_verified_at: nrbSummary.generatedAt.slice(0, 10),
      verification_status: "UNVERIFIED",
    },
  };
}

export function listNews(params: {
  tier?: string | null;
  scope?: string | null;
  page?: string | null;
  limit?: string | null;
}): { status: number; body: { data: NewsItemDto[]; pagination: { page: number; limit: number; total: number }; meta: { tier: Record<NewsTier, number> } } | ErrorEnvelope } {
  const pagination = parsePagination(
    new URLSearchParams(
      `${params.page != null ? `page=${encodeURIComponent(params.page)}` : ""}&${params.limit != null ? `limit=${encodeURIComponent(params.limit)}` : ""}`,
    ),
  );
  const tier = (params.tier ?? "").trim().toUpperCase();
  const scope = (params.scope ?? "").trim().toUpperCase();
  if (tier && !NEWS_TIERS.includes(tier as NewsTier)) return errorEnvelope("VALIDATION", `tier must be one of ${NEWS_TIERS.join(", ")}`);
  if (scope && !NEWS_SCOPES.includes(scope as NewsScope)) return errorEnvelope("VALIDATION", `scope must be one of ${NEWS_SCOPES.join(", ")}`);

  const classified = newsRecords().map((record) => ({ record, ...classify(record) }));
  const scoped = scope ? classified.filter((c) => c.scope === scope) : classified;
  const counts = NEWS_TIERS.reduce(
    (acc, t) => {
      acc[t] = scoped.filter((c) => c.tier === t).length;
      return acc;
    },
    {} as Record<NewsTier, number>,
  );
  const data = tier ? scoped.filter((c) => c.tier === tier) : scoped;
  const items = data.map((c) => toNewsItem(c.record, c));

  const paged = slicePage(items, pagination);
  return { status: 200, body: { ...paged, meta: { tier: counts } } };
}

// ---------------------------------------------------------------------------
// Operational Graph (P2-F) — institution-centric intelligence graph
// ---------------------------------------------------------------------------

export interface InstitutionGraph {
  node: InstitutionDetail;
  edges: {
    leadership: PersonDto[];
    branches: BranchDto[];
    financialReports: FinancialReportDto[];
    interestRates: InterestRateDto[];
    documents: DocumentDto[];
    jobs: Job[];
    news: NewsItemDto[];
    events: NrbRegulatoryEvent[];
    nrbLinks: NrbInstitutionLink[];
  };
  timeline: Array<{
    id: string;
    date: string | null;
    title: string;
    detail: string | null;
    type: string;
  }>;
  evidence: {
    sources: string[];
    source_urls: (string | null)[];
    last_verified_at: string | null;
  };
  meta: ApiMeta;
}

export function institutionGraph(
  slug: string,
): { status: number; body: ResourceEnvelope<InstitutionGraph> | ErrorEnvelope } {
  const inst = institutions.find((i) => i.slug === slug);
  if (!inst) return errorEnvelope("NOT_FOUND", `No institution with slug '${slug}'`);

  const l = lookup(inst);
  const node = detailFor(l);

  const leadership = allPeople().filter((p) => p.institution_slug === slug);
  const branches = allBranches().filter((b) => b.slug.startsWith(`${slug}-`));
  const finAll = allPublishedFinancials().filter((r) => r.institution_slug === slug);
  const financialReports = finAll.filter((r) => r.kind === "REPORT").map(financialReportDto);
  const interestRates = finAll.filter((r) => r.kind === "RATE").map(interestRateDto);
  const documents = allPublishedDocuments().filter((d) => d.institution_slug === slug);
  const jobs = jobsByInst(inst);
  const classifiedNews = newsRecords()
    .filter((r) => r.institutionSlug === slug)
    .map((record) => ({ record, ...classify(record) }));
  const news = classifiedNews.map((c) => toNewsItem(c.record, c));
  const events = eventsByInst(inst);
  const nrbLinks = linkByInst(inst.id);

  const timeline: InstitutionGraph["timeline"] = [];
  if (node.timeline) {
    for (let i = 0; i < node.timeline.length; i++) {
      const t = node.timeline[i];
      timeline.push({
        id: `nrb-${i}`,
        date: t.occurred_at,
        title: t.title,
        detail: t.summary,
        type: t.event_type,
      });
    }
  }
  const opDate = inst.operationDateStatus !== "source_anomaly" && inst.operationDate ? inst.operationDate : null;
  if (opDate) {
    timeline.push({ id: "op-established", date: opDate, title: "Operation recorded", detail: null, type: "ESTABLISHED" });
  }
  for (const b of branches) {
    if (b.established_on) {
      timeline.push({ id: `br-${b.id}`, date: b.established_on, title: `Branch established: ${b.name}`, detail: null, type: "BRANCH_ESTABLISHED" });
    }
  }
  timeline.sort((a, b) => {
    const da = a.date ?? "";
    const db = b.date ?? "";
    if (da < db) return 1;
    if (da > db) return -1;
    return 0;
  });

  // Remove duplicates by (date,title,type) while preserving order
  const seen = new Set<string>();
  const timelineDedup: typeof timeline = [];
  for (const t of timeline) {
    const k = `${t.date ?? ""}|${t.title}|${t.type}`;
    if (!seen.has(k)) {
      seen.add(k);
      timelineDedup.push(t);
    }
  }

  const sourcesSet = new Set<string>();
  const urlsSet = new Set<string | null>();
  for (const p of leadership) {
    sourcesSet.add(p.meta.source);
    urlsSet.add(p.meta.source_url);
  }
  for (const b of branches) {
    sourcesSet.add(b.meta.source);
    urlsSet.add(b.meta.source_url);
  }
  for (const f of financialReports) {
    sourcesSet.add(f.meta.source);
    urlsSet.add(f.meta.source_url);
  }
  for (const f of interestRates) {
    sourcesSet.add(f.meta.source);
    urlsSet.add(f.meta.source_url);
  }
  for (const d of documents) {
    sourcesSet.add(d.meta.source);
    urlsSet.add(d.meta.source_url);
  }
  for (const n of news) {
    sourcesSet.add(n.meta.source);
    urlsSet.add(n.meta.source_url);
  }
  for (const e of events) {
    urlsSet.add(e.description && e.description.includes("https://") ? e.description.match(/https:\/\/[^\s]+/)?.[0] ?? null : null);
  }
  for (const nl of nrbLinks) {
    urlsSet.add(nl.nrbDocumentId ? `nrb:${nl.nrbDocumentId}` : null);
  }
  const m = metaFor(inst);
  sourcesSet.add(m.source);
  urlsSet.add(m.source_url);
  // add registered sources reference by flattening keys present in evidence nodes? keep minimal per locked scope

  const lastVerified = m.last_verified_at ?? null;
  const evidence = {
    sources: Array.from(sourcesSet).filter((x) => x && x.trim() !== ""),
    source_urls: Array.from(urlsSet),
    last_verified_at: lastVerified,
  };

  return {
    status: 200,
    body: {
      data: {
        node,
        edges: {
          leadership,
          branches,
          financialReports,
          interestRates,
          documents,
          jobs,
          news,
          events,
          nrbLinks,
        },
        timeline: timelineDedup,
        evidence,
        meta: m,
      },
      meta: m,
    },
  };
}

