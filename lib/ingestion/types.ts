// ============================================================================
// Ingestion domain types (Phase C) — generic capability-driven model.
// Mozilla-public-suffix-free, institution-agnostic: an MFB is just an
// institution_id + a set of capabilities. NOTHING here is per-MFB.
// No infrastructure imports: fetch/AI/HTML/PDF live behind the contract
// (lib/ingestion/contract.ts), never inside the domain types.
// ============================================================================

/** The capability types an ingestion source can expose. */
export const CAPABILITY_KINDS = [
  "WEBSITE",
  "SITEMAP",
  "DOCUMENT_ARCHIVE",
  "REPORTS",
  "BRANCH_DIRECTORY",
  "CAREER_PAGE",
  "NEWS",
  "SOCIAL",
  "API",
  "RSS",
  "PEOPLE",
] as const;

export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/** Evidence status — mirrors official_links/social_accounts.status vocabulary. */
export type EvidenceStatus = "CANDIDATE" | "VERIFIED" | "STALE" | "FAILED";

/** Maps a capability kind to the official_links.link_type CHECK vocabulary. */
export const CAPABILITY_TO_LINK_TYPE: Record<CapabilityKind, string> = {
  WEBSITE: "WEBSITE",
  SITEMAP: "OTHER",
  DOCUMENT_ARCHIVE: "REPORT_PAGE",
  REPORTS: "REPORT_PAGE",
  BRANCH_DIRECTORY: "BRANCH_PAGE",
  CAREER_PAGE: "CAREER_PAGE",
  NEWS: "NOTICE_BOARD",
  SOCIAL: "OTHER",
  API: "PORTAL",
  RSS: "OTHER",
  PEOPLE: "OTHER",
};

/**
 * One capability on a source. `knownUrl === null` means a DISCOVERY INTENT:
 * Phase F must locate a real page/URL before any fetch happens. A non-null URL
 * must trace to a real backing evidence record (never fabricated).
 */
export interface CapabilitySpec {
  kind: CapabilityKind;
  status: EvidenceStatus;
  /** Real, evidence-backed URL — or null while still a discovery intent. */
  knownUrl: string | null;
  /** official_links.link_type this capability would manifest as. */
  linkType?: string;
  note?: string;
}

/**
 * Hard per-run crawl budget (Phase O). ALL limits are configuration values,
 * never per-institution code — the thresholds live in config_json.budget so
 * operators bound discovery without touching the engine.
 */
export interface CrawlBudget {
  /** Discovered URLs to consider (hard cap, default 50). */
  maxTargets?: number;
  /** Total fetches per run (hard cap above discovery). */
  maxFetches?: number;
  /** Document-type items processed per run (REPORTS/DOCUMENT_ARCHIVE). */
  maxDocuments?: number;
  /** Per-response body cap in bytes (default 5 MB). */
  maxBytes?: number;
  /** Allowed redirect hops per fetch (default 5). */
  maxRedirects?: number;
  /** Retry attempts for transient fetcher failures (default 2). */
  maxRetries?: number;
  /** Wall-clock budget for the whole run in ms — stop starting new targets. */
  maxRuntimeMs?: number;
}

/** An ingestion source definition (mirrors ingestion_sources.config_json). */
export interface IngestionSourceSpec {
  id: string;
  url: string;
  domain?: string;
  sourceType: "NRB" | "MFB_WEBSITE" | "MFB_DOCUMENT" | "NEPSE" | "DATA_PROVIDER" | "MEDIA" | "SOCIAL" | "KHABAR";
  institutionId?: string;
  enabled: boolean;
  fetchIntervalMinutes: number;
  capabilities: CapabilitySpec[];
  /** Optional per-run crawl budget (config_json.budget). Defaults in engine. */
  budget?: CrawlBudget;
}

// ---------------------------------------------------------------------------
// Pipeline payloads (flow: fetch → evidence → discovery → extract → validate)
// ---------------------------------------------------------------------------

export interface FetchResult {
  finalUrl: string;
  httpStatus: number | null;
  contentType: string | null;
  /** sha-256 hex of the raw body; "" when the fetch failed pre-body. */
  contentHash: string;
  bodyBytes: number;
  /** Raw untrusted bytes — the evidence handed to discovery + extraction. */
  body: Uint8Array;
  fetchedAt: string;
  redirectCount: number;
  error?: FetchError;
}

export interface FetchError {
  type:
    | "UNSUPPORTED_PROTOCOL"
    | "BLOCKED_HOST"
    | "BLOCKED_NETWORK"
    | "TOO_MANY_REDIRECTS"
    | "DNS_FAILURE"
    | "CONNECT_FAILED"
    | "TIMEOUT"
    | "HTTP_ERROR"
    | "BODY_TOO_LARGE"
    | "EMPTY_BODY";
  message: string;
}

/** How a URL was discovered — must be traceable for provenance (Phase F). */
export type DiscoveryMethod =
  | "KNOWN" //        configured direct URL (capability.knownUrl)
  | "REL_CANONICAL" // canonical link tag on a fetched page
  | "SITEMAP" //      entry in a sitemap
  | "ROBOTS" //       robots.txt sitemap directive
  | "LINK" //         hyperlink on a fetched page
  | "CONFIG"; //      declared in an ingestion_sources config

export interface DiscoveredTarget {
  capability: CapabilityKind;
  url: string;
  method: DiscoveryMethod;
  /** The page/URL that yielded this target (null for KNOWN/CONFIG roots). */
  parentUrl: string | null;
  sourceId: string;
  institutionId?: string;
  discoveredAt: string;
  title?: string;
  status: EvidenceStatus;
}

export type ExtractedKind = "LINK" | "DOCUMENT" | "FIELD" | "TEXT";

export interface ExtractedEvidence {
  kind: ExtractedKind;
  capability: CapabilityKind;
  sourceUrl: string;
  /** Optional domesticated field name (e.g. a people role). When present it
   * overrides `capability` as the assertion field name — keeps capabilities
   * page-shaped while letting extractors name semantic fields (Phase R3). */
  field?: string;
  /** For DOCUMENT: relative/absolute href to the document. */
  href?: string;
  text?: string;
  documentType?: string;
  /** Optional structured metadata attached to a LINK (e.g. the date and
   * filesize an archive listing row carries) — persisted verbatim onto the
   * outbound_links row so the ledger can project it deterministically. */
  description?: string;
  confidence: number; // 0..1 — low confidence must NOT become an assertion
  parserId: string;
  extractedAt: string;
}

export interface ValidationOutcome {
  status: "PASS" | "FAIL" | "PENDING";
  severity: "error" | "warning" | "info";
  ruleId: string;
  message?: string;
  evidence: unknown;
}

/** Ingestion lifecycle state (Phase I) — the visible-to-persist state machine. */
export type IngestionLifecycle =
  | "DISCOVERED"
  | "QUEUED"
  | "FETCHING"
  | "FETCHED"
  | "CHANGED"
  | "UNCHANGED"
  | "EXTRACTING"
  | "EXTRACTED"
  | "VALIDATING"
  | "VALIDATED"
  | "CONFLICT"
  | "FAILED"
  | "RETRYING"
  | "COMPLETED";