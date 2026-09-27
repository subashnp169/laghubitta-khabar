// ============================================================================
// Ingestion scheduling (M1.6) — capability-driven cadence, pure domain module.
// No infrastructure imports (bookkeeping with lib/ingestion/types.ts only), so
// it is unit-testable and safe to reuse from scripts and future worker triggers.
//
// Semantics (see docs/INGESTION-OPERATIONS.md):
//   - A source refreshes as often as its tightest capability needs it.
//   - Cadence default = frozen map; per-source overrides ride config_json.schedule
//     (JSON only, no schema change); unknown keys/values fail loud.
// ============================================================================

import { CAPABILITY_KINDS, type CapabilityKind } from "./types";

/** Fallback cadence when a source exposes no recognized capability. */
export const DEFAULT_CADENCE_MINUTES = 1440;

/** Hard bounds for any cadence value (minutes), override or default. */
export const CADENCE_MIN_MINUTES = 15;
export const CADENCE_MAX_MINUTES = 43200;

/** Frozen default cadence per capability kind (docs/INGESTION-OPERATIONS.md §1). */
export const CAPABILITY_CADENCE_MINUTES: Record<CapabilityKind, number> = {
  WEBSITE: 1440,
  SITEMAP: 10080,
  DOCUMENT_ARCHIVE: 1440,
  REPORTS: 1440,
  BRANCH_DIRECTORY: 10080,
  CAREER_PAGE: 60,
  NEWS: 60,
  SOCIAL: 1440,
  API: 1440,
  RSS: 60,
  PEOPLE: 10080,
};

export type CadenceBucket = "frequent" | "periodic" | "slow";

const FREQUENT_MAX_MINUTES = 120;
const PERIODIC_MAX_MINUTES = 2880;

/**
 * Config-provided cadence overrides. Keys are capability kinds; only overrides
 * that differ from the frozen defaults appear.
 */
export type ScheduleOverrides = Partial<Record<CapabilityKind, number>>;

/** Raised for any malformed cadence config (fail loud, never silently ignore). */
export class ScheduleConfigError extends Error {
  constructor(message: string) {
    super(`schedule config: ${message}`);
    this.name = "ScheduleConfigError";
  }
}

function isCapabilityKind(value: string): value is CapabilityKind {
  return (CAPABILITY_KINDS as readonly string[]).includes(value);
}

/**
 * Read + validate `config_json.schedule`. Input is the raw config_json TEXT from
 * ingestion_sources; `.schedule` may be absent (→ {}). Non-JSON config_json or a
 * bad schedule payload throws ScheduleConfigError.
 */
export function parseScheduleOverrides(configJson: string): ScheduleOverrides {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    throw new ScheduleConfigError(`config_json is not valid JSON: ${configJson.slice(0, 80)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ScheduleConfigError("config_json must be a JSON object");
  }
  const raw = (parsed as { schedule?: unknown }).schedule;
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ScheduleConfigError("config_json.schedule must be a JSON object");
  }
  const out: ScheduleOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCapabilityKind(key)) {
      throw new ScheduleConfigError(`unknown capability kind "${key}" in schedule override`);
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new ScheduleConfigError(`schedule["${key}"] must be an integer minutes value`);
    }
    if (value < CADENCE_MIN_MINUTES || value > CADENCE_MAX_MINUTES) {
      throw new ScheduleConfigError(
        `schedule["${key}"] = ${value} out of range [${CADENCE_MIN_MINUTES}, ${CADENCE_MAX_MINUTES}]`,
      );
    }
    out[key] = value;
  }
  return out;
}

/** Cadence for one capability kind (override first), or null if the kind is unknown. */
export function capabilityCadenceMinutes(
  kind: CapabilityKind,
  overrides: ScheduleOverrides,
): number | null {
  return overrides[kind] ?? CAPABILITY_CADENCE_MINUTES[kind] ?? null;
}

/**
 * Effective source cadence = the minimum over the cadences of the source's
 * configured capability kinds (override first, frozen map second). A source with
 * no recognized capabilities falls back to DEFAULT_CADENCE_MINUTES.
 */
export function effectiveCadenceMinutes(
  capabilities: ReadonlyArray<{ capability: string }>,
  overrides: ScheduleOverrides = {},
): number {
  const cadences: number[] = [];
  for (const cap of capabilities) {
    if (isCapabilityKind(cap.capability)) {
      const c = capabilityCadenceMinutes(cap.capability, overrides);
      if (c !== null) cadences.push(c);
    }
  }
  if (cadences.length === 0) return DEFAULT_CADENCE_MINUTES;
  return Math.min(...cadences);
}

/** Sorted unique cadence values for a source's capabilities (for the control room). */
export function sourceCapabilityCadences(
  capabilities: ReadonlyArray<{ capability: string }>,
  overrides: ScheduleOverrides = {},
): number[] {
  const cadences = new Set<number>();
  for (const cap of capabilities) {
    if (isCapabilityKind(cap.capability)) {
      const c = capabilityCadenceMinutes(cap.capability, overrides);
      if (c !== null) cadences.add(c);
    }
  }
  return [...cadences].sort((a, b) => a - b);
}

export interface DueComputation {
  /** ISO instant the source is next due. Missing/absent last run → as-soon-as-possible. */
  nextDueAt: string;
  isDue: boolean;
}

/** Compute due-ness from the last successful run start and the effective cadence. */
export function computeDue(
  lastRunAt: string | null | undefined,
  cadenceMinutes: number,
  now: string,
): DueComputation {
  const nowMs = Date.parse(now);
  const safeNow = Number.isNaN(nowMs) ? Date.now() : nowMs;
  if (lastRunAt === null || lastRunAt === undefined) {
    return { nextDueAt: new Date(safeNow).toISOString(), isDue: true };
  }
  const lastMs = Date.parse(lastRunAt);
  if (Number.isNaN(lastMs)) {
    return { nextDueAt: new Date(safeNow).toISOString(), isDue: true };
  }
  const nextMs = lastMs + Math.max(1, cadenceMinutes) * 60_000;
  return {
    nextDueAt: new Date(nextMs).toISOString(),
    isDue: nextMs <= safeNow,
  };
}

/** Coarse cadence bucket for the control room (§1). */
export function cadenceBucket(minutes: number): CadenceBucket {
  if (minutes <= FREQUENT_MAX_MINUTES) return "frequent";
  if (minutes <= PERIODIC_MAX_MINUTES) return "periodic";
  return "slow";
}