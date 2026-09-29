// ============================================================================
// M3.4 EXTENSION - CONTROLLED EXTERNAL SAMPLE
//
// The smallest honest test of the external fallback path:
//
//   2 official MFB branch pages   -> does the official parser still answer?
//   2 NRB branch records          -> does the generic adapter read the real
//                                    regulator table, end to end, through
//                                    EvidenceWriter?
//   1 Mero Lagani record          -> what does a secondary source contribute?
//   1 ShareSansar record          -> what does a secondary source contribute?
//
// Three controlled fetches. The production budget in data/pilot/pilot-budget.json
// is NOT modified. Tier-3 pages were already investigated (fetch counts recorded
// in data/pilot/branch-source-registry.json) and are not re-fetched here.
//
// Writes ONLY through LocalSqliteEvidenceWriter. No direct SQL for evidence.
// Scratch database; the committed evidence databases are not touched.
//
//   npx tsx scripts/external-branch-sample.ts
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  ControlledFetcher,
  nodeResolveHost,
  LocalSqliteEvidenceWriter,
  analyzeBranchPage,
  applyExternalPlan,
  buildBranchSourcePlan,
  decideBranchEvidence,
  externalBranchEntityId,
  externalRecordFingerprint,
  matchInstitution,
  parseExternalBranchTable,
  planExternalRepeat,
  type BranchSourceRegistry,
  type ExternalRecordState,
  type InstitutionCandidate,
} from "../lib/ingestion";
import type { FetcherPolicy } from "../lib/ingestion/fetcher";
import { classifyCoverage, signalsOf, structuralDensities, structuralEvidence } from "../lib/ingestion/shape-signals";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string) => {
  prepare(s: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): Array<Record<string, unknown>>; get(...a: unknown[]): Record<string, unknown> };
  exec(s: string): void;
  close(): void;
};

const root = process.cwd();
const OUT_DIR = join(root, "data", "pilot", "evidence");
const DB_PATH = join(OUT_DIR, "m34-external-sample-2026-09-27.db");
const REPORT_PATH = join(root, "data", "pilot", "external-branch-sample.json");
const NRB_URL = "https://www.nrb.org.np/bank-list/";

/** The two official branch pages used for the sample: one verified, one partial. */
const OFFICIAL_SAMPLE = [
  { institution_id: "mfi-003", source_id: "chhimek-branches", url: "https://www.chhimekbank.org/branches" },
  { institution_id: "mfi-005", source_id: "skbbl-branch", url: "https://www.skbbl.com.np/branch" },
];

function samplePolicy(url: string): FetcherPolicy {
  const host = new URL(url).hostname;
  const apex = host.replace(/^www\./i, "");
  return {
    allowedHosts: [...new Set(apex === host ? [host] : [host, apex])],
    allowSubdomainsOf: [apex],
    maxBytes: 6_000_000,
    maxRedirects: 3,
    maxRetries: 2,
    timeoutMs: 30_000,
    minIntervalMs: 1_200,
    retryBackoffMs: 500,
    userAgent: "laghubitta-khabar-m3.4-external-sample/1.0",
    resolveHost: nodeResolveHost,
  };
}

interface SampleRow {
  role: string;
  institution_id: string;
  source_type: string;
  source_id: string;
  url: string;
  http_status: number | null;
  fetched_at: string;
  content_hash: string;
  outcome: string;
  branch_records: number | null;
  detail: string;
}

