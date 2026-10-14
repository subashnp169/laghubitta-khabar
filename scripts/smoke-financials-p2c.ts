// ============================================================================
// P2-C — canonical financial document layer acceptance tests.
//
// These assert the PROPERTIES P2-C guarantees over the generated — not
// hand-written — public financial layer. They read the same shared projection
// the runtime serves, so a regression in the builder or the projection fails
// here. Nothing here reads a document's contents; the layer is documents only.
//
// Run: npm run smoke:financials-p2c   (after `npm run seed && npm run build:financials`)
// ============================================================================
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { allPublishedFinancials } from "../lib/repository/static-financials";
import {
  financialsFromAssertionRows,
  type FinancialAssertionRecord,
} from "../lib/repository/projection";
import { financialAssertions, openFinancialConflicts } from "../src/data/financials";
import { institutions } from "../src/data/institutions";
import { handleApiRequest } from "../lib/api/handler";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => {
  prepare(s: string): { get(...a: unknown[]): Record<string, unknown>; all(...a: unknown[]): Record<string, unknown>[] };
  close(): void;
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}

const registryById = new Map(institutions.map((i) => [i.id, i]));
const registrySlugs = new Set(institutions.map((i) => i.slug));
const docs = allPublishedFinancials();

// Re-resolve each observation's owning institution from the source publisher
// against the registry, exactly as the builder does. This is the property P2-C
// guarantees; testing it against the builder's own output catches a regression in
// either side.
const identityKey = (s: string): string =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\blimited\b/g, "ltd")
    .replace(/\b(ltd|co|company|pvt|private)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
interface PilotSource { id: string; publisher?: string; domain?: string; }
const pilotSources: PilotSource[] = (
  JSON.parse(readFileSync(join(process.cwd(), "data/pilot/pilot-sources.json"), "utf8")) as { sources?: PilotSource[] }
).sources ?? [];
function publisherResolvesTo(sourceId: string): string | undefined {
  const src = pilotSources.find((s) => s.id === sourceId);
  if (!src?.publisher) return undefined;
  const key = identityKey(src.publisher);
  const exact = institutions.filter((i) => identityKey(i.name) === key);
  const viaAlias = institutions.filter((i) => (i.aliases ?? []).some((a) => identityKey(a) === key));
  const cands = exact.length ? exact : viaAlias;
  if (cands.length === 1) return cands[0].id;
  if (cands.length > 1) {
    const host = String(src.domain ?? "").replace(/^www\./, "").toLowerCase();
    const byHost = cands.filter((i) => {
      if (!i.officialWebsite) return false;
      try { return new URL(i.officialWebsite).hostname.replace(/^www\./, "").toLowerCase() === host; } catch { return false; }
    });
    if (byHost.length === 1) return byHost[0].id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 1. Population + document identity
// ---------------------------------------------------------------------------
console.log("PC-1 document identity");
check("published set is non-empty", docs.length > 0);
check("at least one report and one rate notice", docs.some((d) => d.kind === "REPORT") && docs.some((d) => d.kind === "RATE"));
check("every document id is unique", new Set(docs.map((d) => d.id)).size === docs.length);
check("every document slug is unique", new Set(docs.map((d) => d.slug)).size === docs.length);
check("every document has a non-empty title", docs.every((d) => d.title.trim().length > 0));
check("every document id is the canonical financial-<inst>|<url> shape", docs.every((d) => /^financial-mfi-\d+\|https?:\/\//.test(d.id)));

const instIdOfEntity = (e: string): string => e.split("|")[0].replace(/^financial-/, "");
const moduleEntityIds = (financialAssertions as { entity_id: string }[]).map((r) => r.entity_id);
check("every published entity_id is institution-prefixed by a registry id", moduleEntityIds.every((e) => registryById.has(instIdOfEntity(e))));
check("every document is scoped to a registry slug", docs.every((d) => registrySlugs.has(d.institution_slug)));

// ---------------------------------------------------------------------------
// 2. Attribution — a document is owned by the institution whose OWN site hosted
//    it, resolved from the source publisher, never from a pilot-numbered id.
// ---------------------------------------------------------------------------
console.log("PC-2 attribution (no pilot-number drift)");
check("every assertion's institution_id matches its entity_id prefix", (financialAssertions as FinancialAssertionRecord[]).every((r) => instIdOfEntity(r.entity_id) === r.institution_id));
check("every assertion's slug is the registry slug for its institution_id", (financialAssertions as FinancialAssertionRecord[]).every((r) => registryById.get(r.institution_id)?.slug === r.institution_slug));
check("every assertion's name is the registry name for its institution_id", (financialAssertions as FinancialAssertionRecord[]).every((r) => registryById.get(r.institution_id)?.name === r.institution_name));
check(
  "every observation's source publisher resolves to its recorded institution",
  (financialAssertions as FinancialAssertionRecord[]).every((r) => publisherResolvesTo(r.source_id) === r.institution_id),
);

// ---------------------------------------------------------------------------
// 3. Title honesty — a call-to-action is never published as a document title
// ---------------------------------------------------------------------------
console.log("PC-3 title gate");
const GENERIC = /^(download|downloads?|read\s*more|readmore|view(\s*more)?|more|click(\s*here)?|here|details?|see\s*more|open|link|pdf|file|document|notice|english|nepali)$/i;
check("no published title is a bare call to action", docs.every((d) => !GENERIC.test(d.title.trim())));
check("no published title is just its institution's name", docs.every((d) => d.title.trim().toLowerCase() !== d.institution.trim().toLowerCase()));
// The gate is exercised directly, so a regression in the projection is caught
// even if the current evidence happens to contain no generic title.
const gateRow: FinancialAssertionRecord = {
  entity_id: "financial-mfi-001|https://example.com/files/annual-report-2082.pdf",
  institution_id: "mfi-001",
  institution_slug: "x",
  institution_name: "Example Laghubitta Bittiya Sanstha Ltd.",
  field_name: "DOCUMENT_TITLE",
  value: "Download",
  source_id: "s1",
  source_url: "https://example.com",
  observed_at: "2026-01-01",
  valid_to: null,
  verification_status: "UNVERIFIED",
  confidence: 0.5,
};
const [gated] = financialsFromAssertionRows([gateRow]);
check("a generic title falls back to the document filename", gated.title === "annual-report-2082.pdf");

// ---------------------------------------------------------------------------
// 4. No fabricated figures — a document is a document, never a number
// ---------------------------------------------------------------------------
console.log("PC-4 no fabricated figures");
check("every document status is ACTIVE or CONFLICT", docs.every((d) => d.status === "ACTIVE" || d.status === "CONFLICT"));
check("a RATE document always carries a rate_kind", docs.filter((d) => d.kind === "RATE").every((d) => (d.rateKind ?? "").length > 0));

// ---------------------------------------------------------------------------
// 5. Conflict preservation — an OPEN cross-source disagreement degrades to CONFLICT
// ---------------------------------------------------------------------------
console.log("PC-5 conflict preservation");
const conflictOut = financialsFromAssertionRows(
  [gateRow],
  { openConflictKeys: new Set([`${gateRow.entity_id}|DOCUMENT_TITLE`]) },
);
check("an OPEN conflict degrades the document to CONFLICT", conflictOut.every((d) => d.status === "CONFLICT"));
check("openFinancialConflicts is an array of entity/field keys", Array.isArray(openFinancialConflicts) && openFinancialConflicts.every((c) => typeof c.entity_id === "string" && typeof c.field_name === "string"));

// ---------------------------------------------------------------------------
// 6. Determinism — the projection is a pure function of evidence
// ---------------------------------------------------------------------------
console.log("PC-6 determinism");
check("projection is deterministic across calls", JSON.stringify(financialsFromAssertionRows(financialAssertions as unknown as FinancialAssertionRecord[])) === JSON.stringify(financialsFromAssertionRows(financialAssertions as unknown as FinancialAssertionRecord[])));
check("module assertions contain no REJECTED rows", (financialAssertions as { verification_status: string }[]).every((r) => r.verification_status !== "REJECTED"));
check("module assertions contain no retired rows", (financialAssertions as { valid_to?: string | null }[]).every((r) => r.valid_to === null || r.valid_to === undefined));

// ---------------------------------------------------------------------------
// 7. API parity — the served layer is the same projection, documents only
// ---------------------------------------------------------------------------
console.log("PC-7 API parity");
const request = (method: string, url: string) => {
  const out = handleApiRequest({ method, url });
  return { status: out.status, body: JSON.parse(out.body) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const rates = request("GET", "/api/interest-rates?limit=100");
const expectedRates = docs.filter((d) => d.kind === "RATE").length;
check("interest-rates total equals the published rate-notice count", rates.status === 200 && rates.body.pagination.total === expectedRates);
check("a rate notice never carries a numeric rate", rates.body.data.every((r: any) => r.rate_pct === null && r.meta.verification_status === "UNVERIFIED")); // eslint-disable-line @typescript-eslint/no-explicit-any
check("every rate notice resolves to a registry slug", rates.body.data.every((r: any) => registrySlugs.has(r.institution_slug))); // eslint-disable-line @typescript-eslint/no-explicit-any
const withReports = institutions.map((i) => i.slug).filter((s) => docs.some((d) => d.kind === "REPORT" && d.institution_slug === s));
check("at least one institution has published report documents", withReports.length > 0);
if (withReports.length > 0) {
  const slug = withReports[0];
  const expected = docs.filter((d) => d.kind === "REPORT" && d.institution_slug === slug).length;
  const fin = request("GET", `/api/institutions/${slug}/financials?limit=100`);
  check("per-institution financials total equals its published report count", fin.status === 200 && fin.body.pagination.total === expected);
  check("a served report carries empty metrics and is scoped to its institution", rates.status === 200 && fin.body.data.every((f: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
    typeof f.metrics === "object" && Object.keys(f.metrics).length === 0 && f.institution_slug === docs.find((d) => d.id === f.id)?.institution_slug && f.period_start === null && f.period_end === null));
}

// ---------------------------------------------------------------------------
// 8. Assertion-only — the canonical financial tables are deliberately NOT seeded
//    (no figures or periods exist in evidence to seed them from).
// ---------------------------------------------------------------------------
console.log("PC-8 assertion-only (no fabricated numbers)");
const lkPath = join(process.cwd(), "lk.db");
check("lk.db exists (run `npm run seed`)", existsSync(lkPath));
if (existsSync(lkPath)) {
  const db = new Database(lkPath, { readonly: true });
  const reportRows = db.prepare("SELECT COUNT(*) c FROM financial_reports").get().c as number;
  const metricRows = db.prepare("SELECT COUNT(*) c FROM financial_metrics").get().c as number;
  db.close();
  check("lk.db financial_reports is NOT seeded (0 rows)", reportRows === 0);
  check("lk.db financial_metrics is NOT seeded (0 rows)", metricRows === 0);
}

console.log(`\nP2-C financials results: ${pass} ok / ${fail} fail`);
if (fail > 0) process.exit(1);
console.log("ALL P2-C FINANCIALS TESTS PASSED.");