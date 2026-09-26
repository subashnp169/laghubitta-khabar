// ============================================================================
// Phase 2 (M2.1) — institution comparison acceptance. Fixture-only: no real
// data, no network, no AI. Proves lib/compare.ts derives a deterministic
// side-by-side model from the three generated modules:
//   01 identity/geo/capital passthrough from institutions
//   02 web evidence merged per institution via crawl source (branch/vacancy/docs/
//      snapshots/status)
//   03 NRB footprint: matched documents via links, regulatory events per
//      institution
//   04 missing data is null (renders "—"), never 0/fabricated
//   05 numeric leaders recomputed over the current selection
//   06 selectCompare preserves requested order and ignores unknown ids
// ============================================================================

import {
  buildCompareModel,
  recomputeLeaders,
  selectCompare,
  type CompareInstitution,
  type CompareModel,
} from "../lib/compare";
import type { CrawlSource, Institution, NrbDocument, NrbInstitutionLink, NrbRegulatoryEvent } from "../src/types";

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL ${label}`);
  }
}
const eq = (got: string | number | null, want: string | number | null, label: string): void => ok(got === want, `${label} (=${want})`);

const institutions: Institution[] = [
  {
    serial: 1, id: "mfi-a", slug: "a", name: "A Microfinance Ltd.", sourceNameRaw: "A Microfinance Ltd.",
    licenseClass: "D", licenseStatus: "licensed", operationDate: "2000-01-01", operationDateIsJointAfterMerger: false,
    headOffice: "Kathmandu", paidUpCapitalCrore: 100, workingArea: "National Level", officialWebsite: null,
    websiteStatus: "candidate", aliases: [], evidence: {}, coverageType: "national", operationDateStatus: "source_published",
  },
  {
    serial: 2, id: "mfi-b", slug: "b", name: "B Microfinance Ltd.", sourceNameRaw: "B Microfinance Ltd.",
    licenseClass: "D", licenseStatus: "licensed", operationDate: "2005-05-05", operationDateIsJointAfterMerger: true,
    headOffice: "Pokhara", paidUpCapitalCrore: 200, workingArea: "National Level", officialWebsite: null,
    websiteStatus: "candidate", aliases: [], evidence: {}, coverageType: "national", operationDateStatus: "source_published",
  },
  {
    serial: 3, id: "mfi-c", slug: "c", name: "C Microfinance Ltd.", sourceNameRaw: "C Microfinance Ltd.",
    licenseClass: "D", licenseStatus: "licensed", operationDate: "2010-10-10", operationDateIsJointAfterMerger: false,
    headOffice: "Butwal", paidUpCapitalCrore: 50, workingArea: "Province Level", officialWebsite: null,
    websiteStatus: "candidate", aliases: [], evidence: {}, coverageType: "province", operationDateStatus: "source_published",
  },
];

const crawl: CrawlSource[] = [
  {
    sourceId: "a-website", institutionId: "mfi-a", website: "https://a.test", capabilities: ["WEBSITE", "NEWS"],
    capabilityPages: [], runs: 2, snapshots: 10, items: 12, documents: 3, errors: 0, changedItems: 1, discoveredUrls: 4,
    status: "HEALTHY", lastStatus: "SUCCESS", lastRun: "2026-09-26T00:00:00Z", branchCount: 5, vacancyCount: 2,
    documentCount: 3, branchNames: [], vacancyTitles: [], documentTitles: [], cadenceMinutes: 60,
    cadenceBuckets: [60], cadenceBucket: "frequent", nextDueAt: "2026-09-26T01:00:00Z", isDue: true, paused: false,
  },
  {
    sourceId: "c-website", institutionId: "mfi-c", website: "https://c.test", capabilities: ["WEBSITE"],
    capabilityPages: [], runs: 1, snapshots: 3, items: 5, documents: 0, errors: 1, changedItems: 0, discoveredUrls: 2,
    status: "DEGRADED", lastStatus: "PARTIAL", lastRun: "2026-09-25T00:00:00Z", branchCount: 2, vacancyCount: 0,
    documentCount: 0, branchNames: [], vacancyTitles: [], documentTitles: [], cadenceMinutes: 1440,
    cadenceBuckets: [1440], cadenceBucket: "periodic", nextDueAt: "2026-09-26T00:00:00Z", isDue: false, paused: false,
  },
];

const nrbDocuments: NrbDocument[] = [
  { id: "d1", title: "Doc One", docType: "REPORT", topic: null, officialUrl: "https://nrb.test/1", publishedAt: null, size: "1MB", sourceId: "s1", sourceTitle: "S1" },
  { id: "d2", title: "Doc Two", docType: "KFI", topic: null, officialUrl: "https://nrb.test/2", publishedAt: null, size: null, sourceId: "s1", sourceTitle: "S1" },
];
const nrbLinks: NrbInstitutionLink[] = [
  { id: "l1", institutionId: "mfi-a", institutionSlug: "a", institutionName: "A", linkType: "REPORT", linkDate: null, nrbDocumentId: "d1" },
  { id: "l2", institutionId: "mfi-b", institutionSlug: "b", institutionName: "B", linkType: "KFI", linkDate: null, nrbDocumentId: "d2" },
];
const nrbEvents: NrbRegulatoryEvent[] = [
  { id: "e1", institutionId: "mfi-a", institutionSlug: "a", institutionName: "A", eventType: "MERGED", title: "Merged", occurredAt: null, description: "x" },
  { id: "e2", institutionId: "mfi-a", institutionSlug: "a", institutionName: "A", eventType: "RENAMED", title: "Renamed", occurredAt: null, description: "y" },
  { id: "e3", institutionId: "mfi-b", institutionSlug: "b", institutionName: "B", eventType: "MERGED", title: "Merged", occurredAt: null, description: "z" },
];

console.log("smoke:compare — full model");
const model = buildCompareModel(institutions, crawl, { documents: nrbDocuments, links: nrbLinks, events: nrbEvents });
ok(model.institutions.length === 3, "3 institutions in model");
ok(model.metrics.length > 0, "metrics defined");
const byId = (m: CompareModel, id: string): CompareInstitution => m.institutions.find((i) => i.id === id) as CompareInstitution;
const a = byId(model, "mfi-a");
const b = byId(model, "mfi-b");
const c = byId(model, "mfi-c");

eq(a.series.paidUpCapitalCrore as number, 100, "mfi-a capital passthrough");
eq(a.series.workingArea as string, "National Level", "mfi-a working area");
eq(a.series.branchCount as number, 5, "mfi-a branch from crawl");
eq(a.series.snapshots as number, 10, "mfi-a snapshots from crawl");
eq(a.series.lastStatus as string, "HEALTHY", "mfi-a source status");
eq(a.series.nrbDocuments as number, 1, "mfi-a NRB docs matched (via link)");
eq(a.series.nrbEvents as number, 2, "mfi-a regulatory events count");
eq(b.series.paidUpCapitalCrore as number, 200, "mfi-b capital");
eq(b.series.branchCount, null, "mfi-b no crawl -> branch null");
eq(b.series.nrbDocuments as number, 1, "mfi-b NRB docs matched");
eq(b.series.nrbEvents as number, 1, "mfi-b events");
eq(c.series.branchCount as number, 2, "mfi-c branch from crawl");
eq(c.series.vacancyCount as number, 0, "mfi-c vacancy present (0 is a real value)");
eq(c.series.nrbDocuments, null, "mfi-c no NRB links -> docs null (not 0)");
eq(c.series.nrbEvents, null, "mfi-c no events -> null");
eq(c.series.lastStatus as string, "DEGRADED", "mfi-c status from crawl");

console.log("smoke:compare — leaders (max over selection)");
ok(model.leaders.paidUpCapitalCrore === "mfi-b", "capital leader mfi-b");
ok(model.leaders.branchCount === "mfi-a", "branch leader mfi-a");
ok(model.leaders.nrbEvents === "mfi-a", "events leader mfi-a");
ok(model.leaders.licenseClass === null, "text metric has no leader");

console.log("smoke:compare — subset + leader recompute");
const sub = selectCompare(model, ["mfi-c", "mfi-a"]);
ok(sub.institutions.length === 2 && sub.institutions[0].id === "mfi-c" && sub.institutions[1].id === "mfi-a", "subset preserves requested order");
ok(sub.leaders.paidUpCapitalCrore === "mfi-a", "leaders recomputed on subset (a wins over c)");
ok(sub.leaders.branchCount === "mfi-a", "branch leader within subset");
const unknown = selectCompare(model, ["mfi-zz", "mfi-b", "mfi-b"]);
ok(unknown.institutions.length === 1 && unknown.institutions[0].id === "mfi-b", "unknown ids ignored, duplicates dropped");

console.log("smoke:compare — recomputeLeaders purity");
ok(recomputeLeaders(sub).leaders.nrbEvents === "mfi-a", "recompute works standalone");

console.log(`\nsmoke:compare: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);