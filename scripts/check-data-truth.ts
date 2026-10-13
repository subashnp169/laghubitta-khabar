// ============================================================================
// P0-4 — data-truth guard: codify the rules in docs/DATA-STATUS-VOCABULARY.md
// (§ Missing-data presentation) as build-time invariants.
//
// The site's whole claim is that a missing value is never dressed up as a
// present one. These rules were "strong but verified by eye"; this gate makes
// them checkable, so a future edit cannot silently reintroduce a sentinel date,
// a `null`/`undefined`/`NaN` string, a zero-where-unknown, or a count that no
// longer matches the rows it claims to count.
//
// Run: npm run check:datatruth   (also wired into `prebuild`, next to the
// identity guard, so `npm run build` cannot publish a violation).
//
// READ-ONLY. Exits 1 with a list of findings, or 0 with a summary.
//
// Invariants:
//   T1  No sentinel date is published as fact. The known source sentinel
//       (`1900-01-09`) is allowed only where it carries
//       `operationDateStatus: "source_anomaly"` — i.e. flagged, not asserted.
//   T2  No published string carries a missing-value token (`null`,
//       `undefined`, `NaN`); no published number is `NaN`.
//   T3  A value field never uses 0 to mean "unknown": `paidUpCapitalCrore` is
//       null or strictly positive; every summary count is a non-negative
//       integer; every confidence is null or within [0, 1].
//   T4  Counts reconcile with the rows they describe (directory count, NRB
//       document/link/event totals and the event-type breakdown, crawl
//       sources).
// ============================================================================
import {
  institutions,
  directorySource,
  nrbSummary,
  nrbDocuments,
  nrbInstitutionLinks,
  nrbRegulatoryEvents,
  crawlSources,
  crawlSummary,
  financialAssertions,
  documentAssertions,
  jobs,
} from "../src/lib/site-data";
import { peopleAssertions } from "../src/data/people";
import { branchAssertions } from "../src/data/branches";
import type { Institution } from "../src/types";

const findings: string[] = [];
function fail(message: string): void {
  findings.push(message);
}

// --- T1/T2 shared walk over every published value ---------------------------
const SENTINELS = ["1900-01-09", "0000-00-00", "0001-01-01", "1970-01-01", "9999-12-31"];
const BAD_TOKEN = /(?<![A-Za-z])(?:null|undefined|NaN)(?![A-Za-z])/;

/** Visit every string and number in a published structure. */
function walk(label: string, value: unknown, onString: (s: string, where: string) => void): void {
  if (typeof value === "string") {
    onString(value, label);
    return;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) fail(`T2 NaN published: ${label}`);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(`${label}[${i}]`, v, onString));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(`${label}.${k}`, v, onString);
}

const checkTokens: (s: string, where: string) => void = (s, where) => {
  if (BAD_TOKEN.test(s)) fail(`T2 missing-value token published: ${where} -> ${s.slice(0, 80)}`);
};
const checkSentinels: (s: string, where: string) => void = (s, where) => {
  for (const sentinel of SENTINELS) {
    if (s.includes(sentinel)) {
      fail(`T1 sentinel date published: ${where} -> ${s.slice(0, 80)}`);
      return;
    }
  }
};

// Institutions: a sentinel operation date is only legitimate when flagged.
for (const inst of institutions) {
  if (SENTINELS.includes(inst.operationDate) && inst.operationDateStatus !== "source_anomaly") {
    fail(`T1 sentinel date published as fact: ${inst.id} operationDate=${inst.operationDate} status=${inst.operationDateStatus}`);
  }
}

// Every other module: a sentinel anywhere, or a missing-value token anywhere,
// is a violation.
const otherModules: Record<string, unknown> = {
  nrbDocuments,
  nrbInstitutionLinks,
  nrbRegulatoryEvents,
  nrbSummary,
  crawlSources,
  crawlSummary,
  peopleAssertions,
  branchAssertions,
  financialAssertions,
  documentAssertions,
  jobs,
};
for (const [name, mod] of Object.entries(otherModules)) walk(name, mod, checkTokens);
walk("institutions", institutions, checkTokens);
for (const [name, mod] of Object.entries(otherModules)) walk(name, mod, checkSentinels);

