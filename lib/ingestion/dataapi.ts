// ============================================================================
// Data-API ingestion (M3.2) — deterministic HTTP ingestion of JS-backed sites.
// A site that renders only via client-side JS (Vite/React shell, zero anchor
// text) is not "unreachable": its backing JSON API is discoverable from the
// inert bundle and ingests with the same evidence conventions as HTML.
// No browser. No AI. HTTPS GET of config-declared routes only.
// ============================================================================

import { CAPABILITY_KINDS, type CapabilityKind, type CrawlBudget, type ExtractedEvidence, type IngestionSourceSpec, type ValidationOutcome } from "./types";
import type {
  AssertionInput,
  ErrorInput,
  EvidenceWriter,
  Fetcher,
  FetchOptions,
  OutboundLinkInput,
  SourceRegistry,
  Validator,
} from "./contract";
import { cleanCell, extractPeopleJson } from "./people";

export const DATA_API_PARSER_ID = "json-api-v1";

const KIND_SET: ReadonlySet<string> = new Set(CAPABILITY_KINDS);
// Identity fields ≥ 0.5 confidence become UNVERIFIED assertions; volatile
// attributes stay evidence-only (mirrors lib/ingestion/structured.ts floors).
const IDENTITY_CONFIDENCE = 0.6;
const ATTRIBUTE_CONFIDENCE = 0.45;

const BRANCH_KEYS: Record<string, string[]> = {
  name: ["name", "nameEn", "name_eng", "name_en", "branch", "branch_name", "title"],
  district: ["district", "जिल्ला"],
  place: ["place", "address", "location", "addressPlace", "address_place", "city", "स्थान", "ठेगाना"],
  phone: ["phone", "contact", "contactNo", "contact_no", "tel", "telephone", "mobile", "फोन"],
};
const NEWS_TITLE_KEYS = ["title", "noticeTitle", "notice_title", "headline", "topic", "subject", "name"];
const NEWS_ATTACHMENT_KEYS = ["fileCon", "file", "attachment", "fileUrl", "file_url", "document", "pdf"];
const VACANCY_TITLE_KEYS = ["title", "position", "positionName", "position_name", "vacancy", "vacancy_name", "jobTitle", "job_title"];
const VACANCY_DEADLINE_KEYS = ["deadline", "appliedBefore", "apply_before", "lastDate", "last_date", "closingDate"];
const VACANCY_AVAILABLE_KEYS = ["vacancyAvailable", "vacancy_available", "isOpen", "is_open", "open", "enabled"];
const VACANCY_PORTAL_KEYS = ["portalUrl", "portal_url", "applyUrl", "apply_url", "link"];
const TRUTHY = new Set(["1", "true", "yes", "open", "active", "y"]);

export class DataApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataApiConfigError";
  }
}

/** One declared capability → route pair (frozen at config parse time). */
export interface DataApiRoute {
  capability: CapabilityKind;
  path: string;
}

