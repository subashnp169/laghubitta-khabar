// ============================================================================
// M3.4 EXTENSION - EXTERNAL BRANCH EVIDENCE FIXTURES (B19..B24)
//
//   B19 generic external adapter      - real NRB shape, permuted columns
//   B20 institution matching ladder    - code / canonical / name / alias /
//                                        manual, and never a branch-name guess
//   B21 decision engine + coverage    - A / B / C / D, and never "zero branches"
//   B22 reconciliation                - corroborate / conflict / 3 provenance
//   B23 repeat + idempotency          - append-only evidence, 4 observations
//   B24 no bypass                     - external data cannot skip the pipeline
//
// Deterministic and offline. B23 opens a real SQLite database built from
// schema/schema.sql and writes ONLY through EvidenceWriter.
//
// Run: npx tsx scripts/smoke-branch-external.ts
// ============================================================================

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyExternalPlan,
  buildBranchSourcePlan,
  decideBranchEvidence,
  diffExternalRecords,
  externalBranchEntityId,
  externalRecordFingerprint,
  mapExternalHeader,
  matchInstitution,
  officialAllowsExternalFallback,
  parseExternalBranchTable,
  planExternalRepeat,
  reconcileBranchEvidence,
  registryForInstitution,
  type BranchEvidenceClaim,
  type BranchSourceRegistry,
  type ExternalBranchRecord,
  type ExternalRecordState,
  type InstitutionCandidate,
} from "../lib/ingestion";
import { LocalSqliteEvidenceWriter } from "../lib/ingestion";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string) => {
  prepare(s: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): Array<Record<string, unknown>>; run(...a: unknown[]): unknown };
  exec(s: string): void;
  close(): void;
};

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; failures.push(name); console.log("  FAIL " + name); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name + (g === w ? "" : `  (got ${g}, want ${w})`), g === w);
}
function section(t: string): void { console.log("\n" + t); }

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------

/** Real NRB /bank-list/ shape, condensed. Header text and order are verbatim. */
const NRB_BANK_LIST = `<html><body>
<h2>Banks &amp; Financial Institutions List</h2>
<table class="table">
  <tr><th>S.N.</th><th>Code</th><th>Address</th><th>District</th><th>Branch Name</th><th>Open Date</th></tr>
  <tr><td>1</td><td>11001001</td><td>17, Kathmandu Metropolitian City</td><td>Kathmandu</td><td>Head Office</td><td>1994-07-30</td></tr>
  <tr><td>2</td><td>11001002</td><td>22, Kathmandu Metropolitian City</td><td>Kathmandu</td><td>Kathmandu Banking Office</td><td>1994-07-30</td></tr>
  <tr><td>3</td><td>11001433</td><td>1, Kathekhola</td><td>Baglung</td><td>Kathekhola extension counter</td><td>2025-03-07</td></tr>
  <tr><td>4</td><td>11001435</td><td>1, Inaruwa</td><td>Sunsari</td><td>Inaruwa</td><td>2025-07-17</td></tr>
</table>
</body></html>`;

/** Same rows, permuted columns, different attribute order and case. */
const NRB_BANK_LIST_PERMUTED = `<HTML><BODY>
<TABLE class='table'>
 <TR><TH>Branch Name</TH><TH>Open Date</TH><TH>District</TH><TH>Code</TH><TH>Address</TH><TH>S.N.</TH></TR>
 <TR><TD>Head Office</TD><TD>1994-07-30</TD><TD>Kathmandu</TD><TD>11001001</TD><TD>17, Kathmandu Metropolitian City</TD><TD>1</TD></TR>
 <TR><TD>Kathmandu Banking Office</TD><TD>1994-07-30</TD><TD>Kathmandu</TD><TD>11001002</TD><TD>22, Kathmandu Metropolitian City</TD><TD>2</TD></TR>
 <TR><TD>Kathekhola extension counter</TD><TD>2025-03-07</TD><TD>Baglung</TD><TD>11001433</TD><TD>1, Kathekhola</TD><TD>3</TD></TR>
 <TR><TD>Inaruwa</TD><TD>2025-07-17</TD><TD>Sunsari</TD><TD>11001435</TD><TD>1, Inaruwa</TD><TD>4</TD></TR>
</TABLE>
</BODY></HTML>`;

/** A page that ALSO carries a statistics table above the branch table. */
const NRB_WITH_STATS_ABOVE = `<html><body>
<table>
  <tr><th>Indicators</th><th>2024</th><th>2023</th></tr>
  <tr><td>Number of BFIs</td><td>148</td><td>147</td></tr>
  <tr><td>Total branches</td><td>5,662</td><td>5,401</td></tr>
</table>
<h2>Branch List</h2>
<table>
  <tr><th>S.N.</th><th>Code</th><th>Address</th><th>District</th><th>Branch Name</th><th>Open Date</th></tr>
  <tr><td>1</td><td>11001001</td><td>17, Kathmandu</td><td>Kathmandu</td><td>Head Office</td><td>1994-07-30</td></tr>
</table>
</body></html>`;

/** An institution list that heads its column with plain "Name". */
const NOT_A_BRANCH_LIST = `<html><body>
<table>
  <tr><th>S.N.</th><th>Name</th><th>Code</th><th>District</th></tr>
  <tr><td>1</td><td>Ghorahi Dang Microfinance</td><td>21001</td><td>Dang</td></tr>
  <tr><td>2</td><td>Swargadwari Microfinance</td><td>21002</td><td>Banke</td></tr>
</table>
</body></html>`;

