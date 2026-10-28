// ============================================================================
// Phase 2 (M2.2) — deterministic regulatory + coverage alerts, plus P4-1
// evidence-conflict alerts. PURE domain module (no infra imports, no randomness,
// no AI): rows of facts with evidence anchors derived from the generated NRB
// ledger, the pilot control-room data, and the open conflict registers of the
// evidence layer. No free-text summaries, no recommender heuristics.
// See docs/PHASE-2-DESIGN.md §2 and docs/AI-ABOVE-EVIDENCE.md.
// ============================================================================

import type { CrawlSource, NrbRegulatoryEvent } from "@/types";
import type { DiffChange } from "./diff";
import type { StaleSource } from "@/data/stale-sources";

export type AlertKind = "REGULATORY_EVENT" | "COVERAGE" | "EVIDENCE_CONFLICT" | "SNAPSHOT_DIFF" | "STALE_SOURCE";
export type AlertSeverity = "high" | "medium" | "low";

export const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

export interface AlertItem {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  institutionId: string | null;
  institutionSlug: string | null;
  institutionName: string | null;
  /** ISO instant the alert became true; nullable for derived state alerts. */
  occurredAt: string | null;
  /** Evidence anchor or related page. */
  source: string | null;
}

function eventSeverity(eventType: string): AlertSeverity {
  if (eventType === "MERGED" || eventType === "ACQUIRED") return "high";
  if (eventType === "RENAMED") return "medium";
  return "medium";
}

function eventTitle(eventType: string): string {
  switch (eventType) {
    case "MERGED":
      return "Regulatory merger event";
    case "ACQUIRED":
      return "Regulatory acquisition event";
    case "RENAMED":
      return "Regulatory rename event";
    default:
      return `Regulatory event (${eventType})`;
  }
}

/** One alert per NRB regulatory event, newest first (occurredAt desc, id tiebreak). */
export function buildEventAlerts(events: NrbRegulatoryEvent[]): AlertItem[] {
  const sorted = [...events].sort((a, b) => {
    const ta = a.occurredAt ?? "";
    const tb = b.occurredAt ?? "";
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  });
  return sorted.map((e) => ({
    id: `evt-${e.id}`,
    kind: "REGULATORY_EVENT" as const,
    severity: eventSeverity(e.eventType),
    title: eventTitle(e.eventType),
    detail: e.title || e.description || "(event title unavailable)",
    institutionId: e.institutionId,
    institutionSlug: e.institutionSlug,
    institutionName: e.institutionName,
    occurredAt: e.occurredAt ?? null,
    source: e.description || e.title || null,
  }));
}

const COVERAGE_TITLES: Record<string, { severity: AlertSeverity; title: string; detail: (s: CrawlSource) => string }> = {
  UNHEALTHY: {
    severity: "high",
    title: "Source flagged unhealthy",
    detail: (s) => `last run failed repeatedly (${s.errors} errors, ${s.snapshots} snapshots)`,
  },
  DEGRADED: {
    severity: "medium",
    title: "Source degraded",
    detail: (s) => `last run ${s.lastStatus ?? "FAILED"} with partial or no extraction (${s.errors} errors)`,
  },
  "NEVER-RUN": {
    severity: "medium",
    title: "Source never run",
    detail: () => "registered but no ingestion evidence produced yet",
  },
};

/** Coverage alerts from the control-room snapshot (health status derivation). */
export function buildCoverageAlerts(sources: CrawlSource[]): AlertItem[] {
  const out: AlertItem[] = [];
  for (const s of sources) {
    const rule = COVERAGE_TITLES[s.status];
    if (!rule) continue;
    out.push({
      id: `cov-${s.sourceId}`,
      kind: "COVERAGE",
      severity: rule.severity,
      title: rule.title,
      detail: rule.detail(s),
      institutionId: s.institutionId,
      institutionSlug: s.institutionId,
      institutionName: null,
      occurredAt: s.lastRun ?? null,
      source: "control room · /ingestion",
    });
  }
  return out.sort((a, b) => {
    if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return a.occurredAt && b.occurredAt ? (a.occurredAt < b.occurredAt ? 1 : -1) : 0;
  });
}

// ---------------------------------------------------------------------------
// Evidence conflicts (P4-1).
//
// The one alert kind that is driven by a *disagreement in the evidence layer*
// rather than by a single record. Each input is an already-open conflict the
// data modules carry (`open{Branch,People,Financial,Document}Conflicts`): two or
// more sources assert the same field of the same record with different values.
//
// The producer is deliberately thin and cannot fabricate. It emits one high
// severity alert per open conflict and nothing else: no inferred cause, no
// chosen side, and — because the evidence layer records no timestamp for when a
// disagreement arose — **no `occurredAt`**. An alert that invented a date would
// be exactly the dishonesty this kind exists to prevent.
// ---------------------------------------------------------------------------

export type ConflictRecordType = "branch" | "person" | "financial" | "document";

export interface ConflictAlertInput {
  /** Stable identity of the conflicted row (entity id or `institution|field`). */
  id: string;
  recordType: ConflictRecordType;
  /** The field two sources disagree on, as the evidence layer names it. */
  field: string;
  institutionId: string | null;
  institutionSlug: string | null;
  institutionName: string | null;
}

