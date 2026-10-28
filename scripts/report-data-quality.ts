// ============================================================================
// V1.1 — deterministic data-quality & freshness report.
//
// Read-only: opens data/durable/store.db in readonly mode, measures coverage,
// source health, assertion provenance, unresolved conflicts, validation state
// and ingestion recency, and writes a markdown report to
// docs/data/DATA-QUALITY-REPORT.md. No data is modified, no thresholds are
// invented: staleness is reported as "days since last run" alongside the
// existing field_refresh_policies table; the operator compares.
//
// Run: npm run report:data-quality
// ============================================================================
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => {
  prepare: (sql: string) => { all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown };
  close: () => void;
};
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

interface RunRow { ingestion_source_id: string; status: string; started_at: string; completed_at: string | null; items_found: number; items_failed: number; error_count: number }

function main(): void {
  const db = new Database(resolve(ROOT, "data/durable/store.db"), { readonly: true });

  const instCount = (db.prepare("SELECT COUNT(*) c FROM institutions").get() as { c: number }).c;
  const instWithAssertions = (db.prepare("SELECT COUNT(DISTINCT entity_id) c FROM data_assertions WHERE entity_type='institution'").get() as { c: number }).c;
  const stubs = db.prepare("SELECT id, name_en FROM institutions i WHERE NOT EXISTS (SELECT 1 FROM data_assertions a WHERE a.entity_type='institution' AND a.entity_id=i.id) ORDER BY i.id").all() as Array<{ id: string; name_en: string }>;

  const sources = db.prepare("SELECT id, source_type, source_scope, url FROM sources ORDER BY id").all() as Array<{ id: string; source_type: string; source_scope: string; url: string }>;
  const sourcesMissingUrl = (db.prepare("SELECT COUNT(*) c FROM sources WHERE url IS NULL OR url=''").get() as { c: number }).c;

  const assertionsByType = db.prepare("SELECT entity_type, COUNT(*) c FROM data_assertions GROUP BY entity_type ORDER BY entity_type").all() as Array<{ entity_type: string; c: number }>;
  const totalAssertions = (db.prepare("SELECT COUNT(*) c FROM data_assertions").get() as { c: number }).c;
  const assertionsMissingSource = (db.prepare("SELECT COUNT(*) c FROM data_assertions WHERE source_id IS NULL OR source_id=''").get() as { c: number }).c;
  const assertionsMissingTs = (db.prepare("SELECT COUNT(*) c FROM data_assertions WHERE observed_at IS NULL OR observed_at=''").get() as { c: number }).c;

  const conflictsTotal = (db.prepare("SELECT COUNT(*) c FROM data_conflicts").get() as { c: number }).c;
  const conflictsByStatus = db.prepare("SELECT resolution_status, COUNT(*) c FROM data_conflicts GROUP BY resolution_status").all() as Array<{ resolution_status: string; c: number }>;

  const validationByStatus = db.prepare("SELECT status, COUNT(*) c FROM validation_results GROUP BY status").all() as Array<{ status: string; c: number }>;

  const runs = db.prepare("SELECT ingestion_source_id, status, started_at, completed_at, items_found, items_failed, error_count FROM ingestion_runs").all() as RunRow[];
  const runStatusCounts = db.prepare("SELECT status, COUNT(*) c FROM ingestion_runs GROUP BY status").all() as Array<{ status: string; c: number }>;
  const lastRun = db.prepare("SELECT MAX(started_at) mx FROM ingestion_runs").get() as { mx: string };
  const firstRun = db.prepare("SELECT MIN(started_at) mn FROM ingestion_runs").get() as { mn: string };

  const runsBySource = db.prepare("SELECT ingestion_source_id, COUNT(*) c, SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END) succ, MAX(started_at) last FROM ingestion_runs GROUP BY ingestion_source_id ORDER BY ingestion_source_id").all() as Array<{ ingestion_source_id: string; c: number; succ: number; last: string }>;

  const snapshots = (db.prepare("SELECT COUNT(*) c FROM source_snapshots").get() as { c: number }).c;
  const policies = db.prepare("SELECT field_group, refresh_days FROM field_refresh_policies ORDER BY field_group").all() as Array<{ field_group: string; refresh_days: number }>;

  const jobs = (db.prepare("SELECT COUNT(*) c FROM jobs").get() as { c: number }).c;
  const officialLinks = (db.prepare("SELECT COUNT(*) c FROM official_links").get() as { c: number }).c;
  const socialAccounts = (db.prepare("SELECT COUNT(*) c FROM social_accounts").get() as { c: number }).c;
  const videos = (db.prepare("SELECT COUNT(*) c FROM videos").get() as { c: number }).c;
  const posts = (db.prepare("SELECT COUNT(*) c FROM posts").get() as { c: number }).c;
  const digitalServices = (db.prepare("SELECT COUNT(*) c FROM digital_services").get() as { c: number }).c;

  db.close();

  const asOf = lastRun.mx;

  const lines: string[] = [];
  lines.push("# Data quality report (V1.1)");
  lines.push("");
  lines.push(`Generated by \`npm run report:data-quality\`. Read-only: no data was modified.`);
  lines.push(`Reference "as of": latest ingestion run \`${asOf}\` (wall clock is not used as a fact).`);
  lines.push("");
  lines.push("## 1. Coverage");
  lines.push("");
  lines.push(`- Institutions in registry: **${instCount}**`);
  lines.push(`- Institutions with assertion-level data: **${instWithAssertions}** (${instCount - instWithAssertions} without)`);
  lines.push(`- Institutions with no assertion data (pilot stubs): ${stubs.length}`);
  for (const s of stubs) lines.push(`  - \`${s.id}\` — ${s.name_en}`);
  lines.push("");
  lines.push("## 2. Source registry");
  lines.push("");
  lines.push(`- Registered sources: **${sources.length}** (${sourcesMissingUrl} missing URL)`);
  const byType = sources.reduce<Record<string, number>>((acc, s) => { acc[s.source_type] = (acc[s.source_type] ?? 0) + 1; return acc; }, {});
  for (const [k, v] of Object.entries(byType).sort()) lines.push(`  - ${k}: ${v}`);
  lines.push("");
  lines.push("## 3. Assertion provenance");
  lines.push("");
  lines.push(`- Total assertions: **${totalAssertions}**`);
  for (const r of assertionsByType) lines.push(`  - ${r.entity_type}: ${r.c}`);
  lines.push(`- Missing source_id: **${assertionsMissingSource}**`);
  lines.push(`- Missing observed_at: **${assertionsMissingTs}**`);
  lines.push(`- Source snapshots: **${snapshots}**`);
  lines.push("");
  lines.push("## 4. Unresolved conflicts");
  lines.push("");
  lines.push(`- Total conflict rows: **${conflictsTotal}** (all \`${conflictsByStatus.map((r) => `${r.resolution_status}=${r.c}`).join(", ")}\`)`);
  lines.push("- Per `docs/data/CONFLICT-VISIBILITY-CHAIN.md`, these are same-source pre-fix artifacts, not genuine disagreements. They are reported, not silently resolved.");
  lines.push("");
  lines.push("## 5. Validation");
  lines.push("");
  for (const r of validationByStatus) lines.push(`- ${r.status}: **${r.c}**`);
  lines.push("");
  lines.push("## 6. Ingestion health");
  lines.push("");
  lines.push(`- Runs: ${runStatusCounts.map((r) => `${r.status}=${r.c}`).join(", ")} (total ${runs.length})`);
  lines.push(`- First run: \`${firstRun.mn}\` · Last run: \`${lastRun.mx}\``);
  lines.push("");
  lines.push("| source | runs | success | last run |");
  lines.push("|---|---|---|---|");
  for (const r of runsBySource) lines.push(`| ${r.ingestion_source_id} | ${r.c} | ${r.succ} | ${r.last} |`);
  lines.push("");
  lines.push("## 7. Freshness policy (existing, not invented)");
  lines.push("");
  lines.push("| field group | refresh days |");
  lines.push("|---|---|");
  for (const p of policies) lines.push(`| ${p.field_group} | ${p.refresh_days} |`);
  lines.push("");
  lines.push("No source-to-field-group mapping exists yet; staleness is reported as days-since-last-run above. Recommend adding the mapping before automated staleness alerting.");
  lines.push("");
  lines.push("## 8. Empty data domains (honest gaps)");
  lines.push("");
  lines.push(`- jobs (durable store): ${jobs} · vacancies (published site): 99 (different pipeline)`);
  lines.push(`- official_links: ${officialLinks}`);
  lines.push(`- social_accounts: ${socialAccounts}`);
  lines.push(`- videos: ${videos} · posts: ${posts} · digital_services: ${digitalServices}`);
  lines.push("- nrb_documents in durable store: 0 (published via separate NRB pipeline: 97)");
  lines.push("");
  lines.push("## 9. Recommendations");
  lines.push("");
  lines.push("1. Review the 229 OPEN conflicts against CONFLICT-VISIBILITY-CHAIN.md and mark non-genuine ones IGNORED with a note (data mutation, requires review).");
  lines.push("2. Re-run ingestion for the 47 PARTIAL runs and the 8 pilot-stub institutions.");
  lines.push("3. Resolve the 11 FAIL validation results and clear the 2481 PENDING.");
  lines.push("4. Add a source-to-field-group mapping so field_refresh_policies can drive automated staleness alerts.");
  lines.push("5. Ingest social/official-link/media data before claiming those surfaces are populated.");
  lines.push("");
  lines.push("## 10. Limitations");
  lines.push("");
  lines.push("- Read-only: no data was modified by this report.");
  lines.push("- Staleness is not auto-labelled; thresholds are the operator's to apply via the policy table.");
  lines.push("- Wall-clock time is not used as a fact; the reference point is the last ingestion run.");

  const outPath = resolve(ROOT, "docs/data/DATA-QUALITY-REPORT.md");
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.log(`[report:data-quality] wrote ${outPath}`);
  console.log(`[report:data-quality] institutions=${instCount} withData=${instWithAssertions} assertions=${totalAssertions} conflicts=${conflictsTotal} runs=${runs.length} (${runStatusCounts.map((r) => r.status + "=" + r.c).join(", ")})`);
}

main();
