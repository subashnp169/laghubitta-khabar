// ============================================================================
// Ingestion contract (Phase D) — replaceable implementations behind thin seams.
// The domain model (types.ts) + orchestrator depend on THESE interfaces only.
// Cloudflare fetch, HTML parsing, PDF libs, AI, and storage adapters implement
// them; they are never imported by the domain.
// ============================================================================

import type {
  CapabilitySpec,
  CrawlBudget,
  DiscoveredTarget,
  ExtractedEvidence,
  FetchResult,
  IngestionSourceSpec,
  ValidationOutcome,
} from "./types";

// ---------------------------------------------------------------------------
// Source registry: where instrument-config resolution happens (no per-MFB code).
// ---------------------------------------------------------------------------

export interface SourceRegistry {
  /** All enabled ingestion sources (ingestion_sources where enabled=1). */
  listEnabled(): Promise<IngestionSourceSpec[]>;
  /** A single source by its ingestion_sources.id. */
  get(id: string): Promise<IngestionSourceSpec | null>;
  /** Capabilities declared for a source (config_json.capabilities). */
  capabilitiesOf(id: string): Promise<CapabilitySpec[]>;
  /** Last content hash seen for a source+url — drives Phase H idempotency. */
  lastContentHash(sourceId: string, url: string): Promise<string | null>;
  /** Last known health snapshot for a source (Phase K). */
  healthOf(id: string): Promise<SourceHealth | null>;
  /** Record a policy outcome for a source (run completion, health updates). */
  recordRun(outcome: RunOutcome): Promise<void>;
}

export interface SourceHealth {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  lastHttpStatus: number | null;
  lastContentHash: string | null;
  nextRetryAt: string | null;
}

export interface RunOutcome {
  sourceId: string;
  startedAt: string;
  completedAt: string;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL";
  itemsFound: number;
  itemsChanged: number;
  itemsNew: number;
  itemsFailed: number;
  parserVersion?: string;
  errorCount: number;
}

// ---------------------------------------------------------------------------
// Fetcher (Phase E): CONTROLLED fetch. Ownership of safety lives here.
// ---------------------------------------------------------------------------

export interface FetchOptions {
  expectHtml?: boolean;
  expectPdf?: boolean;
  /** Cap the response body in bytes (default 5 MB). */
  maxBytes?: number;
  /** Overall wall-clock timeout in ms (default 15 s). */
  timeoutMs?: number;
  /** Allowed redirect hops (default 5). */
  maxRedirects?: number;
  explicitHost?: string; // host allowlist override (null = source host only)
}

export interface Fetcher {
  fetch(url: string, opts?: FetchOptions): Promise<FetchResult>;
}

// ---------------------------------------------------------------------------
// Canonicalizer (Phase Q): deterministic comparison hash for CHANGE DETECTION.
// Raw evidence is NEVER replaced by its canonical form — the feed stores raw
// bytes+hash; only the idempotency comparison may use this derived hash.
// ---------------------------------------------------------------------------

export interface Canonicalizer {
  /**
   * Derived comparison hash. HTML → hash of a deterministic canonical text
   * form; any non-HTML document (PDF, …) → hash of the raw bytes (identity).
   */
  hash(contentType: string | null, body: Uint8Array): Promise<string>;
}

// ---------------------------------------------------------------------------
// Discovery (Phase F): produces traceable targets — never a generic crawl.
// ---------------------------------------------------------------------------

export interface Discovery {
  /**
   * Given a fetched source page + declared capabilities, return the evidence-
   * backed URLs to ingest. Each target carries method/parent/source provenance.
   */
  discover(
    source: IngestionSourceSpec,
    opts?: DiscoveryOptions,
  ): Promise<DiscoveredTarget[]>;
}

