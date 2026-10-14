// ============================================================================
// Phase 2 (M2.2) — deterministic regulatory + coverage alerts, plus P4-1
// evidence-conflict alerts. PURE domain module (no infra imports, no randomness,
// no AI): rows of facts with evidence anchors derived from the generated NRB
// ledger, the pilot control-room data, and the open conflict registers of the
// evidence layer. No free-text summaries, no recommender heuristics.
// See docs/PHASE-2-DESIGN.md §2 and docs/AI-ABOVE-EVIDENCE.md.
// ============================================================================

import type { CrawlSource, NrbRegulatoryEvent } from "@/types";

export type AlertKind = "REGULATORY_EVENT" | "COVERAGE" | "EVIDENCE_CONFLICT";
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

/**
 * Combined feed: evidence conflicts first (an unresolved disagreement outranks
 * any single-record signal), then coverage, then regulatory events. Each group
 * is sorted by severity then recency; conflicts carry no date so they sort by
 * id. Deterministic (separated groups, never interleaved).
 */
export function buildAlerts(
  events: NrbRegulatoryEvent[],
  sources: CrawlSource[],
  conflicts: ConflictAlertInput[] = [],
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
  ];
}

export function countBySeverity(alerts: AlertItem[]): Record<AlertSeverity, number> {
  const out: Record<AlertSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const a of alerts) out[a.severity] += 1;
  return out;
}