const CONFLICT_RECORD_LABEL: Record<ConflictRecordType, string> = {
  branch: "branch",
  person: "leadership",
  financial: "financial",
  document: "document",
};

/** One alert per open evidence conflict. Order in = a deterministic order out. */
export function buildConflictAlerts(conflicts: ConflictAlertInput[]): AlertItem[] {
  return conflicts.map((c) => {
    const label = CONFLICT_RECORD_LABEL[c.recordType];
    return {
      id: `conf-${c.recordType}-${c.id}-${c.field}`,
      kind: "EVIDENCE_CONFLICT" as const,
      // A disagreement between sources is a correctness risk, not a style
      // choice: it is ranked with the highest severity until it is resolved.
      severity: "high" as const,
      title: `Conflicting ${label} evidence`,
      detail: `Two or more sources assert “${c.field}” differently for this ${label}; the disagreement is recorded and unresolved.`,
      institutionId: c.institutionId,
      institutionSlug: c.institutionSlug,
      institutionName: c.institutionName,
      // Unknown, and left unknown: the evidence layer does not timestamp when a
      // conflict appeared, so any date here would be fabricated.
      occurredAt: null,
      source: "evidence layer · unresolved conflict",
    };
  });
}

// ---------------------------------------------------------------------------
// Snapshot-diff alerts (P4-1).
//
// "What changed since the last run" — derived from a real diff of two dated
// evidence databases, not from a guess. Each change carries the REAL
// `observed_at` of the row that moved; a change whose row has no timestamp is
// dropped rather than given a fabricated date. The producer is thin: one alert
// per changed assertion identity, with the before/after values in the detail so a
// reader can see exactly what moved.
// ---------------------------------------------------------------------------
export function buildDiffAlerts(changes: DiffChange[]): AlertItem[] {
  const out: AlertItem[] = [];
  for (const c of changes) {
    const instMatch = c.entityId.match(/mfi-\d+/i);
    const institutionId = instMatch ? instMatch[0].toLowerCase() : null;
    const verb = c.kind === "added" ? "added" : "removed";
    out.push({
      id: `diff-${c.kind}-${c.entityType}-${c.entityId}-${c.fieldName}-${c.value}`.slice(0, 120),
      kind: "SNAPSHOT_DIFF",
      severity: c.kind === "removed" ? "medium" : "low",
      title: `Evidence ${verb}: ${c.fieldName}`,
      detail: `${c.entityType} ${c.entityId} — “${c.fieldName}” ${verb} “${c.value}” (source ${c.sourceId}).`,
      institutionId,
      institutionSlug: null,
      institutionName: null,
      occurredAt: c.observedAt,
      source: "snapshot diff · dated evidence runs",
    });
  }
  return out.sort((a, b) => {
    const ta = a.occurredAt ?? "";
    const tb = b.occurredAt ?? "";
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// Stale-source alerts (V1.1).
//
// "A source has not been re-run within its field group's refresh window." Each
// stale (source, field-group) pair becomes one alert carrying the REAL
// last-successful-run timestamp. Nothing is invented.
// ---------------------------------------------------------------------------
export function buildStaleSourceAlerts(stale: StaleSource[]): AlertItem[] {
  const out: AlertItem[] = [];
  for (const s of stale) {
    out.push({
      id: `stale-${s.source}-${s.groups.join("+")}`,
      kind: "STALE_SOURCE",
      severity: s.days > 30 ? "medium" : "low",
      title: `Source stale: ${s.source}`,
      detail: `${s.source} has not run successfully in ${s.days} day(s); stale for ${s.groups.join(", ")}.`,
      institutionId: null,
      institutionSlug: null,
      institutionName: null,
      occurredAt: s.lastRun,
      source: "ingestion runs · field_refresh_policies",
    });
  }
  return out.sort((a, b) => {
    const ta = a.occurredAt ?? "";
    const tb = b.occurredAt ?? "";
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * Combined feed: evidence conflicts first (an unresolved disagreement outranks
 * any single-record signal), then coverage, then regulatory events, then
 * snapshot-diff changes. Each group is sorted by severity then recency; conflicts
 * carry no date so they sort by id. Deterministic (separated groups, never
 * interleaved).
 */
export function buildAlerts(
  events: NrbRegulatoryEvent[],
  sources: CrawlSource[],
  conflicts: ConflictAlertInput[] = [],
  diffChanges: DiffChange[] = [],
  staleSources: StaleSource[] = [],
): AlertItem[] {
  const sortGroup = (items: AlertItem[]): AlertItem[] =>
    [...items].sort((a, b) => {
      if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      const ta = a.occurredAt ?? "";
      const tb = b.occurredAt ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    });
  return [
    ...sortGroup(buildConflictAlerts(conflicts)),
    ...sortGroup(buildCoverageAlerts(sources)),
    ...sortGroup(buildEventAlerts(events)),
    ...sortGroup(buildDiffAlerts(diffChanges)),
    ...sortGroup(buildStaleSourceAlerts(staleSources)),
  ];
}

export function countBySeverity(alerts: AlertItem[]): Record<AlertSeverity, number> {
  const out: Record<AlertSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const a of alerts) out[a.severity] += 1;
  return out;
}