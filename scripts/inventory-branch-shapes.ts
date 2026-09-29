// M3.4 Phase 4 (BRANCH COVERAGE INVENTORY) - no branch assertions are written.
//
// Discipline: test the real source shapes BEFORE writing an extractor. A page
// that carries a BRANCH_DIRECTORY capability is NOT assumed to contain branch
// records. This script fetches the branch URLs the project already committed to,
// records snapshot evidence (url / content_hash / mime / fetched_at), and reports
// three SEPARATE things per target:
//
//   SECTION A  structure   - measured from the HTML, no parser output involved
//   SECTION B  parser      - what branch-html-v1 actually read, in memory only
//   SECTION C  coverage    - deterministic class derived from A and B
//
// Sections A and B must never be conflated. "the parser read 212 names" is not
// "the page is a 212-row record table", and Phase 4 exists so the report can no
// longer imply that.
//
// Deterministic, AI-free, no browser/JS rendering, no institution-specific rules.
// Uses the same ControlledFetcher policy and pilot budget as the M3.3 pilots.
//
//   npx tsx scripts/inventory-branch-shapes.ts
//
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { ControlledFetcher, nodeResolveHost } from "../lib/ingestion";
import {
  classifyCoverage,
  signalsOf,
  structuralDensities,
  structuralEvidence,
  type BranchCoverage,
  type StructureKind,
  type StructuralEvidence,
} from "../lib/ingestion/shape-signals";
import { analyzeBranchPage, BRANCH_PARSER_ID } from "../lib/ingestion/structured";
import { peopleExtractor } from "../lib/ingestion/people";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string) => {
  prepare(s: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): Array<Record<string, unknown>>; get(...a: unknown[]): Record<string, unknown> };
  exec(s: string): void;
  close(): void;
};

const DB = "data/pilot/evidence/pilot-branch-shapes-2026-09-27.db";
const OUT = "data/pilot/branch-shape-inventory.json";
const MAX_FETCHES = 40;

// ---------------------------------------------------------------------------
// Generic branch vocabulary (En + Ne). Lexical signal only - never a rule for
// asserting a record on its own.
// ---------------------------------------------------------------------------
function policyFor(url: string, budget: Record<string, number>) {
  const host = new URL(url).hostname;
  const apex = host.replace(/^www\./i, "");
  return {
    allowedHosts: [...new Set(apex === host ? [host] : [host, apex])],
    allowSubdomainsOf: [apex],
    maxBytes: budget.maxBytes,
    maxRedirects: budget.maxRedirects,
    maxRetries: budget.maxRetries,
    timeoutMs: 15000,
    minIntervalMs: 250,
    resolveHost: nodeResolveHost,
  };
}

interface Row {
  sourceId: string;
  institutionId: string | null;
  url: string;
  linkType: string | null;
  backfillNote: string | null;
}