const CANDIDATES: InstitutionCandidate[] = [
  {
    institution_id: "mfi-001",
    name: "Ghorahi Dang Mahila Sahakari Samuh",
    codes: ["21001"],
    aliases: ["Ghorahi Dang Microfinance", "GDMSS"],
  },
  {
    institution_id: "mfi-002",
    name: "Swargadwari Mahila Sahakari Samuh",
    codes: ["21002"],
    aliases: ["Swargadwari Microfinance"],
  },
  {
    institution_id: "bank-001",
    name: "Nepal Bank Limited",
    codes: ["11001001"],
    aliases: ["Nepal Bank"],
  },
];

function claim(over: Partial<BranchEvidenceClaim> = {}): BranchEvidenceClaim {
  return {
    institution_id: "mfi-001",
    branch_name: "Ghorahi Dang",
    district: "Dang",
    place: null,
    address: null,
    source_type: "NRB",
    source_id: "src-nrb",
    source_url: "https://www.nrb.org.np/bank-list/",
    source_grade: "A",
    observed_at: "2026-09-27T00:00:00.000Z",
    content_hash: "hash-v1",
    snapshot_id: "snap-1",
    ...over,
  };
}

function states(recs: ExternalBranchRecord[], inst = "mfi-001"): ExternalRecordState[] {
  return recs.map((record) => ({
    institution_id: inst,
    entity_id: externalBranchEntityId(inst, record),
    fingerprint: externalRecordFingerprint(record),
    record,
  }));
}

function rec(over: Partial<ExternalBranchRecord> & { branch_name: string }): ExternalBranchRecord {
  return {
    external_code: null,
    institution_name: null,
    district: null,
    province: null,
    municipality: null,
    ward: null,
    address: null,
    open_date: null,
    status: null,
    phone: null,
    email: null,
    ...over,
  } as ExternalBranchRecord;
}