/** Validated `config_json.data_api` block. Null means "not configured". */
export interface DataApiConfig {
  provenance?: string;
  baseUrl: string;
  /** Normalized hostname of baseUrl. */
  host: string;
  /** Bare domains the source fetcher policy must additionally allow. */
  hosts: string[];
  routes: DataApiRoute[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * Strict parse of config_json.data_api. Absent → null (no behaviour change);
 * malformed → DataApiConfigError (loud, mirrors CapabilityConfigError).
 */
export function parseDataApiConfig(configJson: unknown): DataApiConfig | null {
  const root = asRecord(configJson);
  if (!root || root.data_api === undefined || root.data_api === null) return null;
  const cfg = asRecord(root.data_api);
  if (!cfg) throw new DataApiConfigError("data_api must be an object");

  const baseUrlRaw = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";
  let parsed: URL;
  try {
    parsed = new URL(baseUrlRaw);
  } catch {
    throw new DataApiConfigError(`data_api.baseUrl must be a valid URL (got ${JSON.stringify(baseUrlRaw)})`);
  }
  if (parsed.protocol !== "https:") throw new DataApiConfigError(`data_api.baseUrl must be https:// (got ${parsed.protocol})`);
  if (parsed.username || parsed.password) throw new DataApiConfigError("data_api.baseUrl must not carry credentials");
  if (parsed.port && parsed.port !== "443") throw new DataApiConfigError(`data_api.baseUrl must be port 443 (got ${parsed.port})`);
  const host = parsed.hostname.toLowerCase();

  if (!Array.isArray(cfg.hosts) || cfg.hosts.length === 0) {
    throw new DataApiConfigError("data_api.hosts must be a non-empty array of bare domains");
  }
  const hosts: string[] = [];
  for (const h of cfg.hosts) {
    if (typeof h !== "string" || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h) || /[/:]/.test(h)) {
      throw new DataApiConfigError(`data_api.hosts entry must be a bare domain (got ${JSON.stringify(h)})`);
    }
    hosts.push(h.toLowerCase());
  }
  if (!hosts.includes(host)) throw new DataApiConfigError(`data_api.hosts must include the baseUrl hostname ${host}`);

  const provenance = typeof cfg.provenance === "string" ? cfg.provenance.slice(0, 200) : undefined;

  if (!Array.isArray(cfg.routes) || cfg.routes.length === 0) {
    throw new DataApiConfigError("data_api.routes must be a non-empty array");
  }
  const seen = new Set<string>();
  const routes: DataApiRoute[] = [];
  for (const r of cfg.routes) {
    const route = asRecord(r);
    if (!route) throw new DataApiConfigError("data_api.routes entry must be an object");
    const { capability, path } = route as { capability?: unknown; path?: unknown };
    if (typeof capability !== "string" || !KIND_SET.has(capability)) {
      throw new DataApiConfigError(`data_api route: unknown capability kind ${JSON.stringify(capability)}`);
    }
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new DataApiConfigError(`data_api route ${String(capability)}: path must start with / (got ${JSON.stringify(path)})`);
    }
    if (seen.has(path)) continue;
    seen.add(path);
    routes.push({ capability: capability as CapabilityKind, path });
  }
  if (routes.length === 0) throw new DataApiConfigError("data_api.routes empty after deduplication");
  return { provenance, baseUrl: parsed.href, host, hosts, routes };
}

/** Deterministic link slug — mirrors the engine's documentSlug exactly. */
export function dataApiDocumentSlug(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep the raw string; normalization still applies */
  }
  const slug = path.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return (slug || "document").slice(0, 80);
}

function emptyValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim().length === 0);
}

function clean(v: unknown): string {
  return cleanCell(typeof v === "string" ? v : emptyValue(v) ? "" : String(v));
}

