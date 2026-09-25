// ============================================================================
// Phase R1 — Read-only ingestion control plane.
// Aggregates the existing ingestion evidence tables into an operational
// control view (sources, runs, items, snapshots, errors, validation,
// documents, conflicts, coverage, budget usage). READ-ONLY by design;
// no DDL, no writes, no new tables.
//
//   npm run control -- <absolute-or-relative-db-path>
//   env LK_PILOT_DB=path npm run control
//
// If neither is given, falls back to data/pilot/pilot-run-report.json
// (when its dbPath has not been redacted).
// ============================================================================

import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

type Row = Record<string, unknown>;
type DB = {
  prepare(sql: string): { get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[] };
};
function q(db: DB, sql: string, ...args: unknown[]): Row | undefined {
  return db.prepare(sql).get(...args);
}
function qa(db: DB, sql: string, ...args: unknown[]): Row[] {
  return db.prepare(sql).all(...args);
}

const z = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const pad = (s: string, w: number): string => String(s).padEnd(w).slice(0, w);
const num = (v: unknown): string => String(z(v));
const capsOf = (configJson: string): string => {
  try {
    const c = JSON.parse(configJson);
    const arr = Array.isArray(c.capabilities) ? c.capabilities : [];
    const names = arr
      .map((it: Record<string, unknown>) => (typeof it.capability === "string" ? it.capability : typeof it.intent === "string" ? String(it.intent) : undefined))
      .filter((x: unknown): x is string => typeof x === "string");
    return names.length ? names.join(",") : "-";
  } catch {
    return "INVALID";
  }
};

interface SourceRow {
  id: string;
  url: string;
  institution_id: string | null;
  enabled: number;
  config_json: string;
  last_run_at: string | null;
  last_success_at: string | null;
  error_count: number;
}