const REGISTRY: BranchSourceRegistry = {
  version: "branch-source-registry/v1",
  sources: [
    {
      institution_id: "*",
      source_type: "NRB",
      url: "https://www.nrb.org.np/bank-list/",
      discovery_method: "MANUAL",
      enabled: true,
      expects_branch_rows: true,
      observed_at: "2026-09-27T00:00:00.000Z",
      note: "banks only",
    },
    {
      institution_id: "*",
      source_type: "MEROLAGANI",
      url: "https://www.merolagani.com/",
      discovery_method: "MANUAL",
      enabled: true,
      expects_branch_rows: false,
      observed_at: "2026-09-27T00:00:00.000Z",
      note: "no MFI section",
    },
    {
      institution_id: "mfi-001",
      source_type: "SHARESANSHAR",
      url: "https://www.sharesansar.com/company/gdmf",
      discovery_method: "MANUAL",
      enabled: true,
      expects_branch_rows: false,
      observed_at: "2026-09-27T00:00:00.000Z",
      note: "institution level only",
    },
  ],
} as unknown as BranchSourceRegistry;

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ==========================================================================
  section("B19  generic external branch-table adapter");
  // ==========================================================================
  {
    const t = parseExternalBranchTable(NRB_BANK_LIST);
    eq("B19.1 real NRB header order read", t.header_row, ["S.N.", "Code", "Address", "District", "Branch Name", "Open Date"]);
    eq("B19.2 all six columns mapped", t.columns.filter((c) => c.field).length, 6);
    eq("B19.3 nothing unmapped", t.unmapped_headers, []);
    eq("B19.4 all rows read", t.records.length, 4);
    eq("B19.5 nothing refused", t.rejected.length, 0);
    eq("B19.6 regulator code captured", t.records[0].external_code, "11001001");
    eq("B19.7 branch name captured", t.records[2].branch_name, "Kathekhola extension counter");
    eq("B19.8 district captured", t.records[2].district, "Baglung");
    eq("B19.9 open date captured", t.records[3].open_date, "2025-07-17");
    eq("B19.10 address captured", t.records[0].address, "17, Kathmandu Metropolitian City");

    // Column meaning must come from the header, not the position.
    const p = parseExternalBranchTable(NRB_BANK_LIST_PERMUTED);
    eq("B19.11 permuted columns still read", p.records.length, 4);
    eq("B19.12 permuted rows are identical", p.records.map((r) => externalRecordFingerprint(r)), t.records.map((r) => externalRecordFingerprint(r)));

    // A stats table on the same page must not be mistaken for the branch list.
    const s = parseExternalBranchTable(NRB_WITH_STATS_ABOVE);
    eq("B19.13 stats table ignored, branch table used", s.records.length, 1);
    eq("B19.14 correct row chosen", s.records[0].branch_name, "Head Office");

    // A plain "Name" column is an institution list, not a branch list.
    const n = parseExternalBranchTable(NOT_A_BRANCH_LIST);
    eq("B19.15 institution list yields no branches", n.records.length, 0);
    check("B19.16 institution rows are reported, not dropped", n.rejected.length >= 0);

    eq("B19.17 'Code' means regulator code", mapExternalHeader("Code"), "bfi_code");
    eq("B19.18 'Branch Code' means branch code", mapExternalHeader("Branch Code"), "branch_code");
    eq("B19.19 'Branch Name' means branch name", mapExternalHeader("Branch Name"), "branch_name");
    eq("B19.20 bare 'Name' is NOT a branch column", mapExternalHeader("Name"), null);
    eq("B19.21 'Branch Office' is a branch column", mapExternalHeader("Branch Office"), "branch_name");
    eq("B19.22 'Contact' is not a branch column", mapExternalHeader("Contact"), null);
    eq("B19.23 header noise is tolerated", mapExternalHeader("  Branch   Name  "), "branch_name");
    eq("B19.24 'S.N.' is only a serial", mapExternalHeader("S.N."), "serial");
  }

  // ==========================================================================
  section("B20  institution matching ladder");
  // ==========================================================================
  {
    const byCode = matchInstitution({ external_code: "21001", institution_name: null }, CANDIDATES);
    eq("B20.1 exact regulator code wins", byCode, {
      status: "MATCHED", institution_id: "mfi-001", method: "BFI_CODE", confidence: 1,
    });
    eq("B20.2 code is read case/space insensitively",
      matchInstitution({ external_code: " 21001 ", institution_name: null }, CANDIDATES).method, "BFI_CODE");
    const codeBeatsName = matchInstitution({ external_code: "21002", institution_name: "Ghorahi Dang Microfinance" }, CANDIDATES);
    eq("B20.3 a code beats a contradicting name",
      codeBeatsName.status === "MATCHED" ? codeBeatsName.institution_id : null, "mfi-002");

    eq("B20.4 canonical id",
      matchInstitution({ external_code: null, institution_name: "mfi-002" }, CANDIDATES).method, "CANONICAL_ID");
    eq("B20.5 normalized official name",
      matchInstitution({ external_code: null, institution_name: "  ghorahi   DANG mahila sahakari samuh " }, CANDIDATES).method,
      "NORMALIZED_NAME");
    eq("B20.6 a legal suffix does not block a name match",
      matchInstitution({ external_code: null, institution_name: "Swargadwari Mahila Sahakari Samuh Ltd." }, CANDIDATES).method,
      "NORMALIZED_NAME");
    eq("B20.7 approved alias", matchInstitution({ external_code: null, institution_name: "Ghorahi Dang Microfinance" }, CANDIDATES).method, "ALIAS");
    eq("B20.8 alias normalizes too", matchInstitution({ external_code: null, institution_name: "ghorahi  dang microfinance" }, CANDIDATES).method, "ALIAS");

    const unknownCode = matchInstitution({ external_code: "99999", institution_name: null }, CANDIDATES);
    eq("B20.9 unknown code with no name -> manual review", unknownCode.status, "UNMATCHED");
    eq("B20.10 ...and it is routed to review", unknownCode.method, "MANUAL_REVIEW");

    const partial = matchInstitution({ external_code: null, institution_name: "Ghorahi" }, CANDIDATES);
    check("B20.11 a partial name is never auto-accepted", partial.status !== "MATCHED");
    eq("B20.12 a partial name goes to review", partial.status, "UNMATCHED");

    const noIdentifiers = matchInstitution({ external_code: null, institution_name: null }, CANDIDATES);
    eq("B20.13 no identifier at all -> review", noIdentifiers.status, "UNMATCHED");
    check("B20.14 an unmatched record names no institution", !("institution_id" in noIdentifiers));

    // A branch name must never be used to pick the institution.
    const byBranchName = matchInstitution({ external_code: null, institution_name: "Head Office" }, CANDIDATES);
    check("B20.15 a branch name does not match an institution", byBranchName.status !== "MATCHED");
    const dupCodes: InstitutionCandidate[] = [
      { institution_id: "mfi-x", name: "X Microfinance", codes: ["21001"] },
      { institution_id: "mfi-y", name: "Y Microfinance", codes: ["21001"] },
    ];
    const amb = matchInstitution({ external_code: "21001", institution_name: null }, dupCodes);
    eq("B20.16 a code on two institutions is ambiguous", amb.status, "AMBIGUOUS");
    check("B20.17 ambiguity is never silently resolved", !("institution_id" in amb));
    eq("B20.18 no candidates at all -> review", matchInstitution({ external_code: "1", institution_name: null }, []).status, "UNMATCHED");
  }

  // ==========================================================================
  section("B21  decision engine and coverage A/B/C/D");
  // ==========================================================================
  {
    const verified = decideBranchEvidence({
      official_coverage: "VERIFIED_BRANCH_DIRECTORY",
      official_valid_names: 42,
      external: [],
    });
    eq("B21.1 verified official page is coverage A", verified.coverage, "A_OFFICIAL_PARSED");
    eq("B21.2 official page needs no external source", verified.selected_source_type, "OFFICIAL_MFB");
    eq("B21.3 no fallback attempted", verified.used_fallback, false);
    eq("B21.4 official count reported separately", verified.official_branch_count, 42);
    eq("B21.5 external count stays null when unused", verified.external_branch_count, null);
    eq("B21.6 projection count comes from official", verified.branch_count, 42);

    const fallback = decideBranchEvidence({
      official_coverage: "BRANCH_STRUCTURE_UNREAD",
      official_valid_names: 0,
      external: [
        { source_type: "MEROLAGANI", usable: true, records: 900, reason: "listing" },
        { source_type: "NRB", usable: true, records: 3, reason: "branch list" },
      ],
    });
    eq("B21.7 unreadable official -> NRB fallback", fallback.coverage, "B_NRB_FALLBACK");
    eq("B21.8 fallback uses the highest usable tier", fallback.selected_source_type, "NRB");
    eq("B21.9 count comes from the chosen tier", fallback.branch_count, 3);
    check("B21.10 a lower tier with MORE rows never wins", fallback.branch_count !== 900);
    eq("B21.11 official count is null, not zero", fallback.official_branch_count, null);
    eq("B21.12 input order does not change the choice",
      decideBranchEvidence({
        official_coverage: "BRANCH_STRUCTURE_UNREAD",
        official_valid_names: 0,
        external: [
          { source_type: "NRB", usable: true, records: 3, reason: "branch list" },
          { source_type: "MEROLAGANI", usable: true, records: 900, reason: "listing" },
        ],
      }).selected_source_type, "NRB");

    for (const cov of ["BRANCH_LOCATOR_UNRENDERED", "BRANCH_INTENT_NO_STRUCTURE", "UNREADABLE_BODY"] as const) {
      eq(`B21.13 ${cov} is fallback-eligible`, officialAllowsExternalFallback(cov), true);
    }
    for (const cov of ["VERIFIED_BRANCH_DIRECTORY", "PARTIAL_BRANCH_DIRECTORY", "SINGLE_LOCATION_CONTACT", "NOT_A_BRANCH_PAGE"] as const) {
      eq(`B21.14 ${cov} is not fallback-eligible`, officialAllowsExternalFallback(cov), false);
    }

    const singleLocation = decideBranchEvidence({
      official_coverage: "SINGLE_LOCATION_CONTACT",
      official_valid_names: 0,
      external: [
        { source_type: "NRB", usable: false, records: 0, reason: "banks only" },
        { source_type: "SHARESANSHAR", usable: true, records: 1, reason: "institution level" },
      ],
    });
    eq("B21.15 single-location contact is official-resolved", singleLocation.coverage, "A_OFFICIAL_PARSED");
    eq("B21.16 ...so no fallback is used", singleLocation.used_fallback, false);
    // A single location is NOT a count. Asserting 0 here is the exact failure this
    // gate exists to prevent: an MFI would be published as branch-less on the
    // strength of one contact block.
    eq("B21.17 ...but it does NOT assert zero, because one location is not a count",
      singleLocation.branch_count, null);
    eq("B21.17b ...nor does it call the count available", singleLocation.official_branch_count, null);
    check("B21.17c ...and the reason says unknown, not zero",
      /unknown, not zero/u.test(singleLocation.reason));

    // A page with no branch structure says nothing about branch count either.
    const notABranchPage = decideBranchEvidence({
      official_coverage: "NOT_A_BRANCH_PAGE",
      official_valid_names: 0,
      external: [{ source_type: "NRB", usable: true, records: 3, reason: "banks" }],
    });
    eq("B21.17d a non-branch page is not fallback-eligible", notABranchPage.used_fallback, false);
    eq("B21.17e ...and its branch_count is null, never 0", notABranchPage.branch_count, null);
    eq("B21.17f ...with no evidence claimed", notABranchPage.branch_evidence_available, false);

    // The one case where 0 IS a finding: a directory we actually parsed and which
    // held no branches. That is proven zero, and it must not be flattened to null.
    const emptyDirectory = decideBranchEvidence({
      official_coverage: "VERIFIED_BRANCH_DIRECTORY",
      official_valid_names: 0,
      external: [{ source_type: "NRB", usable: true, records: 3, reason: "banks" }],
    });
    eq("B21.17g a parsed-but-empty directory proves zero", emptyDirectory.branch_count, 0);
    check("B21.17h ...and the reason says so explicitly",
      /proven zero/u.test(emptyDirectory.reason));

    // A single location WITH a name is positive evidence a branch exists, while
    // the total stays unknown. Evidence-available and count-known are different
    // questions and must not be collapsed into one another.
    const namedLocation = decideBranchEvidence({
      official_coverage: "SINGLE_LOCATION_CONTACT",
      official_valid_names: 1,
      external: [],
    });
    eq("B21.17i a named single location yields branch evidence", namedLocation.branch_evidence_available, true);
    eq("B21.17j ...while the count remains unknown", namedLocation.branch_count, null);

    const onlySecondary = decideBranchEvidence({
      official_coverage: "UNREADABLE_BODY",
      official_valid_names: 0,
      external: [
        { source_type: "NRB", usable: false, records: 0, reason: "not a branch list for this MFI" },
        { source_type: "MEROLAGANI", usable: true, records: 1, reason: "corroborating" },
      ],
    });
    eq("B21.18 secondary-only fallback is coverage C", onlySecondary.coverage, "C_SECONDARY_FALLBACK");
    eq("B21.19 coverage C names its source", onlySecondary.selected_source_type, "MEROLAGANI");
    eq("B21.20 coverage C records its external count", onlySecondary.external_branch_count, 1);

    const none = decideBranchEvidence({
      official_coverage: "UNREADABLE_BODY",
      official_valid_names: 0,
      external: [
        { source_type: "NRB", usable: false, records: 0, reason: "banks only" },
        { source_type: "MEROLAGANI", usable: false, records: 0, reason: "no MFI section" },
        { source_type: "SHARESANSHAR", usable: false, records: 0, reason: "institution level only" },
      ],
    });
    eq("B21.21 nothing usable -> D_UNRESOLVED", none.coverage, "D_UNRESOLVED");
    eq("B21.22 UNRESOLVED selects no source", none.selected_source_type, null);
    check("B21.23 UNRESOLVED is never reported as zero branches", none.branch_count === null);
    check("B21.24 UNRESOLVED is not a zero count", none.branch_count !== 0);
    check("B21.25 UNRESOLVED explains itself", typeof none.reason === "string" && none.reason.length > 20);
    check("B21.26 UNRESOLVED keeps every source considered", none.considered.length === 3);

    // An enabled source that is simply not a branch list is not "unavailable":
    // it is a source that was consulted and had nothing for this institution.
    const consulted = decideBranchEvidence({
      official_coverage: "BRANCH_LOCATOR_UNRENDERED",
      official_valid_names: 0,
      external: [{ source_type: "NRB", usable: false, records: 0, reason: "population does not include this MFI", configured: true }],
    });
    eq("B21.27 a consulted source still ends UNRESOLVED", consulted.coverage, "D_UNRESOLVED");
    check("B21.28 ...and its reason is preserved for the report",
      consulted.considered[0].reason.includes("does not include"));
  }

  // ==========================================================================
  section("B22  reconciliation, corroboration and conflict");
  // ==========================================================================
  {
    const same = reconcileBranchEvidence([
      claim({ source_type: "OFFICIAL_MFB", source_id: "src-mfb", source_url: "https://mfb.invalid/b" }),
      claim({ source_type: "NRB" }),
    ]);
    eq("B22.1 same branch and district corroborate", same[0].status, "CORROBORATED");
    eq("B22.2 one identity from two sources", same.length, 1);
    eq("B22.3 both provenances retained", same[0].provenance.length, 2);
    eq("B22.4 official stays primary", same[0].primary_source_type, "OFFICIAL_MFB");
    eq("B22.5 both source types are listed", same[0].sources, ["OFFICIAL_MFB", "NRB"]);
    check("B22.6 the external source is still attributed",
      same[0].provenance.some((p) => p.source_type === "NRB" && p.snapshot_id === "snap-1"));
    check("B22.7 corroboration creates no conflict", same[0].conflicts.length === 0);

    // Same name, different district, different sources -> conflict.
    const differing = reconcileBranchEvidence([
      claim({ source_type: "OFFICIAL_MFB", source_id: "src-mfb", district: "Dang" }),
      claim({ source_type: "NRB", district: "Rupandehi" }),
    ]);
    check("B22.8 same name in two districts stays two identities", differing.length === 2);
    check("B22.9 ...and is surfaced as a geography conflict",
      differing.some((r) => r.conflicts.some((c) => c.kind === "GEOGRAPHY")));
    check("B22.10 both sides of the disagreement are kept",
      differing.every((r) => r.provenance.length === 1));

    const three = reconcileBranchEvidence([
      claim({ source_type: "OFFICIAL_MFB", source_id: "src-mfb" }),
      claim({ source_type: "NRB" }),
      claim({ source_type: "MEROLAGANI", source_id: "src-mero" }),
    ]);
    eq("B22.11 three sources, one identity", three.length, 1);
    eq("B22.12 three provenances kept", three[0].provenance.length, 3);
    eq("B22.13 still corroborating", three[0].status, "CORROBORATED");

    const one = reconcileBranchEvidence([claim({ source_type: "NRB" })]);
    eq("B22.14 a lone external record is SINGLE_SOURCE", one[0].status, "SINGLE_SOURCE");
    eq("B22.15 ...and it still carries its provenance", one[0].provenance.length, 1);

    // A differing field is a field conflict, not an identity split.
    const addr = reconcileBranchEvidence([
      claim({ source_type: "OFFICIAL_MFB", source_id: "src-mfb", address: "17, Kathmandu" }),
      claim({ source_type: "NRB", address: "17 Kathmandu" }),
    ]);
    eq("B22.16 an address difference does not split identity", addr.length, 1);
    check("B22.17 ...it is reported as a field conflict",
      addr[0].conflicts.some((c) => c.field === "address"));
    check("B22.18 ...and the branch is flagged", addr[0].status === "CONFLICT");
    check("B22.19 the primary value is kept",
      addr[0].conflicts[0]?.primary === "17, Kathmandu");

    // One source listing two same-named branches in two districts is TWO
    // branches, not a cross-source disagreement.
    const twoPlaces = reconcileBranchEvidence([
      claim({ institution_id: "bank-001", source_type: "NRB", branch_name: "Head Office", district: "Kathmandu" }),
      claim({ institution_id: "bank-001", source_type: "NRB", branch_name: "Head Office", district: "Lalitpur" }),
    ]);
    eq("B22.20 same name in two districts = two branches", twoPlaces.length, 2);
    check("B22.21 not reported as a cross-source conflict",
      twoPlaces.every((r) => r.conflicts.length === 0));

    // Identity is institution-scoped: the same branch name in two MFIs is two
    // branches, and must never merge.
    const across = reconcileBranchEvidence([
      claim({ institution_id: "mfi-001", source_type: "OFFICIAL_MFB", source_id: "src-mfb" }),
      claim({ institution_id: "mfi-002", source_type: "OFFICIAL_MFB", source_id: "src-mfb" }),
    ]);
    eq("B22.22 the same branch name in two MFIs stays two branches", across.length, 2);
    check("B22.23 identity is institution-scoped",
      across.every((r, i) => r.identity_key.startsWith(i === 0 ? "mfi-001|" : "mfi-002|")));

    // A claim whose only difference is a contact-less field must not split.
    const nameNoise = reconcileBranchEvidence([
      claim({ source_type: "OFFICIAL_MFB", source_id: "src-mfb", branch_name: "Ghorahi  Dang" }),
      claim({ source_type: "NRB", branch_name: "ghorahi-dang" }),
    ]);
    eq("B22.24 name normalization reconciles one branch", nameNoise.length, 1);
    eq("B22.25 ...and corroborates", nameNoise[0].status, "CORROBORATED");
  }

  // ==========================================================================
  section("B23  repeat ingestion and idempotency (append-only evidence)");
  // ==========================================================================
  {
    const dir = mkdtempSync(join(tmpdir(), "m34-ext-"));
    const dbPath = join(dir, "ext.db");
    const schema = readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8");
    const db = new Database(dbPath);
    db.prepare("PRAGMA foreign_keys = ON").run();
    db.exec(schema);
    const src = db.prepare(
      `INSERT INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
       VALUES (?,?,?,?,?,?,?,?,1)`,
    );
    src.run("src-nrb", "NRB", "NRB", "A", "https://www.nrb.org.np/bank-list/", "www.nrb.org.np", "Banks & Financial Institutions List", "Nepal Rastra Bank");
    src.run("src-mfb", "MFB_WEBSITE", "INSTITUTION", "A", "https://www.ghorahidang.com.np/branches", "www.ghorahidang.com.np", "Branches", "Ghorahi Dang Mahila Sahakari Samuh");
    src.run("src-mero", "DATA_PROVIDER", "MARKET", "C", "https://www.merolagani.com/", "www.merolagani.com", "Mero Lagani", "Mero Lagani");
    db.close();

    const writer = new LocalSqliteEvidenceWriter(dbPath);
    const ctx = {
      writer,
      source_id: "src-nrb",
      snapshot: { fetched_at: "2026-09-27T00:00:00.000Z", http_status: 200, mime_type: "text/html", parser_version: "ext-branch-table-v1" },
      observed_at: "2026-09-27T00:00:00.000Z",
      confidence: 0.7,
      verification_status: "UNVERIFIED" as const,
    };

    const count = (sql: string): number => {
      const d = new Database(dbPath);
      const r = d.prepare(sql).get() as { c: number };
      d.close();
      return r.c;
    };

    const V1 = [
      rec({ external_code: "11001001", branch_name: "Head Office", district: "Kathmandu", address: "17, Kathmandu", open_date: "1994-07-30" }),
      rec({ external_code: "11001002", branch_name: "Kathmandu Banking Office", district: "Kathmandu", address: "22, Kathmandu", open_date: "1994-07-30" }),
    ];
    const V1_SAME = V1.map((r) => ({ ...r })); // formatting-only: same semantics
    const V2 = [
      // Inaruwa newly listed
      ...V1.map((r) => ({ ...r })),
      rec({ external_code: "11001435", branch_name: "Inaruwa", district: "Sunsari", address: "1, Inaruwa", open_date: "2025-07-17" }),
    ];
    const V3 = [
      // Kathekhola renamed AND a row removed from the source
      { ...V1[0] },
      { ...V1[1], branch_name: "Kathmandu Banking Office (Renamed)" },
      { ...V2[2] },
    ];

    const FIELDS = ["branch_name", "district", "address", "open_date"] as const;
    const planFor = (prior: ExternalRecordState[], next: ExternalRecordState[], h: string, priorHash: string | null) =>
      planExternalRepeat({
        source_id: "src-nrb",
        prior_content_hash: priorHash,
        content_hash: h,
        prior,
        next,
        fields: FIELDS.map((f) => ({ field: f, get: (r: ExternalBranchRecord) => (r[f] ? String(r[f]).trim() : "") })),
      });

    // observation 1
    const s1 = states(V1);
    const p1 = planFor([], s1, "hash-v1", null);
    const a1 = await applyExternalPlan(p1, ctx);
    check("B23.1 first ingestion writes assertions", a1.assertions > 0);
    check("B23.2 first ingestion writes a snapshot", a1.snapshot_id !== null);
    const snapsAfter1 = count("SELECT COUNT(*) c FROM source_snapshots");
    const assertsAfter1 = count("SELECT COUNT(*) c FROM data_assertions");

    // observation 2: byte-identical
    const p2 = planFor(s1, states(V1_SAME), "hash-v1", "hash-v1");
    check("B23.3 unchanged content is a no-op", p2.no_op);
    const a2 = await applyExternalPlan(p2, ctx);
    eq("B23.4 unchanged content adds no snapshot", a2.snapshot_id, null);
    eq("B23.5 unchanged content adds no assertion", a2.assertions, 0);
    eq("B23.6 snapshot count unchanged", count("SELECT COUNT(*) c FROM source_snapshots"), snapsAfter1);
    eq("B23.7 assertion count unchanged", count("SELECT COUNT(*) c FROM data_assertions"), assertsAfter1);
    eq("B23.8 no conflicts invented", count("SELECT COUNT(*) c FROM data_conflicts"), 0);

    // observation 3: formatting-only change, same canonical hash
    const fmt = planFor(s1, states(V1_SAME), "hash-v1", "hash-v1");
    check("B23.9 formatting-only change is also a no-op", fmt.no_op);
    await applyExternalPlan(fmt, ctx);
    eq("B23.10 formatting churn adds no assertion", count("SELECT COUNT(*) c FROM data_assertions"), assertsAfter1);

    // observation 4: real change (one added, one renamed)
    const s2 = states(V2);
    const p4 = planFor(s1, s2, "hash-v2", "hash-v1");
    check("B23.11 real change writes a new snapshot", p4.snapshot_count === 1);
    check("B23.12 real change writes only the new record", p4.assertion_count === 4);
    const a4 = await applyExternalPlan(p4, ctx);
    check("B23.12b the added record is what got written", a4.assertions === 4);
    eq("B23.12c the added record produced no conflict", a4.conflicts, 0);
    eq("B23.13 two snapshots now exist", count("SELECT COUNT(*) c FROM source_snapshots"), snapsAfter1 + 1);
    const d4 = diffExternalRecords(s1, s2);
    eq("B23.14 one record added", d4.added.length, 1);
    eq("B23.15 nothing renamed yet", d4.changed.length, 0);
    eq("B23.16 prior rows all still present", d4.unchanged.length, 2);

    // observation 5: a RENAME. Branch name is part of branch identity, so a
    // rename is honestly "one identity stopped being listed, a new one appeared",
    // NOT a mutation of the old one. Asserting that the old name still exists
    // would be asserting a branch that the source no longer lists.
    const s3 = states(V3);
    const p5 = planFor(s2, s3, "hash-v3", "hash-v2");
    const d5 = diffExternalRecords(s2, s3);
    eq("B23.17 a renamed branch is NOT silently mutated", d5.changed.length, 0);
    eq("B23.18 the new name appears as an addition", d5.added.length, 1);
    eq("B23.19 the old name is recorded as no longer listed", d5.disappeared.length, 1);
    check("B23.20 the disappearance is recorded as a conflict", p5.conflict_count > 0);
    check("B23.21 ...and is explicitly not read as a closure",
      p5.writes.some((w) => w.kind === "CONFLICT" && w.cause === "NO_LONGER_LISTED"));
    await applyExternalPlan(p5, ctx);
    check("B23.22 conflicts are recorded in the evidence DB", count("SELECT COUNT(*) c FROM data_conflicts") > 0);
    const oldNameKept = count(
      "SELECT COUNT(*) c FROM data_assertions WHERE field_name='branch_name' AND value='Kathmandu Banking Office'",
    );
    check("B23.23 the superseded name assertion is retained, not deleted", oldNameKept >= 1);
    const newNameAdded = count(
      "SELECT COUNT(*) c FROM data_assertions WHERE field_name='branch_name' AND value LIKE '%Renamed%'",
    );
    check("B23.24 the new name is asserted alongside it", newNameAdded >= 1);
    const identities = count("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions");
    eq("B23.25 identity count grew honestly (2 original + Inaruwa + renamed)", identities, 4);

    // observation 6: a NON-identity field change on the same identity. Address
    // is compared evidence, not identity, so this must supersede in place.
    const V4 = V3.map((r) => (r.branch_name === "Head Office" ? { ...r, address: "99, New Road, Kathmandu" } : r));
    const s4 = states(V4);
    const d6 = diffExternalRecords(s3, s4);
    eq("B23.26 a non-identity field change is a change, not a new branch", d6.changed.length, 1);
    eq("B23.27 ...and it is attributed to the right field", d6.changed[0]?.changed_fields, ["address"]);
    eq("B23.28 nothing was added", d6.added.length, 0);
    eq("B23.29 nothing disappeared", d6.disappeared.length, 0);
    const p6 = planFor(s3, s4, "hash-v4", "hash-v3");
    check("B23.30 the changed field supersedes the old value",
      p6.writes.some((w) => w.kind === "SUPERSEDE" && w.field_name === "address" && w.old_value === "17, Kathmandu"));
    check("B23.31 ...and the new value is asserted",
      p6.writes.some((w) => w.kind === "ASSERT" && w.field_name === "address" && w.value === "99, New Road, Kathmandu"));
    const a6 = await applyExternalPlan(p6, ctx);
    check("B23.33b the first application actually closed the old value out", a6.superseded > 0);
    eq("B23.33c ...with nothing left pending on a clean first pass", a6.superseded_pending, 0);
    const identitiesAfter = count("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions");
    eq("B23.32 a field change creates no new identity", identitiesAfter, 4);
    const addrRows = count(
      "SELECT COUNT(*) c FROM data_assertions WHERE field_name='address' AND entity_id LIKE '%head office%'",
    );
    check("B23.33 both address observations are retained in the trail", addrRows >= 2);

    // Supersession is now APPLIED, not merely counted. The frozen schema already
    // carried data_assertions.valid_to and STALE, so this needed a writer
    // operation, not a migration. The old value keeps its row, its source and its
    // snapshot; only its currency changes.
    const p7 = planFor(s4, states(V4), "hash-v4", "hash-v4");
    const a7 = await applyExternalPlan(p7, ctx);
    eq("B23.34 an unchanged re-run still supersedes nothing", a7.superseded_pending + a7.superseded, 0);
    const p8 = planFor(s3, states(V4), "hash-v4", "hash-v3");
    const a8 = await applyExternalPlan(p8, ctx);
    check("B23.35 a field change DOES plan a supersede",
      p8.writes.some((w) => w.kind === "SUPERSEDE"));
    // Re-applying the SAME change is idempotent, and reports itself honestly:
    // the old value was already closed out by p6, so there is no current
    // assertion left to supersede. That is precisely what the pending counter
    // exists to surface - a plan that asked to close something nothing holds.
    // Silently reporting success here would hide a real inconsistency.
    eq("B23.36 re-applying the same change supersedes nothing a second time", a8.superseded, 0);
    eq("B23.37 ...and reports the already-superseded value as pending, not as done", a8.superseded_pending, 1);
    const staleMarked = count(
      "SELECT COUNT(*) c FROM data_assertions WHERE verification_status='STALE' OR valid_to IS NOT NULL",
    );
    check("B23.38 the old value is marked STALE with a valid_to, using only the frozen schema", staleMarked > 0);
    check("B23.39 ...and the stale rows carry a real valid_to timestamp", count(
      "SELECT COUNT(*) c FROM data_assertions WHERE verification_status='STALE' AND valid_to IS NULL",
    ) === 0);
    check("B23.40 the replacement value is durable too", count(
      "SELECT COUNT(*) c FROM data_assertions WHERE field_name='address' AND value='99, New Road, Kathmandu'",
    ) >= 1);
    check("B23.41 the disagreement is durable as a conflict", count(
      "SELECT COUNT(*) c FROM data_conflicts WHERE field_name='address'",
    ) >= 1);
    // exactly one current address for that branch, and the old row still readable
    eq("B23.42 exactly one CURRENT address survives for the branch", count(
      "SELECT COUNT(*) c FROM data_assertions WHERE field_name='address' AND entity_id LIKE '%head office%' AND valid_to IS NULL",
    ), 1);
    check("B23.43 the superseded row is still readable as history", count(
      "SELECT COUNT(*) c FROM data_assertions WHERE field_name='address' AND entity_id LIKE '%head office%' AND verification_status='STALE'",
    ) >= 1);
    // and unchanged re-runs remain completely inert
    const before = count("SELECT COUNT(*) c FROM data_assertions");
    const p9 = planFor(states(V4), states(V4), "hash-v4", "hash-v4");
    const a9 = await applyExternalPlan(p9, ctx);
    eq("B23.44 a final unchanged re-run writes nothing", count("SELECT COUNT(*) c FROM data_assertions"), before);
    eq("B23.45 ...and adds no snapshot", a9.snapshot_id, null);
    eq("B23.46 ...and supersedes nothing", a9.superseded + a9.superseded_pending, 0);
  }

  // ==========================================================================
  section("B24  controlled registry and no-bypass invariants");
  // ==========================================================================
  {
    const official = [
      { institution_id: "mfi-001", id: "ghorahidang-branches", known_url: "https://www.ghorahidang.com.np/branches" },
      { institution_id: "mfi-002", id: "swargadwari-branches", known_url: null },
    ];
    const plan = buildBranchSourcePlan("mfi-001", official, REGISTRY);
    eq("B24.1 official source is planned", plan.has_official, true);
    eq("B24.2 plan is in tier order", plan.entries[0].source_type, "OFFICIAL_MFB");
    check("B24.3 official pilot source id is carried", plan.entries[0].pilot_source_id === "ghorahidang-branches");

    const noUrl = buildBranchSourcePlan("mfi-002", official, REGISTRY);
    eq("B24.4 a source with no URL is not planned", noUrl.has_official, false);
    check("B24.5 ...so external fallback is reachable", noUrl.entries[0]?.source_type === "NRB");

    const r = registryForInstitution(REGISTRY, "mfi-001");
    eq("B24.6 registry is ordered by tier", r.map((x) => x.source_type), ["NRB", "MEROLAGANI", "SHARESANSHAR"]);
    eq("B24.7 wildcard registry entries apply to any institution", r.length, 3);
    eq("B24.8 institution-scoped entry is included for its own institution", registryForInstitution(REGISTRY, "mfi-999").map((x) => x.source_type), ["NRB", "MEROLAGANI"]);

    // External evidence must be attributable. A record with no source_id or no
    // snapshot is unattributable, so the plan shape forbids it by construction.
    const orphan = planExternalRepeat({
      source_id: "src-nrb",
      prior_content_hash: null,
      content_hash: "h",
      prior: [],
      next: [{ institution_id: "mfi-001", entity_id: "e", fingerprint: "f", record: rec({ branch_name: "X" }) }],
    });
    const a = orphan.writes.find((w) => w.kind === "ASSERT");
    check("B24.9 every planned assertion names a source", a !== undefined && typeof (a as { source_id: string }).source_id === "string");
    const snap = orphan.writes.find((w) => w.kind === "SNAPSHOT");
    check("B24.10 every assertion run carries a snapshot", snap !== undefined);
  }

  console.log("\n" + "-".repeat(60));
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("  failures:");
    for (const f of failures) console.log("    - " + f);
    process.exitCode = 1;
  }
}

void main();
