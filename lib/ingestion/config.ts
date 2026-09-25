// ============================================================================
// Capability config parsing (Phase C) — pure domain logic. Turns an
// ingestion_sources.config_json blob into typed CapabilitySpec[] and rejects
// unknown capability kinds or invented (non-evidence-backed) URLs.
//
// DETERMINISTIC CAPABILITY CONTRACT (S09):
//   - enabled      : the ONLY switch that disables a source. config_json never
//                    disables; a disabled source short-circuits in runSource.
//   - config_json.capabilities is the authoritative capability model.
//   - '{}' or missing 'capabilities'  ⇒ NO capability override supplied ⇒ the
//                    source declares ZERO capabilities. It does NOT mean
//                    "all capabilities enabled" and does NOT disable the run.
//                    A zero-capability source is valid and discovers nothing.
//   - ''/null config_json ⇒ same as '{}' (no override).
//   - malformed (non-empty, not-JSON) config_json ⇒ CapabilityConfigError.
//                    Fail loudly; never silently degrade a corrupted config.
//   - unknown capability kind ⇒ CapabilityConfigError (loud, per entry).
//   - known_url, when present, must be an https:// URL backed by evidence.
// ============================================================================

import {
  CAPABILITY_KINDS,
  CAPABILITY_TO_LINK_TYPE,
  type CapabilityKind,
  type CapabilitySpec,
  type CrawlBudget,
  type EvidenceStatus,
  type IngestionSourceSpec,
} from "./types";

const STATUSES: ReadonlySet<string> = new Set(["CANDIDATE", "VERIFIED", "STALE", "FAILED"]);
const KINDS: ReadonlySet<string> = new Set(CAPABILITY_KINDS);

export class CapabilityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityConfigError";
  }
}

/**
 * Parse one capability entry from config JSON. A plain string shorthand
 * ("WEBSITE") is accepted and becomes a CANDIDATE discovery intent with no
 * known URL. Throws CapabilityConfigError on an unknown kind or a malformed
 * status so a bad config fails loudly instead of silently inventing a
 * capability.
 */
function parseCapability(raw: unknown, context: string): CapabilitySpec {
  if (typeof raw === "string") {
    if (!KINDS.has(raw)) {
      throw new CapabilityConfigError(`${context}: unknown capability kind ${JSON.stringify(raw)}`);
    }
    return { kind: raw as CapabilityKind, status: "CANDIDATE", knownUrl: null };
  }
  if (typeof raw !== "object" || raw === null) {
    throw new CapabilityConfigError(`${context}: capability must be an object or a kind string`);
  }
  const c = raw as Record<string, unknown>;
  const kind = c.kind ?? c.capability;
  if (typeof kind !== "string" || !KINDS.has(kind)) {
    throw new CapabilityConfigError(`${context}: unknown capability kind ${JSON.stringify(kind)}`);
  }
  const status = typeof c.status === "string" && STATUSES.has(c.status) ? (c.status as EvidenceStatus) : "CANDIDATE";
  const knownUrl = c.knownUrl ?? c.known_url ?? c.url ?? null;
  if (knownUrl !== null && typeof knownUrl !== "string") {
    throw new CapabilityConfigError(`${context}: known_url must be a string or null`);
  }
  if (typeof knownUrl === "string" && !/^https:\/\//i.test(knownUrl)) {
    throw new CapabilityConfigError(`${context}: known_url must be https:// (got ${knownUrl})`);
  }
  const linkType = typeof c.linkType === "string" ? c.linkType : CAPABILITY_TO_LINK_TYPE[kind as CapabilityKind];
  const note = typeof c.note === "string" ? c.note : undefined;
  return { kind: kind as CapabilityKind, status, knownUrl, linkType, note };
}

/** Parse `config_json.capabilities` (or an array directly) into typed specs. */
export function parseCapabilities(config: unknown): CapabilitySpec[] {
  const raw =
    typeof config === "object" && config !== null && "capabilities" in config
      ? (config as { capabilities: unknown }).capabilities
      : config;
  if (!Array.isArray(raw)) return [];
  return raw.map((c, i) => parseCapability(c, `capabilities[${i}]`));
}

/**
 * Build an IngestionSourceSpec from a DB-shaped row (ingestion_sources) and its
 * config_json string. Institution-agnostic: same shape for NRB + any MFB.
 */
export function buildIngestionSourceSpec(row: {
  id: string;
  url: string;
  domain?: string | null;
  source_type: string;
  institution_id?: string | null;
  config_json?: string | null;
  enabled?: number | null;
  fetch_interval_minutes?: number | null;
}): IngestionSourceSpec {
  let config: unknown = {};
  if (row.config_json) {
    try {
      config = JSON.parse(row.config_json);
    } catch {
      // LOUD, never silent: a non-empty config_json that is not valid JSON is a
      // corrupted config, NOT a "no override" signal. Do not degrade to {}.
      throw new CapabilityConfigError(
        `ingestion source ${row.id}: config_json is not valid JSON (${String(row.config_json).slice(0, 80)})`,
      );
    }
  }
  return {
    id: row.id,
    url: row.url,
    domain: row.domain ?? undefined,
    sourceType: row.source_type as IngestionSourceSpec["sourceType"],
    institutionId: row.institution_id ?? undefined,
    enabled: (row.enabled ?? 1) === 1,
    fetchIntervalMinutes: row.fetch_interval_minutes ?? 1440,
    capabilities: parseCapabilities(config),
    budget: parseBudget(
      (typeof config === "object" && config !== null && "budget" in config)
        ? (config as { budget: unknown }).budget
        : undefined,
    ),
  };
}

const KNOWN_BUDGET_KEYS = new Set([
  "maxTargets", "maxFetches", "maxDocuments", "maxBytes", "maxRedirects", "maxRetries", "maxRuntimeMs",
]);

/** Parse `config_json.budget` (an object of positive ints) into CrawlBudget. */
export function parseBudget(budget: unknown): CrawlBudget | undefined {
  if (typeof budget !== "object" || budget === null) return undefined;
  const b = budget as Record<string, unknown>;
  const out: CrawlBudget = {};
  for (const [k, v] of Object.entries(b)) {
    if (!KNOWN_BUDGET_KEYS.has(k)) {
      throw new CapabilityConfigError(`budget: unknown key ${JSON.stringify(k)}`);
    }
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      throw new CapabilityConfigError(`budget.${k}: must be a positive integer`);
    }
    (out as Record<string, number>)[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Terse capability model for diagnostics / health views. */
export function capabilitySummary(spec: IngestionSourceSpec): string[] {
  return spec.capabilities.map((c) =>
    c.knownUrl ? `${c.kind}=${c.status}` : `${c.kind}?discover`,
  );
}

/** Capability kinds with a resolved (evidence-backed) URL — eligible to fetch. */
export function resolvableCapabilities(spec: IngestionSourceSpec): CapabilitySpec[] {
  return spec.capabilities.filter((c) => c.knownUrl !== null);
}

/** Capability kinds still awaiting discovery — no fetch, no invented URL. */
export function pendingCapabilities(spec: IngestionSourceSpec): CapabilitySpec[] {
  return spec.capabilities.filter((c) => c.knownUrl === null);
}