export type MasterSourceScope = 'INSTITUTION' | 'NRB' | 'MARKET' | 'MEDIA' | 'GENERAL';

/**
 * MASTER UNIVERSE SNAPSHOT metadata: this data is an observation of the Class-D MFB universe
 * as of a specific date from a specific source — NOT a permanent "there are exactly N MFBs"
 * claim. Institutions get licensed/merged/renamed/liquidated; refresh from NRB periodically
 * (see docs/DATABASE-SPEC.md §9).
 */
export interface MasterUniverseSnapshot {
  source_id: string;
  title: string;
  observed_at: string;
  counts: { institutions: number; aliases: number; official_links: number; timeline: number; sources: number };
}

export interface MasterSource {
  id: string;
  source_type: string;
  source_scope: MasterSourceScope;
  source_grade: string;
  url: string;
  domain: string;
  title: string;
  publisher: string;
  is_active: number;
}

export interface MasterInstitution {
  id: string;
  slug: string;
  name_en: string;
  name_np: string | null;
  short_name: string;
  institution_type: 'NATIONAL' | 'PROVINCIAL';
  status: 'ACTIVE' | 'MERGED' | 'ACQUIRED' | 'RENAMED' | 'LIQUIDATED' | 'INACTIVE';
  registration_number: string | null;
  nrb_license_number: string | null;
  nrb_class: string | null;
  operation_date: string | null;
  head_office_district: string | null;
  head_office_municipality: string | null;
  head_office_address: string | null;
  working_area: string | null;
  official_website: string | null;
  official_email: string | null;
  official_phone: string | null;
  logo_url: string | null;
  established: number | null;
  listed: number;
  source_id: string;
  last_verified_at: string | null;
  next_review_at: string | null;
}

export interface MasterAlias {
  institution_id: string;
  alias: string;
  normalized_alias: string;
  alias_type: 'TICKER' | 'TICKER_PROMOTER' | 'NAME_ALT' | 'NAME_NP' | 'FORMER' | 'SHORT';
  source_grade: string;
}

export interface MasterOfficialLink {
  institution_id: string;
  link_type: string;
  label: string;
  url: string;
  canonical_url: string | null;
  verified: number;
  verified_at: string | null;
  status: 'VERIFIED' | 'CANDIDATE' | 'STALE' | 'FAILED';
  source_id: string;
  last_checked_at: string | null;
}

export interface MasterTimelineEvent {
  institution_id: string | null;
  event_type: 'LICENSED' | 'MERGED' | 'ACQUIRED' | 'RENAMED' | 'LISTED' | 'DELISTED' | 'SUSPENDED' | 'HEAD_OFFICE_MOVED';
  title: string;
  occurred_at: string | null;
  summary: string;
  source_id: string;
  predecessor_id: string;
  predecessor_name: string;
}