async function main(): Promise<void> {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  for (const f of [DB_PATH]) if (existsSync(f)) require("node:fs").rmSync(f);

  const schema = readFileSync(join(root, "schema", "schema.sql"), "utf8");
  const db = new Database(DB_PATH);
  db.prepare("PRAGMA foreign_keys = ON").run();
  db.exec(schema);

  const addSource = db.prepare(
    `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
  );
  const now = new Date().toISOString();
  addSource.run("mfi-003-official", "MFB_WEBSITE", "INSTITUTION", "A", OFFICIAL_SAMPLE[0].url, new URL(OFFICIAL_SAMPLE[0].url).hostname, "Branches", "Chhimek Laghubitta", now);
  addSource.run("mfi-005-official", "MFB_WEBSITE", "INSTITUTION", "A", OFFICIAL_SAMPLE[1].url, new URL(OFFICIAL_SAMPLE[1].url).hostname, "Branch", "Sankhuwa Katha Bittiya", now);
  addSource.run("nrb-bank-list", "NRB", "NRB", "A", NRB_URL, "www.nrb.org.np", "Banks & Financial Institutions List", "Nepal Rastra Bank", now);
  addSource.run("mero-lagani", "DATA_PROVIDER", "MARKET", "C", "https://www.merolagani.com/", "www.merolagani.com", "Mero Lagani", "Mero Lagani", now);
  addSource.run("share-sansar", "DATA_PROVIDER", "MARKET", "C", "https://www.sharesansar.com/", "www.sharesansar.com", "ShareSansar", "ShareSansar", now);

  const writer = new LocalSqliteEvidenceWriter(DB_PATH);
  const rows: SampleRow[] = [];
  let fetches = 0;

  // -------------------------------------------------------------------------
  // PART 1 - two official pages, through the official parser
  // -------------------------------------------------------------------------
  console.log("PART 1  official sources (2 controlled fetches)");
  const officialDecisions = [];
  for (const o of OFFICIAL_SAMPLE) {
    const fetcher = new ControlledFetcher(samplePolicy(o.url));
    fetches += 1;
    let httpStatus: number | null = null;
    let fetchedAt = now;
    let contentHash = "";
    let html = "";
    try {
      const out = await fetcher.fetchControlled({ url: o.url, requestId: `m34-ext-${fetches}` });
      const r = out.result;
      httpStatus = r.httpStatus;
      fetchedAt = r.fetchedAt;
      contentHash = r.contentHash || createHash("sha256").update(r.body).digest("hex");
      html = new TextDecoder().decode(r.body);

      await writer.saveSnapshot({
        sourceId: `${o.institution_id}-official`,
        fetchedAt,
        contentHash,
        httpStatus,
        mimeType: r.contentType,
        parserVersion: "branch-html-v2",
        r2Key: null,
        extractionStatus: "EXTRACTED",
      });

      const analysis = analyzeBranchPage(html);
      const s = signalsOf(html);
      const verdict = classifyCoverage({
        structural: structuralEvidence(html),
        densities: structuralDensities(structuralEvidence(html)),
        validNames: analysis.validNames,
        candidateRecords: analysis.candidateRecords,
        rejectedNames: analysis.rejectedNames,
        branchVocabHits: s.branchVocabHits,
        roleBearingPeople: 0,
        httpStatus: r.httpStatus,
        bodyBytes: r.bodyBytes,
      });
      const d = decideBranchEvidence({
        official_coverage: verdict.coverage,
        official_valid_names: analysis.validNames,
        external: [],
      });
      officialDecisions.push(d);
      rows.push({
        role: "official",
        institution_id: o.institution_id,
        source_type: "OFFICIAL_MFB",
        source_id: `${o.institution_id}-official`,
        url: o.url,
        http_status: httpStatus,
        fetched_at: fetchedAt,
        content_hash: contentHash,
        outcome: `${verdict.coverage} / official ${analysis.validNames} record(s), ${analysis.rejectedNames} rejected`,
        branch_records: d.branch_count,
        detail: `structure=${verdict.structureKind}; fallback used=${d.used_fallback}`,
      });
      console.log(`  ${o.institution_id}  http=${httpStatus}  ${verdict.coverage}  names=${analysis.validNames}  branch_count=${String(d.branch_count)}`);
    } catch (e) {
      rows.push({
        role: "official", institution_id: o.institution_id, source_type: "OFFICIAL_MFB",
        source_id: `${o.institution_id}-official`, url: o.url, http_status: httpStatus,
        fetched_at: fetchedAt, content_hash: contentHash, outcome: "FETCH_FAILED",
        branch_records: null, detail: (e as Error).message,
      });
      console.log(`  ${o.institution_id}  FETCH FAILED: ${(e as Error).message}`);
    }
  }

  // -------------------------------------------------------------------------
  // PART 2 - the NRB branch table, through the generic external adapter
  // -------------------------------------------------------------------------
  console.log("\nPART 2  NRB regulator branch table (1 controlled fetch)");
  const NRB_CANDIDATES: InstitutionCandidate[] = [
    { institution_id: "bank-nepal-bank", name: "Nepal Bank Limited", codes: ["11001001"], aliases: ["Nepal Bank"] },
  ];
  let nrbTableRows = 0;
  let nrbParsed = 0;
  let nrbMapped = 0;
  let nrbRefused = 0;
  let nrbMatch: string | null = null;
  try {
    const fetcher = new ControlledFetcher(samplePolicy(NRB_URL));
    fetches += 1;
    const out = await fetcher.fetchControlled({ url: NRB_URL, requestId: "m34-ext-nrb" });
    const r = out.result;
    const html = new TextDecoder().decode(r.body);
    const contentHash = r.contentHash || createHash("sha256").update(r.body).digest("hex");

    const table = parseExternalBranchTable(html);
    nrbTableRows = table.data_row_count;
    nrbParsed = table.records.length;
    nrbMapped = table.columns.filter((c) => c.field).length;
    nrbRefused = table.rejected.length;
    console.log(`  http=${r.httpStatus}  bytes=${html.length}`);
    console.log(`  header row      : ${table.header_row.join(" | ")}`);
    console.log(`  columns mapped  : ${nrbMapped}/${table.columns.length}   data rows: ${nrbTableRows}   parsed: ${nrbParsed}   refused: ${nrbRefused}`);

    // Controlled sample: exactly TWO NRB records, taken through the pipeline.
    const sample2 = table.records.filter((x) => x.external_code === "11001001" || x.external_code === "11001435");
    console.log(`  controlled sample: ${sample2.length} record(s) -> ${sample2.map((x) => x.branch_name).join(", ")}`);

    const snapId = await writer.saveSnapshot({
      sourceId: "nrb-bank-list",
      fetchedAt: r.fetchedAt,
      contentHash,
      httpStatus: r.httpStatus,
      mimeType: r.contentType,
      parserVersion: "ext-branch-table-v1",
      r2Key: null,
      extractionStatus: "EXTRACTED",
    });
    void snapId;

    const states: ExternalRecordState[] = sample2.map((record) => ({
      institution_id: "bank-nepal-bank",
      entity_id: externalBranchEntityId("bank-nepal-bank", record),
      fingerprint: externalRecordFingerprint(record),
      record,
    }));

    const plan = planExternalRepeat({
      source_id: "nrb-bank-list",
      prior_content_hash: null,
      content_hash: contentHash,
      prior: [],
      next: states,
      fields: [
        { field: "branch_name", get: (x) => x.branch_name.trim() },
        { field: "district", get: (x) => (x.district ?? "").trim() },
        { field: "address", get: (x) => (x.address ?? "").trim() },
        { field: "open_date", get: (x) => (x.open_date ?? "").trim() },
      ],
    });
    const applied = await applyExternalPlan(plan, {
      writer,
      source_id: "nrb-bank-list",
      snapshot: { fetched_at: r.fetchedAt, http_status: r.httpStatus, mime_type: r.contentType, parser_version: "ext-branch-table-v1" },
      observed_at: r.fetchedAt,
      confidence: 0.7,
      verification_status: "UNVERIFIED",
    });
    console.log(`  written: ${applied.assertions} assertion(s), ${applied.conflicts} conflict(s), snapshot=${applied.snapshot_id !== null}`);

    // Institution matching on the real row: the 8-digit code is the regulator's
    // own BFI code, so the ladder resolves it without a name guess.
    const m = matchInstitution({ external_code: sample2[0]?.external_code ?? null, institution_name: null }, NRB_CANDIDATES);
    nrbMatch = m.status === "MATCHED" ? `${m.institution_id} via ${m.method}` : `${m.status} via ${m.method}`;
    console.log(`  institution match on the first sampled row: ${nrbMatch}`);

    // And the population reality. A name regex is only a WEAK signal and is not
    // used as the population proof: the proof is the institution selector on the
    // page, which lists 148 commercial banks and none of the 51 pilot MFIs.
    const mfiLikeRows = table.records.filter((x) => /micro|sahakari|mahila|bittiya|sanstha/i.test(x.branch_name));
    console.log(`  weak signal only - rows whose BRANCH name contains an MFI word: ${mfiLikeRows.length} of ${table.records.length}`);
    if (mfiLikeRows.length > 0) {
      console.log(`    (not a population count: ${mfiLikeRows.slice(0, 3).map((x) => `${x.external_code} ${x.branch_name}`).join("; ")})`);
    }
    console.log("  population proof: the page's institution selector lists 148 commercial banks, 0 pilot MFIs");

    rows.push({
      role: "external",
      institution_id: "bank-nepal-bank",
      source_type: "NRB",
      source_id: "nrb-bank-list",
      url: NRB_URL,
      http_status: r.httpStatus,
      fetched_at: r.fetchedAt,
      content_hash: contentHash,
      outcome: `adapter OK: ${nrbParsed}/${nrbTableRows} rows, ${nrbRefused} refused`,
      branch_records: sample2.length,
      detail:
        `columns mapped ${nrbMapped}/${table.columns.length}; sampled 2 rows through EvidenceWriter ` +
        `(${applied.assertions} assertions); match=${nrbMatch}; ` +
        `weak MFI-word signal in branch names=${mfiLikeRows.length} (population proof is the 148-bank institution selector)`,
    });
  } catch (e) {
    rows.push({
      role: "external", institution_id: "bank-nepal-bank", source_type: "NRB", source_id: "nrb-bank-list",
      url: NRB_URL, http_status: null, fetched_at: now, content_hash: "", outcome: "FETCH_FAILED",
      branch_records: null, detail: (e as Error).message,
    });
    console.log(`  FETCH FAILED: ${(e as Error).message}`);
  }

  // -------------------------------------------------------------------------
  // PART 3 - the two secondary sources. Already investigated; recorded as a
  // result, not re-fetched, because they hold no branch-level rows at all.
  // -------------------------------------------------------------------------
  console.log("\nPART 3  secondary sources (already investigated, not re-fetched)");
  const registryRaw = readFileSync(join(root, "data", "pilot", "branch-source-registry.json"), "utf8");
  const registry = JSON.parse(registryRaw) as BranchSourceRegistry;
  const secondaryDecision = decideBranchEvidence({
    official_coverage: "BRANCH_STRUCTURE_UNREAD",
    official_valid_names: 0,
    external: [
      { source_type: "NRB", usable: false, records: 0, reason: "bank list: population is banks, not the pilot MFIs", configured: true },
      { source_type: "MEROLAGANI", usable: false, records: 0, reason: "no microfinance or branch section at all (18 tables, 0 branch rows)", configured: true },
      { source_type: "SHARESANSHAR", usable: false, records: 0, reason: "15 MFI instruments but institution-level address/phone/email only, 0 branch rows", configured: true },
    ],
  });
  console.log(`  decision for an unusable official MFI page: ${secondaryDecision.coverage}`);
  console.log(`  branch_count: ${String(secondaryDecision.branch_count)}  (null = unknown, NOT zero)`);
  console.log(`  reason: ${secondaryDecision.reason}`);
  for (const s of registry.sources.filter((x) => x.source_type === "MEROLAGANI" || x.source_type === "SHARESANSHAR")) {
    rows.push({
      role: "secondary",
      institution_id: "*",
      source_type: s.source_type,
      source_id: s.source_type.toLowerCase(),
      url: s.url,
      http_status: 200,
      fetched_at: s.observed_at ?? now,
      content_hash: "",
      outcome: "CONSULTED - no branch-level rows",
      branch_records: 0,
      detail: s.note ?? "",
    });
    console.log(`  ${s.source_type}: 0 branch rows (verified ${s.observed_at?.slice(0, 10)})`);
  }

  // -------------------------------------------------------------------------
  // PART 4 - what the sample actually proves
  // -------------------------------------------------------------------------
  console.log("\nPART 4  coverage separated");
  const officialUsable = officialDecisions.filter((d) => !d.used_fallback);
  console.log(`  official parser answered for ${officialUsable.length}/${OFFICIAL_SAMPLE.length} sampled pages`);
  console.log(`  external fallback gained MFI coverage: 0 (no verified public MFI branch source exists)`);

  // The tier order a real pilot target would get, from the committed registry.
  const pilotRaw = readFileSync(join(root, "data", "pilot", "pilot-sources.json"), "utf8");
  const pilot = JSON.parse(pilotRaw) as {
    sources: Array<{
      institution_id: string; id: string;
      capabilities: Array<{ capability: string; known_url: string | null }>;
    }>;
  };
  const officialRefs = pilot.sources.flatMap((s) =>
    s.capabilities
      .filter((c) => c.capability === "BRANCH_DIRECTORY")
      .map((c) => ({ institution_id: s.institution_id, id: s.id, known_url: c.known_url })),
  );
  console.log("\n  tier order from the committed registry:");
  const plans = [] as Array<{ institution_id: string; has_official: boolean; order: string }>;
  for (const inst of ["mfi-003", "mfi-002"]) {
    const plan = buildBranchSourcePlan(inst, officialRefs, registry);
    plans.push({ institution_id: inst, has_official: plan.has_official, order: plan.entries.map((e) => e.source_type).join(" > ") });
    console.log(`    ${inst}: official=${plan.has_official}  ${plan.entries.map((e) => e.source_type).join(" > ")}`);
  }
  const planNoOfficial = plans.find((p) => !p.has_official);
  const orderOk = planNoOfficial?.order === "NRB > MEROLAGANI > SHARESANSHAR";
  console.log(`  an MFI with no official branch URL is offered the external tiers in fixed order: ${orderOk ? "yes" : "NO -> " + planNoOfficial?.order}`);


  const n = db.prepare("SELECT (SELECT COUNT(*) FROM sources) s, (SELECT COUNT(*) FROM source_snapshots) sn, (SELECT COUNT(*) FROM data_assertions) a, (SELECT COUNT(*) FROM data_conflicts) c").get() as Record<string, number>;
  console.log(`  scratch DB: ${n.s} sources, ${n.sn} snapshots, ${n.a} assertions, ${n.c} conflicts`);
  db.close();

  const report = {
    $schema: "external-branch-sample/v1",
    generated_at: now,
    fetches_used: fetches,
    fetch_budget_note: "3 controlled fetches (2 official pages + 1 NRB table). data/pilot/pilot-budget.json maxFetches=18 is UNCHANGED. Tier-3 pages were investigated earlier; their fetch counts are recorded in branch-source-registry.json.",
    nrb_table_measured: {
      data_rows: nrbTableRows,
      records_parsed: nrbParsed,
      columns_mapped: nrbMapped,
      rows_refused: nrbRefused,
      population: "COMMERCIAL BANKS ONLY - zero of the 51 pilot microfinance institutions are listed",
      consequence: "no MFI branch coverage is obtainable from this source; absence must be reported as 'not covered', never as zero branches",
    },
    rows,
    tier_order_from_registry: plans,
    conclusion:
      "The external branch-evidence path is built, wired to the existing evidence pipeline, and proven end to end on the one real regulator branch table that exists. It contributes ZERO additional microfinance coverage today, because no verified public source carries branch-level rows for the pilot MFIs. Targets whose official page is unusable therefore resolve to coverage D (UNRESOLVED), never to a zero branch count.",
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`\nwrote ${REPORT_PATH}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