function pickString(item: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function truthy(item: Record<string, unknown>, keys: string[]): boolean {
  for (const k of keys) {
    const v = item[k];
    if (v === true) return true;
    if (typeof v === "string" && TRUTHY.has(v.trim().toLowerCase())) return true;
    if (typeof v === "number" && v > 0) return true;
  }
  return false;
}

/** Resolve an item URL against the API base (absolute or base-relative). */
function absoluteUrl(raw: string, baseUrl: string): string | null {
  try {
    const u = new URL(raw, baseUrl);
    if (u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Route URL relative to the API base: a base with a path segment (e.g.
 * https://host/api) must keep that segment — new URL("/branch", base) would
 * drop it. Deterministic: base pathname + route path.
 */
export function dataApiRouteUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  return new URL(`${basePath}${path}`, base.origin).href;
}

/** Normalize a JSON payload into item objects (array, {data:[…]}, or first array value). */
function itemsOf(payload: unknown): Record<string, unknown>[] {
  const objs = (arr: unknown[]): Record<string, unknown>[] =>
    arr.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
  if (Array.isArray(payload)) return objs(payload);
  const obj = asRecord(payload);
  if (!obj) return [];
  const pref = ["data", "items", "list", "records", "rows", "results"];
  for (const k of pref) if (Array.isArray(obj[k])) return objs(obj[k] as unknown[]);
  const first = Object.values(obj).find((v) => Array.isArray(v) && (v as unknown[]).length > 0);
  return first ? objs(first as unknown[]) : [];
}

/** Evidence + document links extracted from one route's JSON payload. */
export interface DataApiExtraction {
  evidence: ExtractedEvidence[];
  docs: Array<{ targetUrl: string; label?: string; targetType: OutboundLinkInput["targetType"] }>;
}

/**
 * Generic, capability-shaped extractor (json-api-v1). Mirrors the field
 * vocabulary of lib/ingestion/structured.ts so downstream counters/models
 * (branch_name, vacancy_title, document_title) light up unchanged.
 */
export function extractDataApiPayload(
  payload: unknown,
  capability: CapabilityKind,
  ctx: { sourceUrl: string; parserId?: string; extractedAt: string },
): DataApiExtraction {
  const parserId = ctx.parserId ?? DATA_API_PARSER_ID;
  const ev: ExtractedEvidence[] = [];
  const docs: DataApiExtraction["docs"] = [];
  const seen = new Set<string>();
  const emit = (field: string, text: string, conf: number, src: string): void => {
    const key = `${field}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    ev.push({ kind: "FIELD", capability, field, sourceUrl: src, text, confidence: conf, parserId, extractedAt: ctx.extractedAt });
  };

  if (capability === "BRANCH_DIRECTORY") {
    for (const item of itemsOf(payload)) {
      const name = clean(pickString(item, BRANCH_KEYS.name));
      if (!name) continue;
      const src = ctx.sourceUrl;
      emit("BRANCH_NAME", name, IDENTITY_CONFIDENCE, src);
      const district = clean(pickString(item, BRANCH_KEYS.district));
      if (district) emit("BRANCH_DISTRICT", district, ATTRIBUTE_CONFIDENCE, src);
      const place = clean(pickString(item, BRANCH_KEYS.place));
      if (place) emit("BRANCH_PLACE", place, ATTRIBUTE_CONFIDENCE, src);
      const phone = clean(pickString(item, BRANCH_KEYS.phone));
      if (phone) emit("BRANCH_PHONE", phone, ATTRIBUTE_CONFIDENCE, src);
    }
    return { evidence: ev, docs };
  }

  if (capability === "NEWS") {
    for (const item of itemsOf(payload)) {
      const title = clean(pickString(item, NEWS_TITLE_KEYS));
      const attachment = pickString(item, NEWS_ATTACHMENT_KEYS);
      const src = ctx.sourceUrl;
      if (attachment) {
        const target = absoluteUrl(attachment, src);
        if (target) {
          docs.push({ targetUrl: target, label: title || `document at ${target}`, targetType: "DOCUMENT" });
          if (title) emit("DOCUMENT_TITLE", title, IDENTITY_CONFIDENCE, src);
        } else if (title) {
          emit("NOTICE_TITLE", title, IDENTITY_CONFIDENCE, src);
        }
      } else if (title) {
        emit("NOTICE_TITLE", title, IDENTITY_CONFIDENCE, src);
      }
    }
    return { evidence: ev, docs };
  }

  if (capability === "CAREER_PAGE") {
    const items = itemsOf(payload);
    if (items.length === 0 && asRecord(payload)) items.push(asRecord(payload) as Record<string, unknown>);
    for (const item of items) {
      const src = ctx.sourceUrl;
      if (!truthy(item, VACANCY_AVAILABLE_KEYS)) continue;
      const title = clean(pickString(item, VACANCY_TITLE_KEYS));
      if (title) emit("VACANCY_TITLE", title, IDENTITY_CONFIDENCE, src);
      const deadline = clean(pickString(item, VACANCY_DEADLINE_KEYS));
      if (deadline) emit("VACANCY_DEADLINE", deadline, ATTRIBUTE_CONFIDENCE, src);
      const portal = pickString(item, VACANCY_PORTAL_KEYS);
      const target = portal ? absoluteUrl(portal, src) : null;
      if (target) docs.push({ targetUrl: target, label: "career portal", targetType: "JOB" });
    }
    return { evidence: ev, docs };
  }

  if (capability === "PEOPLE") {
    return { evidence: extractPeopleJson(payload, ctx.sourceUrl, ctx.extractedAt), docs };
  }

  return { evidence: ev, docs };
}

// ---------------------------------------------------------------------------
// Run orchestration — mirrors the GenericIngestionEngine persistence phases,
// one ingestion_runs row + one item/snapshot per route, same writer, same
// UNVERIFIED/idempotency/evidence-first conventions.
// ---------------------------------------------------------------------------

export interface DataApiPassDeps {
  registry: SourceRegistry;
  fetcher: Fetcher;
  writer: EvidenceWriter;
  canonicalizer?: { hash(contentType: string | null, body: Uint8Array): Promise<string> };
  validators?: ReadonlyArray<Validator>;
  now?: () => string;
}

export interface DataApiPassOutcome {
  url: string;
  capability: CapabilityKind;
  lifecycle: string;
  contentHash?: string;
  errors: ErrorInput[];
}

export interface DataApiPassResult {
  runId: string;
  /** Successful (changed + unchanged) route outcomes. */
  processed: number;
  errors: ErrorInput[];
}

export interface DataApiPassOptions {
  source: IngestionSourceSpec;
  config: DataApiConfig;
  deps: DataApiPassDeps;
  budget?: CrawlBudget;
  dryRun?: boolean;
  now?: string;
}

/**
 * Fetch every configured route through the controlled fetcher, snapshot each
 * (evidence-first), parse + extract deterministically, run the injected
 * validators, and persist UNVERIFIED assertions + outbound document links —
 * exactly like the engine's processTarget but for config-declared JSON routes.
 */
export async function runDataApiPass(opts: DataApiPassOptions): Promise<DataApiPassResult> {
  const { source, config, deps, budget = {} } = opts;
  const now = opts.now ?? deps.now?.() ?? new Date().toISOString();
  // The pass registers its OWN run row through the same registry the engine
  // uses (id is derived as `run-<startedAt>-<sourceId>`), so its start time
  // steps one millisecond past the caller's clock — a distinct, adjacent,
  // deterministically ordered run that never collides with an engine run that
  // shared the same `now`.
  const startedAt = nextIsoMs(now);
  const runId = `run-${startedAt}-${source.id}`;
  const errors: ErrorInput[] = [];
  const outcomes: DataApiPassOutcome[] = [];
  const fetchOpts: FetchOptions = {
    ...(budget.maxBytes !== undefined ? { maxBytes: budget.maxBytes } : {}),
    ...(budget.maxRedirects !== undefined ? { maxRedirects: budget.maxRedirects } : {}),
  };

  await deps.registry.recordRun({
    sourceId: source.id, startedAt, completedAt: startedAt, status: "RUNNING",
    itemsFound: 0, itemsChanged: 0, itemsNew: 0, itemsFailed: 0, errorCount: 0,
  });
  await deps.writer.appendAudit({
    action: "DATA_API_STARTED", targetType: "ingestion_source", targetId: source.id,
    afterJson: JSON.stringify({ runId, baseUrl: config.baseUrl, routes: config.routes.map((r) => r.path) }),
  });

  for (const route of config.routes) {
    const url = dataApiRouteUrl(config.baseUrl, route.path);
    if (opts.dryRun) {
      outcomes.push({ url, capability: route.capability, lifecycle: "DISCOVERED", errors: [] });
      continue;
    }
    const outcome = await processRoute(source, config, deps, route, fetchOpts, runId, now);
    outcomes.push(outcome);
    errors.push(...outcome.errors);
  }

  const itemsChanged = outcomes.filter((o) => o.lifecycle === "CHANGED").length;
  const itemsFailed = outcomes.filter((o) => o.lifecycle === "FAILED").length;
  const status = errors.length === 0 ? "SUCCESS" : "PARTIAL";
  await deps.registry.recordRun({
    sourceId: source.id, startedAt, completedAt: startedAt, status,
    itemsFound: outcomes.length, itemsChanged, itemsNew: 0, itemsFailed,
    errorCount: errors.length, parserVersion: DATA_API_PARSER_ID,
  });
  await deps.writer.appendAudit({
    action: "DATA_API_COMPLETED", targetType: "ingestion_source", targetId: source.id,
    afterJson: JSON.stringify({ runId, routes: outcomes.length, changed: itemsChanged, failed: itemsFailed, errors: errors.length }),
  });
  return { runId, processed: outcomes.length - itemsFailed, errors };
}

function nextIsoMs(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t + 1).toISOString() : iso;
}

async function processRoute(
  source: IngestionSourceSpec,
  config: DataApiConfig,
  deps: DataApiPassDeps,
  route: DataApiRoute,
  fetchOpts: FetchOptions,
  runId: string,
  now: string,
): Promise<DataApiPassOutcome> {
  const url = dataApiRouteUrl(config.baseUrl, route.path);

  let fetched;
  try {
    fetched = await deps.fetcher.fetch(url, fetchOpts);
  } catch (e) {
    const err: ErrorInput = {
      runId, sourceId: source.id, url, errorType: "FETCH_FAILURE",
      errorMessage: (e as Error).message ?? String(e), retryCount: 0,
    };
    return { url, capability: route.capability, lifecycle: "FAILED", errors: [err] };
  }

  if (fetched.httpStatus === null || fetched.httpStatus >= 400) {
    await deps.writer.saveItem({ runId, url, itemType: route.capability, status: "FAILED", contentHash: fetched.contentHash || undefined });
    const err: ErrorInput = { runId, sourceId: source.id, url, errorType: "HTTP_ERROR", errorMessage: `HTTP ${fetched.httpStatus ?? "none"}`, retryCount: 0 };
    await deps.writer.saveError(err);
    return { url, capability: route.capability, lifecycle: "FAILED", contentHash: fetched.contentHash, errors: [err] };
  }

  const isJson = /json/i.test(fetched.contentType ?? "");
  const comparisonHash = deps.canonicalizer
    ? await deps.canonicalizer.hash("application/json", fetched.body)
    : fetched.contentHash;
  const prior = await deps.registry.lastContentHash(source.id, url);
  const unchanged = isJson && prior !== null && prior === comparisonHash;
  await deps.writer.saveItem({
    runId, url, itemType: route.capability, status: unchanged ? "UNCHANGED" : "CHANGED", contentHash: comparisonHash,
  });
  await deps.writer.appendAudit({
    action: "DATA_API_GOT", targetType: "ingestion_item", targetId: runId,
    afterJson: JSON.stringify({ url, status: fetched.httpStatus, mimeType: fetched.contentType, unchanged }),
  });
  if (unchanged) return { url, capability: route.capability, lifecycle: "UNCHANGED", contentHash: comparisonHash, errors: [] };

  const snapshotId = await deps.writer.saveSnapshot({
    sourceId: source.id, fetchedAt: fetched.fetchedAt, contentHash: fetched.contentHash,
    httpStatus: fetched.httpStatus, mimeType: fetched.contentType, r2Key: null,
    parserVersion: DATA_API_PARSER_ID, extractionStatus: "PENDING",
  });

  if (!isJson) {
    await deps.writer.updateExtractionStatus(snapshotId, "SKIPPED");
    const err: ErrorInput = { runId, sourceId: source.id, url, errorType: "EXTRACTION_FAILED", errorMessage: `expected JSON, got ${fetched.contentType ?? "unknown"}`, retryCount: 0 };
    await deps.writer.saveError(err);
    await deps.writer.appendAudit({ action: "EXTRACTION_FAILED", targetType: "ingestion_item", targetId: runId });
    return { url, capability: route.capability, lifecycle: "FAILED", contentHash: comparisonHash, errors: [err] };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(fetched.body));
  } catch (e) {
    await deps.writer.updateExtractionStatus(snapshotId, "FAILED");
    const err: ErrorInput = { runId, sourceId: source.id, url, errorType: "EXTRACTION_FAILED", errorMessage: `payload is not valid JSON: ${(e as Error).message}`, retryCount: 0 };
    await deps.writer.saveError(err);
    await deps.writer.appendAudit({ action: "EXTRACTION_FAILED", targetType: "ingestion_item", targetId: runId });
    return { url, capability: route.capability, lifecycle: "FAILED", contentHash: comparisonHash, errors: [err] };
  }

  const extraction = extractDataApiPayload(payload, route.capability, {
    sourceUrl: url, parserId: DATA_API_PARSER_ID, extractedAt: now,
  });
  await deps.writer.updateExtractionStatus(snapshotId, extraction.evidence.length > 0 ? "EXTRACTED" : "SKIPPED");
  await deps.writer.appendAudit({
    action: "EXTRACTION_COMPLETED", targetType: "ingestion_item", targetId: runId,
    afterJson: JSON.stringify({ url, evidenceCount: extraction.evidence.length, docs: extraction.docs.length }),
  });

  for (const v of deps.validators ?? []) {
    let outcome: ValidationOutcome;
    try {
      outcome = await v.validate({
        sourceId: source.id, institutionId: source.institutionId,
        targetType: "source_snapshot", targetId: snapshotId, evidence: extraction.evidence,
      });
    } catch (e) {
      outcome = { status: "FAIL", severity: v.severity, ruleId: v.ruleId, message: `validator threw: ${(e as Error).message ?? "unknown"}`, evidence: { error: String(e) } };
    }
    await deps.writer.saveValidation({
      targetType: "source_snapshot", targetId: snapshotId,
      ruleId: outcome.ruleId, severity: outcome.severity, status: outcome.status,
      message: outcome.message ?? undefined, evidenceJson: JSON.stringify(outcome.evidence ?? {}),
    });
  }

  const asserted = new Set<string>();
  for (const ev of extraction.evidence) {
    if (ev.kind !== "FIELD" || ev.confidence < 0.5) continue;
    const key = `${(ev.field ?? ev.capability).toLowerCase()}|${ev.text ?? ""}`;
    if (asserted.has(key)) continue;
    asserted.add(key);
    await deps.writer.saveAssertion({
      entityType: source.institutionId ? "institution" : "source",
      entityId: source.institutionId ?? source.id,
      fieldName: ev.field ? ev.field.toLowerCase() : ev.capability.toLowerCase(),
      value: ev.text ?? "", sourceId: source.id, sourceSnapshotId: snapshotId,
      observedAt: now, confidence: ev.confidence, verificationStatus: "UNVERIFIED",
    } as AssertionInput);
  }

  for (const doc of extraction.docs) {
    await deps.writer.saveOutboundLink({
      scopeKey: source.institutionId ?? source.id,
      institutionId: source.institutionId,
      slug: dataApiDocumentSlug(doc.targetUrl),
      targetType: doc.targetType,
      label: doc.label ?? `document at ${doc.targetUrl}`,
      targetUrl: doc.targetUrl,
      availabilityStatus: "UNKNOWN",
      sourceId: source.id, firstSeenAt: now, lastCheckedAt: now,
    } satisfies OutboundLinkInput);
  }

  return { url, capability: route.capability, lifecycle: "CHANGED", contentHash: comparisonHash, errors: [] };
}