export interface DiscoveryOptions {
  /** Per-run bound — never "the whole website". */
  maxTargets?: number;
  /** Only these capability kinds (defaults: all declared eligible ones). */
  only?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Extractor (Phase G/H): deterministic extraction from one fetched document.
// Returns evidence; the workflow decides what persists.
// ---------------------------------------------------------------------------

export interface ExtractionContext {
  sourceId: string;
  institutionId?: string;
  /** Regulatory/regulator-scoped marker (e.g. "NRB" for nrb.org.np) — lets
   * institution-agnostic parsers self-limit to a source family. Additive. */
  sourceType?: string;
  capability: string;
  url: string;
  parserId: string;
  contentHash: string;
}

export interface Extractor {
  extract(context: ExtractionContext, body: Uint8Array): Promise<ExtractedEvidence[]>;
  /** Parser identity — recorded in parsingVersion / snapshot rows. */
  readonly parserId: string;
}

// ---------------------------------------------------------------------------
// Validator (Phase I): a validation rule; results persist via EvidenceWriter.
// ---------------------------------------------------------------------------

export interface Validator {
  ruleId: string;
  severity: "error" | "warning" | "info";
  validate(context: ValidationContext): Promise<ValidationOutcome>;
}

export interface ValidationContext {
  sourceId: string;
  institutionId?: string;
  targetType: string;
  targetId: string;
  evidence: ExtractedEvidence[];
}

// ---------------------------------------------------------------------------
// EvidenceWriter (Phase G): the ONLY way evidence lands in durable tables.
// Implementations: local sqlite (scripts/smoke) + D1 (Worker).
// ---------------------------------------------------------------------------

export interface EvidenceWriter {
  saveSnapshot(input: SnapshotInput): Promise<string>;
  /** Update a snapshot's extraction state after extraction completes (or fails). */
  updateExtractionStatus(snapshotId: string, status: SnapshotInput["extractionStatus"]): Promise<void>;
  saveItem(input: ItemInput): Promise<void>;
  saveAssertion(input: AssertionInput): Promise<void>;
  saveConflict(input: ConflictInput): Promise<void>;
  saveValidation(input: ValidationInput): Promise<void>;
  saveError(input: ErrorInput): Promise<void>;
  appendAudit(input: AuditInput): Promise<void>;
  /**
   * Persist the durable link-first document record for a fetched non-HTML
   * document (target_type=DOCUMENT). Scope + slug identify the ONE logical
   * link; repeated sightings update content_hash/availability on that same row
   * while the versioned evidence lives in source_snapshots.
   */
  saveOutboundLink(input: OutboundLinkInput): Promise<void>;
  /**
   * The stored assertion rows for one semantic slot, newest observation last.
   *
   * This is the deterministic LOOKUP that makes idempotency a read-then-write
   * decision instead of a blind insert. The frozen schema has no uniqueness
   * constraint on data_assertions, so an equivalent assertion can only be
   * recognised by looking at what is already stored.
   */
  findAssertions(input: {
    entityType: string;
    entityId: string;
    fieldName: string;
    sourceId?: string;
  }): Promise<StoredAssertion[]>;
  /**
   * Close out ONE assertion as superseded: stamp valid_to and move it to the
   * STALE status the frozen vocabulary already allows.
   *
   * This never deletes. A superseded assertion stays readable with its original
   * value, source and snapshot, which is the point: a branch that changed must
   * leave the earlier observation auditable, and a branch that was renamed must
   * leave the old identity readable as history.
   */
  supersedeAssertion(input: {
    id: string;
    validTo: string;
    status?: "STALE" | "CONFLICT" | "REJECTED";
    reason?: string;
  }): Promise<boolean>;
  /**
   * The most recent snapshot for a source with a given canonical content hash,
   * or null. Used to reuse an existing snapshot instead of appending a
   * byte-identical one, and to re-point assertions at it.
   */
  findSnapshotByContentHash(sourceId: string, contentHash: string): Promise<string | null>;
  /**
   * Make a SUPERSEDED assertion current again, for a value that has come back.
   *
   * An assertion's identity is (entity, field, source, value), so a value that
   * reverts — Credit, then Risk, then Credit again — resolves to the row that
   * was already written and closed out. Re-inserting it is a no-op against
   * `INSERT OR IGNORE`, which would leave the field with no current claim at all
   * and silently drop it from the read model. Reviving is the only correct
   * outcome: the same claim is true again, observed later.
   *
   * Optional. A writer that cannot revive returns false, and the caller falls
   * back to inserting, which is correct for a claim never seen before.
   */
  reviveAssertion?(input: {
    id: string;
    observedAt: string;
    sourceSnapshotId: string;
    confidence: number;
  }): Promise<boolean>;
}

/** One stored assertion, as the deterministic lookup returns it. */
export interface StoredAssertion {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  value: string;
  source_id: string;
  source_snapshot_id: string | null;
  observed_at: string;
  valid_to: string | null;
  verification_status: string;
}

/** Mirrors outbound_links; a discovered official document link (+ check state). */
export interface OutboundLinkInput {
  scopeKey: string;
  institutionId?: string;
  slug: string;
  targetType: "WEBSITE" | "DOCUMENT" | "JOB" | "DIRECTIVE" | "NOTICE" | "SOCIAL" | "OTHER";
  label: string;
  targetUrl: string;
  canonicalUrl?: string;
  contentHash?: string;
  availabilityStatus?: "AVAILABLE" | "MISSING" | "MOVED" | "UNKNOWN";
  sourceId: string;
  firstSeenAt: string;
  lastCheckedAt?: string;
  description?: string;
}

export interface SnapshotInput {
  sourceId: string;
  fetchedAt: string;
  contentHash: string;
  httpStatus: number | null;
  mimeType: string | null;
  r2Key: string | null;
  parserVersion: string | null;
  extractionStatus: "PENDING" | "EXTRACTED" | "FAILED" | "SKIPPED";
}

export interface ItemInput {
  runId: string;
  url: string;
  itemType: string;
  status: "NEW" | "CHANGED" | "UNCHANGED" | "FAILED";
  contentHash?: string;
}

export interface AssertionInput {
  entityType: string;
  entityId: string;
  fieldName: string;
  value: string;
  sourceId: string;
  sourceSnapshotId: string;
  observedAt: string;
  confidence: number;
  verificationStatus: "UNVERIFIED" | "AUTO_VERIFIED" | "HUMAN_VERIFIED" | "CONFLICT" | "STALE" | "REJECTED";
}

export interface ConflictInput {
  entityType: string;
  entityId: string;
  fieldName: string;
  sourceAId: string;
  valueA: string;
  sourceBId: string;
  valueB: string;
  detectedAt: string;
  resolutionStatus: "OPEN" | "RESOLVED" | "IGNORED";
  resolutionNote?: string;
}

export interface ValidationInput {
  targetType: string;
  targetId: string;
  ruleId: string;
  severity: string;
  status: "PASS" | "FAIL" | "PENDING";
  message?: string;
  evidenceJson: string;
}

export interface ErrorInput {
  runId: string;
  sourceId?: string;
  url?: string;
  errorType: string;
  errorMessage: string;
  retryCount: number;
}

export interface AuditInput {
  action: string; // e.g. INGESTION_REQUESTED, FETCH_COMPLETED (Phase J)
  targetType: string;
  targetId: string;
  beforeJson?: string;
  afterJson?: string;
}

// ---------------------------------------------------------------------------
// Notification (Phase J): operational events; replaceable (log / admin / none).
// ---------------------------------------------------------------------------

export interface Notification {
  notify(event: OperationalEvent): Promise<void>;
}

export interface OperationalEvent {
  id: string;
  kind:
    | "INGESTION_REQUESTED"
    | "INGESTION_STARTED"
    | "FETCH_COMPLETED"
    | "FETCH_FAILED"
    | "DOCUMENT_DISCOVERED"
    | "DOCUMENT_CHANGED"
    | "EXTRACTION_COMPLETED"
    | "VALIDATION_FAILED"
    | "DATA_CHANGED"
    | "CONFLICT_DETECTED"
    | "CACHE_INVALIDATED"
    | "INGESTION_COMPLETED";
  sourceId?: string;
  runId?: string;
  itemUrl?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: { type: string; message: string };
  version: number;
}

// ---------------------------------------------------------------------------
// Orchestrator: one generic pipeline for ANY source (no per-MFB branches).
// ---------------------------------------------------------------------------

export interface EngineDeps {
  registry: SourceRegistry;
  fetcher: Fetcher;
  discovery: {
    discover(source: IngestionSourceSpec): Promise<DiscoveredTarget[]>;
  };
  extractor: {
    parserId: string;
    extract(ctx: {
      sourceId: string;
      institutionId?: string;
      sourceType?: string;
      capability: string;
      url: string;
      parserId: string;
      contentHash: string;
      body: Uint8Array;
    }): Promise<ExtractedEvidence[]>;
  };
  writer: EvidenceWriter;
  now?: () => string;
  /**
   * Deterministic change-detection hasher. When absent, the engine compares raw
   * content hashes (Phase H behaviour). When present, HTML comparisons use the
   * canonical form while raw evidence is still stored untouched.
   */
  canonicalizer?: Canonicalizer;
  /**
   * Deterministic validation rules (Phase I): run AFTER extraction, BEFORE
   * assertion, attached to the evidence snapshot. Absent → none run.
   */
  validators?: ReadonlyArray<Validator>;
}

export interface IngestionEngine {
  runSource(sourceId: string, opts?: EngineOptions): Promise<EngineResult>;
}

export interface EngineOptions {
  /** Override the crawler's discovered-target cap for this run. */
  maxTargets?: number;
  /** Per-run crawl budget (overrides source.config_json.budget for this run). */
  budget?: CrawlBudget;
  dryRun?: boolean; // discover + fetch only; never persist
  now?: string; // injectable clock for deterministic tests
}

export interface EngineResult {
  sourceId: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  targetsDiscovered: number;
  items: EngineItemResult[];
  ok: boolean;
  errors: ErrorInput[];
}

export interface EngineItemResult {
  url: string;
  capability: string;
  lifecycle: string; // IngestionLifecycle
  contentHash?: string;
  persisted: boolean;
}