// ============================================================================
// Repository DTOs — the only shape components may consume. These are
// provider-agnostic: identical whether the adapter is D1, local SQLite, or
// the in-memory mock. Never import D1 types here.
// ============================================================================

export type VerificationStatus =
  | "UNVERIFIED"
  | "AUTO_VERIFIED"
  | "HUMAN_VERIFIED"
  | "CONFLICT"
  | "STALE";

export type CoverageStatus =
  | "NOT_STARTED"
  | "DISCOVERED"
  | "PARTIAL"
  | "VERIFIED"
  | "STALE"
  | "CONFLICT";

export interface SourceMeta {
  // The source that owns the record's first-published observation. Kept as a
  // single value so existing attribution consumers keep working unchanged.
  source: string;
  // Every distinct source that currently owns an observation backing this
  // record, sorted for determinism.
  //
  // This is where CORROBORATION lives. Under the canonical source-owned
  // observation model, two sources asserting the same normalized claim produce
  // two rows rather than one, so "these sources agree" is a DERIVED property of
  // this set and never an absence of rows. `sources.length >= 2` means the
  // record is corroborated by that many independent sources.
  //
  // Required rather than optional on purpose: when the read model was dropping
  // every source but the first, the loss was silent and no type flagged it.
  // Making the field mandatory means a missing derivation is a compile error.
  sources: string[];
  last_verified_at: string | null;
  verification_status: VerificationStatus;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

export interface InstitutionSummary {
  id: string;
  slug: string;
  name_en: string;
  name_np: string | null;
  short_name: string;
  institution_type: "NATIONAL" | "PROVINCIAL";
  status: "ACTIVE" | "MERGED" | "ACQUIRED" | "RENAMED" | "LIQUIDATED" | "INACTIVE";
  established: number | null;
  head_office_district: string | null;
  head_office_municipality: string | null;
  official_website: string | null;
  official_email: string | null;
  official_phone: string | null;
  logo_url: string | null;
  meta: SourceMeta;
}

export interface OfficialLinkDto {
  link_type: string;
  label: string;
  url: string;
  canonical_url: string | null;
  status: "VERIFIED" | "CANDIDATE" | "STALE" | "FAILED";
  verified_at: string | null;
  last_checked_at: string | null;
}

export interface AliasDto {
  alias: string;
  alias_type: "TICKER" | "TICKER_PROMOTER" | "NAME_ALT" | "NAME_NP" | "FORMER" | "SHORT";
  is_active: boolean;
  source_id: string | null;
  last_verified_at: string | null;
}

export interface TimelineEventDto {
  event_type: "LICENSED" | "MERGED" | "ACQUIRED" | "RENAMED" | "LISTED" | "DELISTED" | "SUSPENDED" | "HEAD_OFFICE_MOVED";
  title: string;
  occurred_at: string | null;
  summary: string | null;
}

export interface OutboundLinkDto {
  scope_key: string;
  slug: string;
  target_type: "WEBSITE" | "SOCIAL" | "DOCUMENT" | "OTHER";
  label: string;
  target_url: string;
  canonical_url: string | null;
  availability_status: "UNKNOWN" | "OK" | "DEAD" | "REDIRECT" | "ERROR";
  last_checked_at: string | null;
}

export interface CoverageDto {
  overall: CoverageStatus;
  leadership: CoverageStatus;
  branch: CoverageStatus;
  financial: CoverageStatus;
  document: CoverageStatus;
  news: CoverageStatus;
  digital: CoverageStatus;
  product: CoverageStatus;
  career: CoverageStatus;
  last_full_reviewed_at: string | null;
  next_full_review_at: string | null;
}

export interface InstitutionDetail extends InstitutionSummary {
  aliases: AliasDto[];
  official_links: OfficialLinkDto[];
  timeline: TimelineEventDto[];
  coverage: CoverageDto | null;
  go_slug: string; // /go/{id}/website
}

export interface PersonDto {
  id: string;
  slug: string;
  name: string;
  institution_id: string;
  institution_slug: string;
  positions: { title: string; committee: string | null; is_current: boolean; since: string | null }[];
  meta: SourceMeta;
}

export interface BranchDto {
  id: string;
  slug: string;
  name: string;
  district: string;
  municipality: string;
  address: string | null;
  phone: string | null;
  established_on: string | null;
  meta: SourceMeta;
}

export interface FinancialReportDto {
  id: string;
  report_type: string;
  period_start: string;
  period_end: string;
  report_date: string | null;
  metrics: Record<string, { reported_value: string | null; normalized_value: string | null }>;
  source_url: string | null;
  meta: SourceMeta;
}

export interface DocumentDto {
  id: string;
  doc_type: string;
  title: string;
  official_url: string | null;
  go_slug: string | null;
  period: string | null;
  source_id: string;
  meta: SourceMeta;
}

export interface JobDto {
  id: string;
  title: string;
  location: string | null;
  type: string | null;
  posted_at: string | null;
  deadline: string | null;
  is_active: boolean;
  meta: SourceMeta;
}

export type NewsTier = "OFFICIAL" | "NRB" | "KHABAR" | "MEDIA";

export interface NewsItemDto {
  id: string;
  slug: string;
  title: string;
  tier: NewsTier;
  published_at: string;
  snippet: string;
  institution_slug: string | null;
  source_id: string;
  meta: SourceMeta;
}

export interface InterestRateDto {
  id: string;
  rate_type: string;
  period_start: string;
  period_end: string;
  min_rate: number | null;
  max_rate: number | null;
  meta: SourceMeta;
}

export interface SearchGroups {
  institutions: InstitutionSummary[];
  people: PersonDto[];
  documents: DocumentDto[];
}

export interface ListInstitutionsOptions {
  q?: string;
  province?: string;
  status?: string;
  page: number;
  limit: number;
}

export interface ListNewsOptions {
  tier?: NewsTier;
  page: number;
  limit: number;
}