// ============================================================================
// Phase 2 (M2.2) — deterministic regulatory + coverage alerts. PURE domain
// module (no infra imports, no randomness, no AI): rows of facts with evidence
// anchors derived from the generated NRB ledger and pilot control-room data.
// No free-text summaries, no recommender heuristics. See docs/PHASE-2-DESIGN.md §2.
// ============================================================================

import type { CrawlSource, NrbRegulatoryEvent } from "@/types";

export type AlertKind = "REGULATORY_EVENT" | "COVERAGE";
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

/**
 * Combined feed: coverage first by severity/recency, then regulatory events by
 * severity/recency. Deterministic (separated groups, never interleaved).
 */
export function buildAlerts(
  events: NrbRegulatoryEvent[],
  sources: CrawlSource[],
): AlertItem[] {
  const sortGroup = (items: AlertItem[]): AlertItem[] =>
    [...items].sort((a, b) => {
      if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      const ta = a.occurredAt ?? "";
      const tb = b.occurredAt ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    });
  return [...sortGroup(buildCoverageAlerts(sources)), ...sortGroup(buildEventAlerts(events))];
}

export function countBySeverity(alerts: AlertItem[]): Record<AlertSeverity, number> {
  const out: Record<AlertSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const a of alerts) out[a.severity] += 1;
  return out;
}