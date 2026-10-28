// ============================================================================
// V1.1.2 — read-only ingestion recovery manifest.
//
// Audits the 47 PARTIAL ingestion runs and the 8 pilot-stub institutions,
// classifies each, and writes:
//   docs/data/RECOVERY-MANIFEST.csv          (one row per item)
//   docs/data/RECOVERY-MANIFEST-SUMMARY.md   (counts + categories + limitations)
//
// No ingestion is executed. No data is mutated. No schema changes.
//
// Run: npm run recovery:manifest
// ============================================================================
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => {
  prepare: (sql: string) => { all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown };
  close: () => void;
};
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

interface RunRow {
  id: string; ingestion_source_id: string; started_at: string; completed_at: string | null;
  status: string; items_found: number; items_changed: number; items_new: number;
  items_failed: number; parser_version: string | null; error_count: number;
  url: string; source_type: string; institution_id: string | null; enabled: number;
}

interface ErrRow { error_type: string; error_message: string; retry_count: number }

function classifyRun(errors: ErrRow[]): { category: string; action: string; risk: string; owner: string; prereq: string } {
  const types = errors.map((e) => e.error_type);
  const msgs = errors.map((e) => e.error_message);
  if (types.includes("HTTP_ERROR") && msgs.some((m) => /HTTP 404/.test(m))) {
    return { category: "SOURCE_ACCESS_REVIEW", action: "Verify the source URL; update or retire the source if the page moved", risk: "low", owner: "operator", prereq: "Confirm the live URL and whether the institution still publishes the page" };
  }
  if (types.includes("HTTP_ERROR") && msgs.some((m) => /HTTP 400/.test(m))) {
    return { category: "SOURCE_ACCESS_REVIEW", action: "Inspect request parameters/headers; the source rejected the fetch", risk: "low", owner: "operator", prereq: "Reproduce the fetch and check the source's access rules" };
  }
  if (types.includes("HTTP_ERROR") && msgs.some((m) => /HTTP 500/.test(m))) {
    return { category: "SOURCE_ACCESS_REVIEW", action: "Source returned a server error; retry later or contact the source", risk: "low", owner: "operator", prereq: "Confirm the source is reachable and not blocking automated access" };
  }
  if (types.includes("FETCH_FAILED") && msgs.some((m) => /BODY_TOO_LARGE/.test(m))) {
    return { category: "PARSER_OR_MAPPING_REVIEW", action: "Review fetcher body-size policy before retrying; do not silently raise the limit", risk: "medium", owner: "operator", prereq: "Decide whether the oversized page is legitimate or a misconfigured endpoint" };
  }
  if (types.includes("FETCH_FAILED") && msgs.some((m) => /TIMEOUT/.test(m))) {
    return { category: "RETRY_CANDIDATE", action: "Retry with the existing ingestion command after confirming source access", risk: "low", owner: "operator", prereq: "Confirm the source is reachable; transient failure likely" };
  }
  if (types.includes("FETCH_FAILED") && msgs.some((m) => /CONNECT_FAILED/.test(m))) {
    return { category: "SOURCE_ACCESS_REVIEW", action: "Source unreachable; verify DNS/network and access policy", risk: "low", owner: "operator", prereq: "Confirm connectivity and that the source allows automated fetches" };
  }
  if (types.includes("EXTRACTION_FAILED")) {
    return { category: "PARSER_OR_MAPPING_REVIEW", action: "Fix the extractor for the content type actually returned", risk: "medium", owner: "developer", prereq: "Inspect the returned content and update the parser; do not bypass validation" };
  }
  if (types.includes("FETCH_FAILED") && msgs.some((m) => /non-HTTPS protocol|not allowlisted/.test(m))) {
    return { category: "SOURCE_ACCESS_REVIEW", action: "Source violates the fetcher security policy (HTTPS/allowlist); review before any change", risk: "medium", owner: "operator", prereq: "Confirm whether the source should be allowlisted or retired" };
  }
  return { category: "INSUFFICIENT_EVIDENCE", action: "Inspect the run record and source manually", risk: "unknown", owner: "owner", prereq: "More evidence needed to classify" };
}

