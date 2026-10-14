// ============================================================================
// Phase 2 (M2.2) + P4-1 — alert derivation acceptance. Fixture-only:
// deterministic, no network, no AI. Proves lib/alerts.ts emits fact-backged
// alert rows:
//   01 regulatory events newest-first, severity map (MERGED/ACQUIRED=high,
//      RENAMED=medium), missing occurredAt sorts last
//   02 coverage derivation: UNHEALTHY=high, DEGRADED=medium, NEVER-RUN=medium,
//      HEALTHY excluded
//   03 evidence conflicts (P4-1): one high alert per open conflict, no invented
//      occurredAt, and an empty register yields nothing
//   04 combined feed groups conflicts, then coverage, then events
//   05 severity counters
// ============================================================================

import {
  buildAlerts,
  buildConflictAlerts,
  buildCoverageAlerts,
  buildEventAlerts,
  countBySeverity,
} from "../lib/alerts";
import type { ConflictAlertInput } from "../lib/alerts";
import type { CrawlSource, NrbRegulatoryEvent } from "../src/types";

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL ${label}`);
  }
}

const events: NrbRegulatoryEvent[] = [
  {
    id: "e1", institutionId: "mfi-a", institutionSlug: "a", institutionName: "A Microfinance",
    eventType: "MERGED", title: "Merged", occurredAt: "2026-01-05", description: "Merged with X",
  },
  {
    id: "e2", institutionId: "mfi-a", institutionSlug: "a", institutionName: "A Microfinance",
    eventType: "RENAMED", title: "Renamed", occurredAt: null, description: "Renamed to Z",
  },
  {
    id: "e3", institutionId: "mfi-b", institutionSlug: "b", institutionName: "B Microfinance",
    eventType: "ACQUIRED", title: "Acquired", occurredAt: "2026-06-20", description: "",
  },
];

const crawl: CrawlSource[] = [
  {
    sourceId: "a-site", institutionId: "mfi-a", website: "https://a.test", capabilities: ["WEBSITE"],
    capabilityPages: [], runs: 3, snapshots: 2, items: 0, documents: 0, errors: 5, changedItems: 0, discoveredUrls: 1,
    status: "UNHEALTHY", lastStatus: "FAILED", lastRun: "2026-09-01T00:00:00Z", branchCount: 0, vacancyCount: 0,
    documentCount: 0, peopleCount: 0, branchNames: [], vacancyTitles: [], documentTitles: [], peopleNames: [], cadenceMinutes: 1440,
    cadenceBuckets: [1440], cadenceBucket: "periodic", nextDueAt: "2026-09-02T00:00:00Z", isDue: true, paused: false,
  },
  {
    sourceId: "b-site", institutionId: "mfi-b", website: "https://b.test", capabilities: ["WEBSITE"],
    capabilityPages: [], runs: 2, snapshots: 1, items: 1, documents: 0, errors: 2, changedItems: 1, discoveredUrls: 2,
    status: "DEGRADED", lastStatus: "PARTIAL", lastRun: "2026-08-30T00:00:00Z", branchCount: 1, vacancyCount: 0,
    documentCount: 0, peopleCount: 0, branchNames: [], vacancyTitles: [], documentTitles: [], peopleNames: [], cadenceMinutes: 1440,
    cadenceBuckets: [1440], cadenceBucket: "periodic", nextDueAt: "2026-08-31T00:00:00Z", isDue: false, paused: false,
  },
  {
    sourceId: "c-site", institutionId: "mfi-c", website: "https://c.test", capabilities: ["NEWS"],
    capabilityPages: [], runs: 0, snapshots: 0, items: 0, documents: 0, errors: 0, changedItems: 0, discoveredUrls: 0,
    status: "NEVER-RUN", lastStatus: "NEVER-RUN", lastRun: null, branchCount: 0, vacancyCount: 0,
    documentCount: 0, peopleCount: 0, branchNames: [], vacancyTitles: [], documentTitles: [], peopleNames: [], cadenceMinutes: 60,
    cadenceBuckets: [60], cadenceBucket: "frequent", nextDueAt: null, isDue: true, paused: false,
  },
  {
    sourceId: "d-site", institutionId: "mfi-d", website: "https://d.test", capabilities: ["WEBSITE"],
    capabilityPages: [], runs: 9, snapshots: 20, items: 30, documents: 2, errors: 0, changedItems: 0, discoveredUrls: 10,
    status: "HEALTHY", lastStatus: "SUCCESS", lastRun: "2026-09-25T00:00:00Z", branchCount: 4, vacancyCount: 2,
    documentCount: 2, peopleCount: 0, branchNames: [], vacancyTitles: [], documentTitles: [], peopleNames: [], cadenceMinutes: 60,
    cadenceBuckets: [60], cadenceBucket: "frequent", nextDueAt: "2026-09-26T00:00:00Z", isDue: true, paused: false,
  },
];

console.log("smoke:alerts — regulatory events");
const evts = buildEventAlerts(events);
ok(evts.length === 3, "3 event alerts");
ok(evts.map((a) => a.id).join(",") === "evt-e3,evt-e1,evt-e2", "newest first, null date last");
ok(evts[0].severity === "high" && evts[1].severity === "high" && evts[2].severity === "medium", "MERGED/ACQUIRED high, RENAMED medium");
ok(evts[0].institutionName === "B Microfinance" && evts[0].occurredAt === "2026-06-20", "fields passthrough");
ok(evts[2].occurredAt === null, "null occurredAt preserved");
ok(evts[0].source === "Acquired", "source falls back to title when description null");

console.log("smoke:alerts — coverage");
const cov = buildCoverageAlerts(crawl);
ok(cov.length === 3, "3 coverage alerts (HEALTHY excluded)");
ok(cov[0].severity === "high" && cov[0].id === "cov-a-site", "UNHEALTHY first (high)");
ok(cov[2].id === "cov-c-site" && cov[2].severity === "medium", "NEVER-RUN included, medium");
ok(cov.some((a) => a.detail.includes("(5 errors, 2 snapshots)")), "detail embeds evidence numbers");
ok(cov.every((a) => a.source === "control room · /ingestion"), "evidence anchor attached");

console.log("smoke:alerts — evidence conflicts");
const conflicts: ConflictAlertInput[] = [
  {
    id: "mfi-001|kumaripati branch|lalitpur",
    recordType: "branch",
    field: "branch_name",
    institutionId: "mfi-a",
    institutionSlug: "a",
    institutionName: "A Microfinance",
  },
  {
    id: "mfi-b|ceo",
    recordType: "person",
    field: "ceo_name",
    institutionId: "mfi-b",
    institutionSlug: "b",
    institutionName: "B Microfinance",
  },
];
const conf = buildConflictAlerts(conflicts);
ok(conf.length === 2, "one alert per open conflict");
ok(conf.every((a) => a.kind === "EVIDENCE_CONFLICT"), "kind is EVIDENCE_CONFLICT");
ok(conf.every((a) => a.severity === "high"), "unresolved conflict is high severity");
ok(conf.every((a) => a.occurredAt === null), "no invented occurredAt");
ok(conf.every((a) => a.source === "evidence layer · unresolved conflict"), "evidence anchor attached");
ok(conf[0].title === "Conflicting branch evidence", "record type named in the title");
ok(conf[1].title === "Conflicting leadership evidence", "person conflict reads as leadership");
ok(new Set(conf.map((a) => a.id)).size === 2, "conflict ids unique");
ok(buildConflictAlerts([]).length === 0, "no conflicts -> no alerts (never fabricated)");
const conf2 = buildConflictAlerts(conflicts);
ok(conf.map((a) => a.id).join(",") === conf2.map((a) => a.id).join(","), "conflict order deterministic");

console.log("smoke:alerts — combined feed");
const feed = buildAlerts(events, crawl, conflicts);
ok(feed.length === 8, "8 total alerts with conflicts");
ok(feed[0].kind === "EVIDENCE_CONFLICT" && feed[0].severity === "high", "conflicts group first, high first");
ok(feed[2].kind === "COVERAGE" && feed[2].severity === "high", "coverage grouped after conflicts");
ok(feed[5].kind === "REGULATORY_EVENT", "events grouped last");
ok(feed[5].occurredAt === "2026-06-20", "event group itself newest-first");
const idsOnce = new Set(feed.map((a) => a.id));
ok(idsOnce.size === feed.length, "unique alert ids");
const feed2 = buildAlerts(events, crawl, conflicts);
ok(feed.map((a) => a.id).join(",") === feed2.map((a) => a.id).join(","), "deterministic across calls");
// Back-compat: the two-argument call (no conflicts) still yields the original 6.
const feedNoConf = buildAlerts(events, crawl);
ok(feedNoConf.length === 6 && feedNoConf.every((a) => a.kind !== "EVIDENCE_CONFLICT"), "no conflicts param -> 6, none fabricated");

console.log("smoke:alerts — counters");
const counts = countBySeverity(feed);
ok(counts.high === 5 && counts.medium === 3 && counts.low === 0, "severity counters match");

console.log(`\nsmoke:alerts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);