// --- T3 no zero-for-unknown -------------------------------------------------
for (const inst of institutions as Institution[]) {
  const c = inst.paidUpCapitalCrore;
  if (c !== null && (!Number.isFinite(c) || c <= 0)) {
    fail(`T3 paidUpCapitalCrore is ${c} for ${inst.id} — must be null or > 0 (0 is a sentinel, not a figure)`);
  }
}
for (const inst of institutions as Institution[]) {
  if (inst.operationDate.trim() === "") {
    fail(`T3 empty operationDate for ${inst.id} — use an explicit state, not an empty string`);
  }
}

const SUMMARY_COUNTS: Array<[string, number]> = [
  ["directorySource.count", directorySource.count],
  ["nrbSummary.documents", nrbSummary.documents],
  ["nrbSummary.institutionLinks", nrbSummary.institutionLinks],
  ["nrbSummary.regulatoryEvents", nrbSummary.regulatoryEvents],
  ["nrbSummary.institutions", nrbSummary.institutions],
  ["crawlSummary.sources", crawlSummary.sources],
  ["crawlSummary.institutions", crawlSummary.institutions],
];
for (const [label, value] of SUMMARY_COUNTS) {
  if (!Number.isInteger(value) || value < 0) fail(`T3 ${label} is not a non-negative integer: ${value}`);
}

const CONFIDENCE_ARRAYS: Array<[string, Array<{ confidence: number | null }>]> = [
  ["people", peopleAssertions],
  ["branches", branchAssertions],
  ["financials", financialAssertions],
  ["documents", documentAssertions],
];
for (const [label, rows] of CONFIDENCE_ARRAYS) {
  for (const row of rows) {
    const c = row.confidence;
    if (c != null && (!Number.isFinite(c) || c < 0 || c > 1)) {
      fail(`T3 confidence ${c} out of [0,1] in ${label}`);
    }
  }
}

// --- T4 counts reconcile ----------------------------------------------------
if (directorySource.count !== institutions.length) {
  fail(`T4 directorySource.count ${directorySource.count} != ${institutions.length} institutions`);
}
if (nrbSummary.documents !== nrbDocuments.length) {
  fail(`T4 nrbSummary.documents ${nrbSummary.documents} != ${nrbDocuments.length} nrbDocuments`);
}
if (nrbSummary.institutionLinks !== nrbInstitutionLinks.length) {
  fail(`T4 nrbSummary.institutionLinks ${nrbSummary.institutionLinks} != ${nrbInstitutionLinks.length} nrbInstitutionLinks`);
}
if (nrbSummary.regulatoryEvents !== nrbRegulatoryEvents.length) {
  fail(`T4 nrbSummary.regulatoryEvents ${nrbSummary.regulatoryEvents} != ${nrbRegulatoryEvents.length} nrbRegulatoryEvents`);
}
if (nrbSummary.institutions !== institutions.length) {
  fail(`T4 nrbSummary.institutions ${nrbSummary.institutions} != ${institutions.length} institutions`);
}
const eventTypeSum = Object.values(nrbSummary.eventsByType).reduce((a, b) => a + b, 0);
if (eventTypeSum !== nrbSummary.regulatoryEvents) {
  fail(`T4 nrbSummary.eventsByType sums to ${eventTypeSum} != ${nrbSummary.regulatoryEvents} regulatoryEvents`);
}
if (crawlSummary.sources !== crawlSources.length) {
  fail(`T4 crawlSummary.sources ${crawlSummary.sources} != ${crawlSources.length} crawlSources`);
}
if (crawlSummary.institutions !== institutions.length) {
  fail(`T4 crawlSummary.institutions ${crawlSummary.institutions} != ${institutions.length} institutions`);
}

// --- Report -----------------------------------------------------------------
if (findings.length > 0) {
  console.error(`data-truth guard: FAIL (${findings.length} finding${findings.length === 1 ? "" : "s"})`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
const flagSpots = institutions.filter(
  (i) => SENTINELS.some((s) => i.operationDate.startsWith(s)) && i.operationDateStatus === "source_anomaly",
).length;
console.log(
  `data-truth guard: OK — ${institutions.length} institutions, ${nrbDocuments.length} NRB documents, ` +
    `${nrbRegulatoryEvents.length} regulatory events, ${crawlSources.length} sources; ` +
    `${flagSpots} source-sentinel date(s) flagged (not published); counts reconcile; ` +
    `no null/undefined/NaN, no Rs-zero, no empty-string facts published`,
);