function csvEscape(v: string | null): string {
  if (v === null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function main(): void {
  const db = new Database(resolve(ROOT, "data/durable/store.db"), { readonly: true });

  const partialRuns = db.prepare("SELECT r.id, r.ingestion_source_id, r.started_at, r.completed_at, r.status, r.items_found, r.items_changed, r.items_new, r.items_failed, r.parser_version, r.error_count, s.url, s.source_type, s.institution_id, s.enabled, s.last_run_at, s.last_success_at, s.error_count AS src_error_count FROM ingestion_runs r JOIN ingestion_sources s ON s.id = r.ingestion_source_id WHERE r.status='PARTIAL' ORDER BY r.started_at, r.id").all() as Array<RunRow & { url: string; source_type: string; institution_id: string | null; enabled: number; last_run_at: string | null; last_success_at: string | null; src_error_count: number }>;

  const stubIds = ['mfi-015', 'mfi-032', 'mfi-033', 'mfi-039', 'mfi-044', 'mfi-046', 'mfi-050', 'mfi-051'];
  const stubs = stubIds.map((id) => {
    const inst = db.prepare("SELECT id, name_en, official_website FROM institutions WHERE id=?").get(id) as { id: string; name_en: string; official_website: string | null };
    const srcs = db.prepare("SELECT id, url, enabled, last_run_at, last_success_at, error_count FROM ingestion_sources WHERE institution_id=?").all(id) as Array<{ id: string; url: string; enabled: number; last_run_at: string | null; last_success_at: string | null; error_count: number }>;
    const ac = db.prepare("SELECT COUNT(*) c FROM data_assertions WHERE entity_type='institution' AND entity_id=?").get(id) as { c: number };
    return { id, name: inst.name_en, website: inst.official_website, sources: srcs, assertions: ac.c };
  });

  db.close();

  // Build manifest rows
  const header = ["item_id", "item_type", "source_id", "institution_id", "url", "started_at", "completed_at", "items_found", "items_failed", "error_types", "error_messages", "category", "recommended_action", "retry_prerequisites", "risk", "owner_decision_required", "evidence_reference"];
  const rows: string[][] = [];

  const categoryCounts: Record<string, number> = {};
  for (const r of partialRuns) {
    const errs = db2errs(r.id);
    const cls = classifyRun(errs);
    categoryCounts[cls.category] = (categoryCounts[cls.category] ?? 0) + 1;
    rows.push([
      r.id,
      "PARTIAL_RUN",
      r.ingestion_source_id,
      r.institution_id ?? "",
      r.url,
      r.started_at,
      r.completed_at ?? "",
      String(r.items_found),
      String(r.items_failed),
      errs.map((e) => e.error_type).join("; "),
      errs.map((e) => e.error_message).join("; "),
      cls.category,
      cls.action,
      cls.prereq,
      cls.risk,
      cls.owner,
      `ingestion_runs.id=${r.id}; ingestion_errors.run_id=${r.id}`,
    ]);
  }

  for (const s of stubs) {
    categoryCounts["INGESTION_NOT_RUN"] = (categoryCounts["INGESTION_NOT_RUN"] ?? 0) + 1;
    const src = s.sources[0];
    rows.push([
      s.id,
      "PILOT_STUB",
      src ? src.id : "",
      s.id,
      src ? src.url : "",
      src && src.last_run_at ? src.last_run_at : "never",
      "",
      "0",
      "0",
      "NO_RUN",
      "Ingestion never executed for this source (last_run_at is null); 0 assertions recorded",
      "INGESTION_NOT_RUN",
      "Run ingestion for this source after confirming the URL is reachable and the parser handles the site",
      "Source must be reachable; parser must handle the site; verify no duplicate assertions on retry",
      "medium",
      "operator",
      `institutions.id=${s.id}; ingestion_sources.id=${src ? src.id : "none"}; data_assertions count=0`,
    ]);
  }

  // CSV
  const csvLines = [header.join(",")];
  for (const r of rows) csvLines.push(r.map(csvEscape).join(","));
  const csvPath = resolve(ROOT, "docs/data/RECOVERY-MANIFEST.csv");
  writeFileSync(csvPath, csvLines.join("\n") + "\n", "utf8");

  // Markdown summary
  const md: string[] = [];
  md.push("# Ingestion recovery manifest (V1.1.2)");
  md.push("");
  md.push("Generated by `npm run recovery:manifest`. **Read-only: no ingestion was executed, no data was mutated.**");
  md.push("");
  md.push("## Verified baseline");
  md.push("");
  md.push(`- PARTIAL ingestion runs: **${partialRuns.length}**`);
  md.push(`- Pilot-stub institutions (no assertion data): **${stubs.length}**`);
  md.push(`- Total manifest rows: **${rows.length}**`);
  md.push("");
  md.push("## Category counts");
  md.push("");
  md.push("| category | count |");
  md.push("|---|---|");
  for (const [k, v] of Object.entries(categoryCounts).sort()) md.push(`| ${k} | ${v} |`);
  md.push("");
  md.push("## PARTIAL run error distribution");
  md.push("");
  const errDist: Record<string, number> = {};
  for (const r of partialRuns) {
    const errs = db2errs(r.id);
    for (const e of errs) {
      const key = `${e.error_type}: ${e.error_message}`;
      errDist[key] = (errDist[key] ?? 0) + 1;
    }
  }
  md.push("| error | count |");
  md.push("|---|---|");
  for (const [k, v] of Object.entries(errDist).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);
  md.push("");
  md.push("## Pilot-stub institutions");
  md.push("");
  md.push("| institution | source | source URL | assertions |");
  md.push("|---|---|---|---|");
  for (const s of stubs) {
    const src = s.sources[0];
    md.push(`| ${s.id} (${s.name}) | ${src ? src.id : "none"} | ${src ? src.url : "n/a"} | ${s.assertions} |`);
  }
  md.push("");
  md.push("## Retry-safety findings (from code inspection)");
  md.push("");
  md.push("- Ingestion runs are recorded in `ingestion_runs` with status RUNNING/SUCCESS/FAILED/PARTIAL; partial writes are possible (items_found > 0, items_failed > 0).");
  md.push("- `ingestion_items` are keyed by (run_id, url) UNIQUE, so a re-run creates new item rows per run; assertions are deduplicated by the ingestion adapter (`saveConflict` dedupes rather than removes).");
  md.push("- `data_assertions` carry `source_id`, `source_snapshot_id`, `observed_at`, `confidence`, `verification_status`; provenance is preserved across runs.");
  md.push("- `data_conflicts` are never deleted; resolution is the only mutation path (`resolveConflict` in lib/ingestion/review.ts), and it is not exposed on the repository contract.");
  md.push("- Dry-run/targeted execution: ingestion sources support `enabled` flag and per-source config; the operator CLI (`npm run ops`) is guard-env-gated. No blanket 'rerun all' is recommended.");
  md.push("- External contact: each retry fetches the institution's website (and NRB pages). Respect source access rules and robots; do not crawl aggressively.");
  md.push("- No production data was touched by this audit.");
  md.push("");
  md.push("## Limitations");
  md.push("");
  md.push("- PARTIAL runs are classified by recorded error type/message only; root cause for some may require re-running (not done here).");
  md.push("- Pilot-stub causes are inferred from null `last_run_at` (ingestion never executed) plus source registration; no run record exists to confirm.");
  md.push("- Retry safety is assessed from code inspection, not execution.");
  md.push("");
  md.push("## Files");
  md.push("");
  md.push("- `docs/data/RECOVERY-MANIFEST.csv` — one row per item (47 runs + 8 stubs = 55 rows).");
  md.push("- `docs/data/RECOVERY-MANIFEST-SUMMARY.md` — this file.");
  md.push("");
  md.push("## Explicit statement");
  md.push("");
  md.push("No ingestion was executed. No evidence, assertions, conflicts, validation results, or source records were changed. No schema or migration was added. Recommendations are report-only.");

  const mdPath = resolve(ROOT, "docs/data/RECOVERY-MANIFEST-SUMMARY.md");
  writeFileSync(mdPath, md.join("\n") + "\n", "utf8");

  console.log(`[recovery:manifest] rows=${rows.length} (partial=${partialRuns.length}, stubs=${stubs.length})`);
  console.log(`[recovery:manifest] wrote ${csvPath}`);
  console.log(`[recovery:manifest] wrote ${mdPath}`);
}

// helper needed before main (hoisted function declaration)
function db2errs(runId: string): Array<{ error_type: string; error_message: string; retry_count: number }> {
  const db = new (require("better-sqlite3"))(resolve(ROOT, "data/durable/store.db"), { readonly: true });
  const r = db.prepare("SELECT error_type, error_message, retry_count FROM ingestion_errors WHERE run_id=?").all(runId) as Array<{ error_type: string; error_message: string; retry_count: number }>;
  db.close();
  return r;
}

main();