async function main(): Promise<void> {
  const pilot = JSON.parse(readFileSync("data/pilot/pilot-sources.json", "utf8")) as {
    sources: Array<{
      id: string;
      institution_id?: string;
      capabilities: Array<{ capability: string; known_url: string | null; link_type?: string; note?: string }>;
    }>;
  };
  const budgetCfg = JSON.parse(readFileSync("data/pilot/pilot-budget.json", "utf8")) as {
    defaults: Record<string, number>;
    perSource: Record<string, Record<string, number>>;
  };
  const budget = budgetCfg.defaults;

  // Only branch URLs the project already committed to. Nothing is invented.
  const targets: Row[] = [];
  for (const s of pilot.sources) {
    for (const c of s.capabilities) {
      if (c.capability === "BRANCH_DIRECTORY" && c.known_url) {
        targets.push({
          sourceId: s.id,
          institutionId: s.institution_id ?? null,
          url: c.known_url,
          linkType: c.link_type ?? null,
          backfillNote: c.note ?? null,
        });
      }
    }
  }
  console.log(`BRANCH_DIRECTORY targets committed in pilot-sources.json: ${targets.length}`);

  // The file must be probed BEFORE opening, because better-sqlite3 creates it.
  const isNewDb = !existsSync(DB);
  const db = new Database(DB);
  if (isNewDb) {
    db.exec(readFileSync(join(process.cwd(), "schema", "schema.sql"), "utf8"));
  }
  db.prepare("PRAGMA foreign_keys = ON").run();

  const results: Array<Record<string, unknown>> = [];
  let fetched = 0;
  let verified = 0;
  let needsWork = 0;

  for (const t of targets) {
    if (fetched >= MAX_FETCHES) {
      results.push({ ...t, shape: "SKIPPED_BUDGET", detail: `fetch cap ${MAX_FETCHES} reached` });
      continue;
    }
    db.prepare(
      `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, is_active, created_at)
       VALUES (?, 'MFB_WEBSITE', 'INSTITUTION', 'A', ?, ?, ?, 1, ?)`,
    ).run(t.sourceId, t.url, new URL(t.url).hostname, `${t.sourceId} branch shape inventory`, new Date().toISOString());

    const policy = policyFor(t.url, budget);
    const fetcher = new ControlledFetcher(policy);
    fetched++;
    let out;
    try {
      out = await fetcher.fetchControlled({ url: t.url, requestId: `m34-shape-${t.sourceId}-${fetched}` });
    } catch (e) {
      results.push({ ...t, shape: "FETCH_FAILED", detail: (e as Error).message });
      continue;
    }
    const r = out.result;
    const html = new TextDecoder().decode(r.body);
    const contentHash = r.contentHash || createHash("sha256").update(r.body).digest("hex");

    // Snapshot evidence only. No data_assertions are written by this script.
    const snapId = `snap-m34-${String(fetched).padStart(3, "0")}-${createHash("sha256").update(t.url).digest("hex").slice(0, 8)}`;
    db.prepare(
      `INSERT OR REPLACE INTO source_snapshots (id, source_id, fetched_at, content_hash, http_status, mime_type, parser_version, extraction_status)
       VALUES (?, ?, ?, ?, ?, ?, 'branch-shape-inventory-v1', 'PENDING')`,
    ).run(snapId, t.sourceId, r.fetchedAt, contentHash, r.httpStatus, r.contentType);

    // --- SECTION A: objective structure, measured on the nav/footer-stripped
    // body. No parser output is consulted here.
    const structure: StructuralEvidence = structuralEvidence(html);
    const densities = structuralDensities(structure);
    const s = signalsOf(html);

    // --- SECTION B: parser result, in memory only. Nothing is persisted as an
    // assertion. analyzeBranchPage reports the winning grammar plus candidate /
    // valid / refused counts.
    const analysis = analyzeBranchPage(html);
    const peopleDry = await peopleExtractor.extract({
      sourceId: t.sourceId,
      institutionId: t.institutionId ?? undefined,
      sourceType: "MFB_WEBSITE",
      capability: "PEOPLE",
      url: r.finalUrl,
      parserId: "branch-shape-inventory",
      contentHash,
      body: r.body,
    });
    const roleBearingPeople = peopleDry.filter((e) => e.kind === "FIELD").length;

    // --- SECTION C: coverage class. A pure function of sections A and B, so the
    // same inputs always produce the same class.
    const verdict = classifyCoverage({
      structural: structure,
      densities,
      validNames: analysis.validNames,
      candidateRecords: analysis.candidateRecords,
      rejectedNames: analysis.rejectedNames,
      branchVocabHits: s.branchVocabHits,
      roleBearingPeople,
      httpStatus: r.httpStatus,
      bodyBytes: r.bodyBytes,
    });
    const coverage: BranchCoverage = verdict.coverage;
    const structureKind: StructureKind = verdict.structureKind;
    if (coverage === "VERIFIED_BRANCH_DIRECTORY") verified++;
    if (coverage === "PARTIAL_BRANCH_DIRECTORY" || coverage === "BRANCH_STRUCTURE_UNREAD") needsWork++;

    results.push({
      ...t,
      finalUrl: r.finalUrl,
      httpStatus: r.httpStatus,
      mimeType: r.contentType,
      bytes: r.bodyBytes,
      fetchedAt: r.fetchedAt,
      contentHash,
      redirected: r.redirectCount,
      snapshotId: snapId,

      // SECTION A — structure
      structure: { ...structure, densities },
      structureKind,

      // SECTION B — parser result
      parser: {
        path: analysis.path,
        candidateRecords: analysis.candidateRecords,
        validNames: analysis.validNames,
        rejectedNames: analysis.rejectedNames,
        evidenceOnlyRows: analysis.evidenceOnlyRows,
        // Weak cards are reported, not silently dropped: a page whose only branch
        // evidence is a name-only card must show why nothing was asserted.
        weakCardCandidates: analysis.weakCardCandidates,
        namesFromPersonCards: analysis.namesFromPersonCards,
        refusedCardCandidates: analysis.refusedCardCandidates,
        attributes: analysis.attributes,
        nameSample: analysis.nameSamples,
        rejectedNameSample: analysis.rejectedNameSamples,
        roleBearingPeople,
      },

      // SECTION C — coverage classification
      coverage,
      coverageReason: verdict.reason,
      structuralRecords: verdict.structuralRecords,
      structuralRecordsMax: verdict.structuralRecordsMax,

      // legacy flat signals, kept so the Phase 1 baseline doc stays comparable
      signals: s,
      shape: coverage,
      dryRunBranchNames: analysis.validNames,
    });

    console.log(
      `  ${t.sourceId.padEnd(28)} ${String(r.httpStatus ?? "ERR").padStart(3)} ${String(r.bodyBytes).padStart(7)}B  ${coverage.padEnd(28)} path=${analysis.path.padEnd(5)} names=${String(analysis.validNames).padStart(3)}/${String(analysis.candidateRecords).padStart(3)} struct=${structureKind}(${verdict.structuralRecords}${verdict.structuralRecordsMax > verdict.structuralRecords ? `-${verdict.structuralRecordsMax}` : ""})`,
    );
  }

  const dist: Record<string, number> = {};
  const byStructure: Record<string, number> = {};
  for (const r of results) {
    dist[String(r.coverage)] = (dist[String(r.coverage)] ?? 0) + 1;
    const k = String(r.structureKind);
    byStructure[k] = (byStructure[k] ?? 0) + 1;
  }

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        $schema: "branch-coverage-inventory/v2",
        generated_at: new Date().toISOString(),
        purpose: "PRE-ASSERTION branch coverage inventory. No branch assertions written. No schema change.",
        parser_under_audit: `${BRANCH_PARSER_ID} (table-scoped record table, then M3.4 evidence-gated card and <br>-cell fallbacks; self-limits to capability BRANCH_DIRECTORY)`,
        committed_targets: targets.length,
        fetched,
        verified_directory: verified,
        needs_structural_work: needsWork,
        sectionA_structure_note: "structure / structureKind are measured from the HTML with no parser output involved.",
        sectionB_parser_note: `parser reports what ${BRANCH_PARSER_ID} did: winning grammar (table|card|cell|none), candidate records, weak evidence-only cards, refused names, gate results, attribute tallies by reason code.`,
        sectionC_coverage_note: "coverage is a pure function of sections A and B, ordered: UNREADABLE_BODY, NOT_A_BRANCH_PAGE, BRANCH_LOCATOR_UNRENDERED, VERIFIED_BRANCH_DIRECTORY, PARTIAL_BRANCH_DIRECTORY, BRANCH_STRUCTURE_UNREAD, SINGLE_LOCATION_CONTACT, BRANCH_INTENT_NO_STRUCTURE.",
        shapeDistribution: dist,
        structureKindDistribution: byStructure,
        results,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  db.close();

  console.log(`\nSECTION C — coverage classification:`);
  for (const [k, v] of Object.entries(dist).sort((x, y) => y[1] - x[1])) console.log(`  ${k.padEnd(30)} ${v}`);
  console.log(`\nSECTION A — structure kind (parser-independent):`);
  for (const [k, v] of Object.entries(byStructure).sort((x, y) => y[1] - x[1])) console.log(`  ${k.padEnd(30)} ${v}`);
  console.log(`\nVERIFIED_BRANCH_DIRECTORY: ${verified} / ${fetched}   needs structural work: ${needsWork}`);
  console.log(`report: ${OUT}`);
  console.log(`evidence db: ${DB} (snapshots only, zero data_assertions)`);
}


void main();