function main(): void {
  const fallbackRaw = existsSync(join(process.cwd(), "data", "pilot", "pilot-run-report.json"))
    ? (JSON.parse(readFileSync(join(process.cwd(), "data", "pilot", "pilot-run-report.json"), "utf8")) as { dbPath?: string }).dbPath
    : undefined;
  const dbPath = process.argv[2] ?? process.env.LK_PILOT_DB ?? (fallbackRaw && !fallbackRaw.startsWith("<") ? fallbackRaw : undefined);
  if (!dbPath) {
    console.error(
      "USAGE: npm run control -- <db-path>\n       or set LK_PILOT_DB. (pilot-run-report.json dbPath is redacted in the repo.)",
    );
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true });

  const sources = (qa(db, "SELECT * FROM ingestion_sources ORDER BY id") as unknown) as SourceRow[];

  // ---- top-level counts ---------------------------------------------------
  const runs = q(db, "SELECT COUNT(*) n FROM ingestion_runs") as Row;
  const items = q(db, "SELECT COUNT(*) n FROM ingestion_items") as Row;
  const snaps = q(db, "SELECT COUNT(*) n FROM source_snapshots") as Row;
  const docs = q(db, "SELECT COUNT(*) n FROM outbound_links WHERE target_type='DOCUMENT'") as Row;
  const errors = q(db, "SELECT COUNT(*) n FROM ingestion_errors") as Row;
  const conflicts = q(db, "SELECT COUNT(*) n, SUM(resolution_status='OPEN') o FROM data_conflicts") as Row;
  const validation = q(
    db,
    "SELECT SUM(status='PASS') p, SUM(status='FAIL') f, SUM(status='PENDING') d FROM validation_results",
  ) as Row;
  const budget = q(db, "SELECT COUNT(*) n FROM audit_logs WHERE action LIKE 'BUDGET%'") as Row;
  const audits = q(db, "SELECT COUNT(*) n FROM audit_logs") as Row;
  const instTotal = q(db, "SELECT COUNT(*) n FROM institutions") as Row;
  const instTracked = q(db, "SELECT COUNT(DISTINCT institution_id) n FROM ingestion_sources WHERE institution_id IS NOT NULL") as Row;
  const instSnapped = q(
    db,
    "SELECT COUNT(DISTINCT i.institution_id) n FROM ingestion_sources i JOIN source_snapshots ss ON ss.source_id=i.id WHERE i.institution_id IS NOT NULL",
  ) as Row;

  const line = "─".repeat(98);
  console.log(`\n${"═".repeat(98)}`);
  console.log("INGESTION CONTROL  (Phase R1 read-only control plane)");
  console.log(`${"═".repeat(98)}`);
  console.log(`db: ${dbPath}`);
  console.log(`snapshot: ${new Date().toISOString()}`);
  const kv = (label: string, value: string): string => `${pad(label, 26)}${value}`;
  console.log(line);
  console.log(
    `${kv("Institutions in DB", num(instTotal.n))}  ${kv("Ingestion sources", num(sources.length))}  ${kv("Covered", `${z(instTracked.n)}/${z(instTotal.n)}`)}`,
  );
  console.log(`${kv("With evidence", num(instSnapped.n))}  ${kv("Runs", num(runs.n))}  ${kv("Items", num(items.n))}  ${kv("Snapshots", num(snaps.n))}`);
  console.log(
    `${kv("Document links", num(docs.n))}  ${kv("Errors", num(errors.n))}  ${kv("Conflicts (open)", `${num(conflicts.n)} (${num(conflicts.o)})`)}  ${kv("Validation", `${num(validation.p)}P/${num(validation.f)}F/${num(validation.d)}D`)}`,
  );
  console.log(`${kv("Audit events", num(audits.n))}  ${kv("Budget events", num(budget.n))}  ${kv("Mode", "read-only, existing schema")}`);
  console.log(line);

  // ---- sources -----------------------------------------------------------
  console.log("\nSOURCES");
  console.log(
    `${pad("source", 22)}${pad("institution", 11)}${pad("caps", 42)}${pad("en", 3)}${pad("runs", 5)}${pad("snaps", 6)}${pad("items", 6)}${pad("docs", 5)}${pad("errs", 5)}${pad("val P/F", 7)}${pad("last-run", 20)}${pad("status", 9)}`,
  );
  for (const s of sources) {
    const r = q(
      db,
      `SELECT COUNT(*) runs,
              SUM(error_count) errs,
              (SELECT status FROM ingestion_runs r2 WHERE r2.ingestion_source_id=? ORDER BY r2.started_at DESC LIMIT 1) last_status,
              (SELECT started_at FROM ingestion_runs r2 WHERE r2.ingestion_source_id=? ORDER BY r2.started_at DESC LIMIT 1) last_run
         FROM ingestion_runs WHERE ingestion_source_id=?`,
      s.id, s.id, s.id,
    ) as Row;
    const snapsFor = q(db, "SELECT COUNT(*) n FROM source_snapshots WHERE source_id=?", s.id) as Row;
    const itemsFor = q(db, "SELECT COUNT(*) n FROM ingestion_items i JOIN ingestion_runs rr ON rr.id=i.run_id WHERE rr.ingestion_source_id=?", s.id) as Row;
    const docsFor = q(db, "SELECT COUNT(*) n FROM outbound_links WHERE source_id=? AND target_type='DOCUMENT'", s.id) as Row;
    const valFor = q(
      db,
      "SELECT SUM(vr.status='PASS') p, SUM(vr.status='FAIL') f FROM validation_results vr JOIN source_snapshots ss ON ss.id=vr.target_id WHERE ss.source_id=?",
      s.id,
    ) as Row;
    console.log(
      `${pad(s.id, 22)}${pad(s.institution_id ?? "-", 11)}${pad(capsOf(s.config_json).slice(0, 41), 42)}${pad(String(s.enabled), 3)}` +
        `${pad(num(r.runs), 5)}${pad(num(snapsFor.n), 6)}${pad(num(itemsFor.n), 6)}${pad(num(docsFor.n), 5)}${pad(num(r.errs), 5)}` +
        `${pad(`${num(valFor.p)}/${num(valFor.f)}`, 7)}${pad(String(r.last_run ?? "-").slice(0, 19), 20)}${pad(String(r.last_status ?? "-"), 9)}`,
    );
  }

  // ---- runs ---------------------------------------------------------------
  console.log("\nRUNS");
  const runByStatus = qa(db, "SELECT status, COUNT(*) n, MIN(started_at) first, MAX(started_at) last FROM ingestion_runs GROUP BY status ORDER BY n DESC");
  for (const r of runByStatus) {
    console.log(`  ${pad(String(r.status), 9)} ${pad(num(r.n), 4)} runs  first=${String(r.first).slice(0, 19)}  last=${String(r.last).slice(0, 19)}`);
  }
  const latestRuns = qa(
    db,
    `SELECT r.ingestion_source_id src, r.status, r.started_at, r.completed_at,
            (julianday(r.completed_at)-julianday(r.started_at))*86400 dur_s, r.items_found, r.items_changed, r.items_failed,
            r.error_count
       FROM ingestion_runs r
      WHERE r.started_at = (SELECT MAX(r2.started_at) FROM ingestion_runs r2 WHERE r2.ingestion_source_id=r.ingestion_source_id)
      ORDER BY r.ingestion_source_id`,
  );
  console.log(`${pad("source", 22)}${pad("status", 9)}${pad("dur_s", 7)}${pad("found", 6)}${pad("changed", 8)}${pad("failed", 7)}${pad("errs", 5)}  started`);
  for (const r of latestRuns) {
    console.log(
      `${pad(String(r.src), 22)}${pad(String(r.status), 9)}${pad(Number(r.dur_s).toFixed(1), 7)}${pad(num(r.items_found), 6)}${pad(num(r.items_changed), 8)}${pad(num(r.items_failed), 7)}${pad(num(r.error_count), 5)}  ${String(r.started_at).slice(0, 19)}`,
    );
  }

  // ---- source health (R2) ------------------------------------------------
  console.log("\nSOURCE HEALTH");
  console.log(
    `${pad("source", 21)} ${pad("status", 10)} ${pad("runs", 4)} ${pad("csf", 4)} ${pad("errs", 4)} ${pad("http", 4)} ${pad("mime", 15)} ${pad("hash", 13)} ${pad("last-change", 19)} ${pad("retry", 4)}`,
  );
  const healthCounts: Record<string, number> = {};
  for (const s of sources) {
    const h = q(
      db,
      `SELECT
         (SELECT status FROM ingestion_runs r2 WHERE r2.ingestion_source_id=? ORDER BY r2.started_at DESC LIMIT 1) last_status,
         (SELECT COUNT(*) FROM ingestion_runs r2 WHERE r2.ingestion_source_id=? AND r2.status='FAILED' AND r2.started_at >
            COALESCE((SELECT MAX(started_at) FROM ingestion_runs WHERE ingestion_source_id=? AND status IN ('SUCCESS','PARTIAL')), '')) consec_fails,
         (SELECT COUNT(*) FROM ingestion_runs r2 WHERE r2.ingestion_source_id=?) runs,
         (SELECT COUNT(*) FROM ingestion_errors e JOIN ingestion_runs rr ON rr.id=e.run_id WHERE rr.ingestion_source_id=?) errs`,
      s.id, s.id, s.id, s.id, s.id,
    ) as Row;
    const lastSnap = q(
      db,
      "SELECT http_status, mime_type, content_hash FROM source_snapshots WHERE source_id=? ORDER BY fetched_at DESC LIMIT 1",
      s.id,
    ) as Row;
    const lastChange = q(
      db,
      `SELECT MAX(r.started_at) t FROM ingestion_runs r JOIN ingestion_items i ON i.run_id=r.id
        WHERE r.ingestion_source_id=? AND i.status='CHANGED'`,
      s.id,
    ) as Row;
    const retryFor = q(
      db,
      "SELECT IFNULL(SUM(e.retry_count),0) n FROM ingestion_errors e JOIN ingestion_runs r ON r.id=e.run_id WHERE r.ingestion_source_id=?",
      s.id,
    ) as Row;
    const status = z(h.runs) === 0 ? "NEVER-RUN" : (h.last_status as string) === "FAILED" && z(h.consec_fails) >= 2 ? "UNHEALTHY" : (h.last_status as string) === "FAILED" || (h.last_status as string) === "PARTIAL" || z(h.errs) > 0 ? "DEGRADED" : "HEALTHY";
    healthCounts[status] = z(healthCounts[status]) + 1;
    console.log(
      `${pad(s.id, 21)} ${pad(status, 10)} ${pad(num(h.runs), 4)} ${pad(num(h.consec_fails), 4)} ${pad(num(h.errs), 4)} ` +
        `${pad(lastSnap && lastSnap.http_status !== null ? String(lastSnap.http_status) : "-", 4)} ${pad(lastSnap ? String(lastSnap.mime_type).slice(0, 14) : "-", 15)} ` +
        `${pad(lastSnap && lastSnap.content_hash ? (lastSnap.content_hash as string).slice(0, 12) : "-", 13)} ${pad(lastChange && lastChange.t ? String(lastChange.t).slice(0, 19) : "-", 19)} ${pad(num(retryFor.n), 4)}`,
    );
  }
  const healthSummary = Object.entries(healthCounts)
    .map(([k, v]) => `${k}=${v}`)
    .join("  ");
  console.log(`  health summary: ${healthSummary}`);

  // ---- items --------------------------------------------------------------
  console.log("\nITEMS");
  const itemsByStatus = qa(db, "SELECT status, COUNT(*) n FROM ingestion_items GROUP BY status ORDER BY n DESC");
  const totalItems = itemsByStatus.reduce((a, r) => a + z(r.n), 0);
  for (const r of itemsByStatus) {
    const pct = totalItems ? ((z(r.n) / totalItems) * 100).toFixed(1) : "0";
    console.log(`  ${pad(String(r.status), 10)} ${pad(num(r.n), 6)}  ${pct}%`);
  }
  const changedUrls = qa(
    db,
    `SELECT i.url, i.status, r.started_at FROM ingestion_items i JOIN ingestion_runs r ON r.id=i.run_id
      WHERE i.status = 'CHANGED' ORDER BY r.started_at DESC LIMIT 12`,
  );
  console.log("  recent meaningful CHANGED:");
  for (const c of changedUrls) console.log(`    ${String(c.started_at).slice(0, 19)}  ${String(c.url)}`);

  // ---- snapshots / evidence ----------------------------------------------
  console.log("\nSNAPSHOTS / EVIDENCE");
  const byMime = qa(db, "SELECT mime_type m, COUNT(*) n FROM source_snapshots GROUP BY mime_type ORDER BY n DESC");
  for (const r of byMime) console.log(`  mime ${pad(String(r.m).slice(0, 34), 34)} ${num(r.n)}`);
  const byExtract = qa(db, "SELECT extraction_status s, COUNT(*) n FROM source_snapshots GROUP BY extraction_status ORDER BY n DESC");
  for (const r of byExtract) console.log(`  extraction ${pad(String(r.s), 9)} ${num(r.n)}`);
  const pdf = q(db, "SELECT COUNT(*) n FROM source_snapshots WHERE mime_type LIKE '%pdf%'") as Row;
  const dup = q(
    db,
    "SELECT COUNT(*) n FROM (SELECT source_id, content_hash FROM source_snapshots GROUP BY source_id, content_hash HAVING COUNT(*) > 1)",
  ) as Row;
  console.log(`  PDF snapshots: ${num(pdf.n)}   duplicate content-hash groups (should be 0): ${num(dup.n)}`);
  const snapChanged = q(db, "SELECT COUNT(*) n FROM source_snapshots WHERE mime_type LIKE '%pdf%' AND extraction_status='SKIPPED'") as Row;
  if (z(pdf.n)) console.log(`  PDF with extraction SKIPPED (no OCR, evidence only): ${num(snapChanged.n)}`);

  // ---- errors -------------------------------------------------------------
  console.log("\nERRORS");
  const errs = qa(db, "SELECT error_type t, error_message m, COUNT(*) n FROM ingestion_errors GROUP BY error_type, error_message ORDER BY n DESC LIMIT 8");
  if (errs.length === 0) console.log("  none recorded");
  for (const e of errs) console.log(`  ${pad(String(e.t), 14)} ${pad(num(e.n), 4)}  ${String(e.m).slice(0, 70)}`);
  const retry = qa(db, "SELECT SUM(retry_count) n FROM ingestion_errors")[0];
  console.log(`  total recorded retry_count on errors: ${num(retry.n)}`);

  // ---- validation ---------------------------------------------------------
  console.log("\nVALIDATION");
  const rules = qa(
    db,
    `SELECT r.rule_code, r.name, SUM(v.status='PASS') p, SUM(v.status='FAIL') f
       FROM validation_results v JOIN validation_rules r ON r.id=v.rule_id
      GROUP BY r.id ORDER BY r.rule_code`,
  );
  for (const rl of rules) console.log(`  rule ${pad(String(rl.rule_code), 16)} ${pad(String(rl.name).slice(0, 28), 28)} PASS=${num(rl.p)} FAIL=${num(rl.f)}`);
  if (rules.length === 0) console.log("  no validation_results rows");
  const failing = qa(
    db,
    `SELECT v.message, COUNT(*) n FROM validation_results v WHERE v.status='FAIL' GROUP BY v.message ORDER BY n DESC LIMIT 8`,
  );
  if (failing.length) {
    console.log("  FAIL messages:");
    for (const f of failing) console.log(`    ${pad(num(f.n), 3)}  ${String(f.message).slice(0, 80)}`);
  }

  // ---- documents ----------------------------------------------------------
  console.log("\nDOCUMENTS (outbound_links target_type=DOCUMENT)");
  const docsByAvail = qa(
    db,
    "SELECT availability_status s, COUNT(*) n FROM outbound_links WHERE target_type='DOCUMENT' GROUP BY availability_status ORDER BY n DESC",
  );
  for (const d of docsByAvail) console.log(`  availability ${pad(String(d.s), 10)} ${num(d.n)}`);
  const docsByInst = qa(
    db,
    `SELECT institution_id i, COUNT(*) n FROM outbound_links WHERE target_type='DOCUMENT' AND institution_id IS NOT NULL GROUP BY institution_id ORDER BY n DESC`,
  );
  for (const d of docsByInst) console.log(`  institution ${pad(String(d.i), 12)} ${num(d.n)} documents`);
  const pdfLinks = qa(db, "SELECT target_url u FROM outbound_links WHERE target_type='DOCUMENT' AND lower(target_url) LIKE '%.pdf' ORDER BY target_url");
  if (pdfLinks.length) {
    console.log("  PDF document links:");
    for (const p2 of pdfLinks) console.log(`    ${String(p2.u)}`);
  }

  // ---- people / leadership (Phase R3) -------------------------------------
  console.log("\nPEOPLE / LEADERSHIP (assertions)");
  const peopleFields = qa(
    db,
    `SELECT field_name f, COUNT(*) n,
            SUM(verification_status='UNVERIFIED') un, SUM(verification_status='HUMAN_VERIFIED') hv
       FROM data_assertions WHERE field_name LIKE 'people%'
      GROUP BY field_name ORDER BY field_name`,
  );
  if (peopleFields.length === 0) {
    console.log("  none recorded (R3 people extraction not yet run on this DB)");
  }
  for (const p of peopleFields) {
    console.log(`  ${pad(String(p.f), 20)} ${pad(num(p.n), 4)}  UNVERIFIED=${num(p.un)} HUMAN_VERIFIED=${num(p.hv)}`);
  }
  const peopleVal = qa(
    db,
    `SELECT status, COUNT(*) n FROM validation_results v JOIN validation_rules r ON r.id=v.rule_id
      WHERE r.rule_code='PEOPLE_DIRECTORY' GROUP BY status ORDER BY status`,
  );
  if (peopleVal.length) {
    console.log("  people-directory validation:");
    for (const v of peopleVal) console.log(`    ${pad(String(v.status), 9)} ${num(v.n)}`);
  } else {
    console.log("  people-directory rule: not present in this DB");
  }

  // ---- structured metadata (Phase R4) -------------------------------------
  console.log("\nSTRUCTURED METADATA (branch / vacancy / financial assertions)");
  const structFields = qa(
    db,
    `SELECT field_name f, COUNT(*) n FROM data_assertions
      WHERE field_name LIKE 'branch_%' OR field_name LIKE 'vacancy_%' OR field_name LIKE 'document_%'
     GROUP BY field_name ORDER BY field_name`,
  );
  if (structFields.length === 0) {
    console.log("  none recorded (R4 extraction not yet run on this DB)");
  }
  for (const s of structFields) {
    console.log(`  ${pad(String(s.f), 20)} ${pad(num(s.n), 4)}`);
  }
  const structVal = qa(
    db,
    `SELECT r.rule_code c, status, COUNT(*) n FROM validation_results v JOIN validation_rules r ON r.id=v.rule_id
      WHERE r.rule_code IN ('BRANCH_DIRECTORY','VACANCIES','FINANCIAL_METADATA')
     GROUP BY r.rule_code, status ORDER BY r.rule_code, status`,
  );
  if (structVal.length === 0) {
    console.log("  structured-metadata rules: not present in this DB");
  }
  for (const v of structVal) {
    console.log(`  ${pad(String(v.c), 22)} ${pad(String(v.status), 9)} ${num(v.n)}`);
  }

  // ---- conflicts ----------------------------------------------------------
  console.log("\nCONFLICTS");
  const conflictsByStatus = qa(db, "SELECT resolution_status s, COUNT(*) n FROM data_conflicts GROUP BY resolution_status ORDER BY n DESC");
  for (const c of conflictsByStatus) console.log(`  ${pad(String(c.s), 9)} ${num(c.n)}`);
  if (conflictsByStatus.length === 0) console.log("  none recorded");

  // ---- coverage -----------------------------------------------------------
  console.log("\nCOVERAGE");
  console.log(`  institutions in DB: ${num(instTotal.n)}`);
  console.log(`  institutions with ingestion source: ${num(instTracked.n)}`);
  console.log(`  institutions with evidence snapshots: ${num(instSnapped.n)}`);
  console.log(`  ingestion sources: ${sources.length}`);
  const noSource = q(db, "SELECT COUNT(*) n FROM institutions i WHERE NOT EXISTS (SELECT 1 FROM ingestion_sources s WHERE s.institution_id=i.id)") as Row;
  console.log(`  institutions NOT yet tracked as ingestion sources: ${num(noSource.n)}`);

  // ---- budget usage -------------------------------------------------------
  console.log("\nBUDGET USAGE");
  const budgetByAction = qa(db, "SELECT action a, COUNT(*) n FROM audit_logs WHERE action LIKE 'BUDGET%' GROUP BY action ORDER BY n DESC");
  if (budgetByAction.length === 0) console.log("  no budget-exhaustion events (caps not hit)");
  for (const b of budgetByAction) console.log(`  ${pad(String(b.a), 26)} ${num(b.n)}`);
  const budgetBySource = qa(
    db,
    `SELECT target_id src, COUNT(*) n FROM audit_logs WHERE action LIKE 'BUDGET%' GROUP BY target_id ORDER BY n DESC`,
  );
  for (const b of budgetBySource) console.log(`  ${pad(String(b.src), 22)} ${num(b.n)}`);

  console.log(`\n${"═".repeat(98)}`);
  console.log("End of R1 control-plane snapshot. Read-only: nothing was written.");
  console.log(`${"═".repeat(98)}\n`);
  db.close();
}

main();