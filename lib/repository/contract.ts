// ============================================================================
// Repository contract — the single data-access seam. Only adapters know SQL /
// D1 / storage. Components + route handlers depend on this interface, never
// on a concrete store. (docs/API-CONTRACT.md + docs/ARCHITECTURE.md.)
// ============================================================================

import type {
  BranchDto,
  DocumentDto,
  FinancialReportDto,
  InstitutionDetail,
  InstitutionSummary,
  InterestRateDto,
  JobDto,
  ListInstitutionsOptions,
  ListNewsOptions,
  NewsItemDto,
  OutboundLinkDto,
  Paged,
  PersonDto,
  SearchGroups,
} from "./types";

export interface InstitutionRepository {
  listInstitutions(opts: ListInstitutionsOptions): Promise<Paged<InstitutionSummary>>;
  getInstitutionBySlug(slug: string): Promise<InstitutionDetail | null>;
  getInstitutionById(id: string): Promise<InstitutionDetail | null>;

  listLeadership(institutionId: string): Promise<Paged<PersonDto>>;
  listBranches(institutionId: string): Promise<Paged<BranchDto>>;
  listFinancials(institutionId: string): Promise<Paged<FinancialReportDto>>;
  listDocuments(institutionId: string): Promise<Paged<DocumentDto>>;
  listJobs(institutionId: string): Promise<Paged<JobDto>>;

  getPersonBySlug(slug: string): Promise<PersonDto | null>;

  listNews(opts: ListNewsOptions): Promise<Paged<NewsItemDto>>;
  search(query: string): Promise<SearchGroups>;
  listInterestRates(): Promise<Paged<InterestRateDto>>;

  /** /go/{scopeKey}/{slug} → outbound_links target (302 doors, noindex). */
  resolveOutboundLink(scopeKey: string, slug: string): Promise<OutboundLinkDto | null>;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}