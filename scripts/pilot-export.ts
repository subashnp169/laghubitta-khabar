// ============================================================================
// Front-end snapshot generator — reads a pilot run DB (read-only) and emits a
// deterministic `src/data/pilot.ts` module consumed by the Next.js pages so the
// static site never touches the network or the scratch DB at render time.
//
//   npm run pilot:export -- <absolute-or-relative-db-path>
//   env LK_PILOT_DB=path npm run pilot:export
//
// Falls back to data/pilot/pilot-run-report.json for the run mode and the
// per-source discovery URL counts. READ-ONLY by design: no DDL, no writes
// to the source DB.
// ============================================================================

import { createRequire } from "node:module";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
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

interface ReportJson {
  mode?: string;
  perSource?: Array<Record<string, unknown>>;
}

interface PilotSourcesJson {
  sources?: Array<{
    id: string;
    capabilities?: Array<{ capability: string; known_url: string | null; note?: string }>;
  }>;
}

const samplesFor = (db: DB, sourceId: string, fieldName: string, limit: number): string[] => {
  const rows = qa(
    db,
    `SELECT a.value value, COUNT(*) c
       FROM data_assertions a JOIN source_snapshots ss ON ss.id = a.source_snapshot_id
      WHERE ss.source_id = ? AND a.field_name = ?
      GROUP BY a.value ORDER BY c DESC, a.value ASC LIMIT ?`,
    sourceId, fieldName, limit,
  );
  return rows.map((r) => String(r.value));
};

const countFor = (db: DB, sourceId: string, fieldName: string): number => {
  const r = q(
    db,
    `SELECT COUNT(*) n
       FROM data_assertions a JOIN source_snapshots ss ON ss.id = a.source_snapshot_id
      WHERE ss.source_id = ? AND a.field_name = ?`,
    sourceId, fieldName,
  );
  return z(r?.n);
};

function main(): void {
  const fallbackRaw = existsSync(join(process.cwd(), "data", "pilot", "pilot-run-report.json"))
    ? (JSON.parse(readFileSync(join(process.cwd(), "data", "pilot", "pilot-run-report.json"), "utf8")) as ReportJson)
    : undefined;
  const fallbackPath = ((fallbackRaw as Record<string, unknown> | undefined)?.dbPath as string | undefined) ?? undefined;
  const dbPath = process.argv[2] ?? process.env.LK_PILOT_DB ?? (fallbackPath && !fallbackPath.startsWith("<") ? fallbackPath : undefined);
  if (!dbPath) {
    console.error("USAGE: npm run pilot:export -- <db-path>   (or set LK_PILOT_DB)");
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true });
  const mode = String(fallbackRaw?.mode ?? "single run");
  const discBySource = new Map<string, number>();
  for (const s of fallbackRaw?.perSource ?? []) {
    if (typeof s.source === "string") discBySource.set(s.source, z(s.discoveryUrls));
  }

  // Phase F discovery backfill (pilot-backfill-discovery.ts) persists located
  // capability pages into pilot-sources.json; merge so the snapshot is sourced
  // from the same evidence DB, keeping the page UI deterministic.
  const locatedPagesBySource = new Map<string, Array<{ capability: string; knownUrl: string | null; note: string | null }>>();
  if (existsSync(join(process.cwd(), "data", "pilot", "pilot-sources.json"))) {
    const pilotJson = JSON.parse(
      readFileSync(join(process.cwd(), "data", "pilot", "pilot-sources.json"), "utf8"),
    ) as PilotSourcesJson;
    for (const srcPage of pilotJson.sources ?? []) {
      const pages: Array<{ capability: string; knownUrl: string | null; note: string | null }> = [];
      for (const cap of srcPage.capabilities ?? []) {
        pages.push({
          capability: cap.capability,
          knownUrl: cap.known_url ?? null,
          note: cap.note ?? null,
        });
      }
      locatedPagesBySource.set(srcPage.id, pages);
    }
  }

  const sources = qa(db, "SELECT * FROM ingestion_sources ORDER BY id");
  const institutionIdOf = new Map<string, string>();
  for (const s of sources) {
    institutionIdOf.set(String(s.id), s.institution_id ? String(s.institution_id) : "");
  }
  const instNameOf = new Map<string, string>();
  for (const i of qa(db, "SELECT id, name_en FROM institutions") as Array<{ id: string; name_en: string }>) {
    instNameOf.set(i.id, i.name_en);
  }

  const picked = sources.map((s) => {
    const src = s as { id: string; url: string; config_json: string };
    const sid = src.id;
    const c = q(
      db,
      `SELECT COUNT(*) runs,
              SUM(error_count) errs,
              (SELECT status FROM ingestion_runs r2 WHERE r2.ingestion_source_id=? ORDER BY r2.started_at DESC LIMIT 1) last_status,
              (SELECT started_at FROM ingestion_runs r2 WHERE r2.ingestion_source_id=? ORDER BY r2.started_at DESC LIMIT 1) last_run,
              (SELECT COUNT(*) FROM ingestion_runs r2 WHERE r2.ingestion_source_id=? AND r2.status IN ('SUCCESS','PARTIAL')) ok_runs,
              (SELECT COUNT(*) FROM ingestion_runs r2 WHERE r2.ingestion_source_id=? AND r2.status='FAILED') fail_runs,
              (SELECT COUNT(*) FROM ingestion_runs r2 WHERE r2.ingestion_source_id=? AND r2.status='FAILED' AND r2.started_at >
                 COALESCE((SELECT MAX(started_at) FROM ingestion_runs WHERE ingestion_source_id=? AND status IN ('SUCCESS','PARTIAL')), '')) consec_fails
         FROM ingestion_runs WHERE ingestion_source_id=?`,
      sid, sid, sid, sid, sid, sid, sid,
    ) as Row;
    const snapsFor = q(db, "SELECT COUNT(*) n FROM source_snapshots WHERE source_id=?", sid) as Row;
    const itemsFor = q(db, "SELECT COUNT(*) n FROM ingestion_items i JOIN ingestion_runs rr ON rr.id=i.run_id WHERE rr.ingestion_source_id=?", sid) as Row;
    const changedFor = q(db, "SELECT COUNT(*) n FROM ingestion_items i JOIN ingestion_runs rr ON rr.id=i.run_id WHERE rr.ingestion_source_id=? AND i.status='CHANGED'", sid) as Row;
    const docsFor = q(db, "SELECT COUNT(*) n FROM outbound_links WHERE source_id=? AND target_type='DOCUMENT'", sid) as Row;
    const config = JSON.parse(src.config_json || "{}") as { capabilities?: Array<Record<string, unknown>> };
    const caps = (config.capabilities ?? [])
      .map((x) => (typeof x.capability === "string" ? x.capability : typeof x.intent === "string" ? String(x.intent) : undefined))
      .filter((x): x is string => typeof x === "string");
    const capabilityPages = locatedPagesBySource.get(sid) ?? [];

    return {
      sourceId: sid,
      institutionId: institutionIdOf.get(sid) ?? "",
      website: src.url,
      capabilities: caps,
      capabilityPages,
      runs: z(c.runs),
      snapshots: z(snapsFor.n),
      items: z(itemsFor.n),
      documents: z(docsFor.n),
      errors: z(c.errs),
      changedItems: z(changedFor.n),
      discoveredUrls: discBySource.get(sid) ?? 0,
      status: z(c.runs) === 0 ? "NEVER-RUN" : (c.last_status as string) === "FAILED" && z(c.consec_fails) >= 2 ? "UNHEALTHY" : (c.last_status as string) === "FAILED" || ((c.last_status as string) === "PARTIAL" && z(snapsFor.n) === 0) ? "DEGRADED" : "HEALTHY",
      lastStatus: c.last_status ? String(c.last_status) : null,
      lastRun: c.last_run ? String(c.last_run) : null,
      branchCount: countFor(db, sid, "branch_name"),
      vacancyCount: countFor(db, sid, "vacancy_title"),
      documentCount: countFor(db, sid, "document_title"),
      branchNames: samplesFor(db, sid, "branch_name", 5),
      vacancyTitles: samplesFor(db, sid, "vacancy_title", 5),
      documentTitles: samplesFor(db, sid, "document_title", 5),
    };
  });

  const institutions = q(db, "SELECT COUNT(*) n FROM institutions") as Row;
  const snapped = q(db, "SELECT COUNT(DISTINCT i.institution_id) n FROM ingestion_sources i JOIN source_snapshots ss ON ss.source_id=i.id WHERE i.institution_id IS NOT NULL") as Row;
  const runs = q(db, "SELECT COUNT(*) n FROM ingestion_runs") as Row;
  const items = q(db, "SELECT COUNT(*) n FROM ingestion_items") as Row;
  const snaps = q(db, "SELECT COUNT(*) n FROM source_snapshots") as Row;
  const docs = q(db, "SELECT COUNT(*) n FROM outbound_links WHERE target_type='DOCUMENT'") as Row;
  const errors = q(db, "SELECT COUNT(*) n FROM ingestion_errors") as Row;
  const fetch = q(db, "SELECT COUNT(*) n FROM ingestion_errors WHERE error_type IN ('HTTP_ERROR','FETCH_FAILURE')") as Row;
  const conflicts = q(db, "SELECT COUNT(*) n, SUM(resolution_status='OPEN') o FROM data_conflicts") as Row;
  const validation = q(db, "SELECT SUM(status='PASS') p, SUM(status='FAIL') f, SUM(status='PENDING') d FROM validation_results") as Row;
  const dup = q(db, "SELECT COUNT(*) n FROM (SELECT source_id, content_hash FROM source_snapshots GROUP BY source_id, content_hash HAVING COUNT(*) > 1)") as Row;
  const pdf = q(db, "SELECT COUNT(*) n FROM source_snapshots WHERE mime_type LIKE '%pdf%'") as Row;

  const healthCounts: Record<string, number> = {};
  let capabilitiesLocated = 0;
  let sourcesWithLocatedPages = 0;
  for (const p of picked) {
    healthCounts[p.status] = z(healthCounts[p.status]) + 1;
    const located = (p.capabilityPages ?? []).filter((l) => l.knownUrl && l.knownUrl !== "");
    capabilitiesLocated += located.length;
    if (located.length > 0) sourcesWithLocatedPages += 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    institutions: z(institutions.n),
    sources: picked.length,
    withEvidence: z(snapped.n),
    capabilitiesLocated,
    sourcesWithLocatedPages,
    runs: z(runs.n),
    items: z(items.n),
    snapshots: z(snaps.n),
    documents: z(docs.n),
    errors: z(errors.n),
    fetchFailures: z(fetch.n),
    passCount: z(validation.p),
    failCount: z(validation.f),
    pendingCount: z(validation.d),
    conflictsOpen: z(conflicts.o),
    duplicateSnapshotGroups: z(dup.n),
    pdfSnapshots: z(pdf.n),
    healthy: z(healthCounts.HEALTHY),
    degraded: z(healthCounts.DEGRADED),
  };

  const body = `// Deterministic snapshot generated by scripts/pilot-export.ts (read-only)
// from ingestion evidence. Manifest of run ${summary.mode}; ${summary.sources} sources.
import type { CrawlSource, CrawlSummary } from "@/types";

export const crawlSummary: CrawlSummary = ${JSON.stringify(summary, null, 2)};

export const crawlSources: CrawlSource[] = ${JSON.stringify(picked, null, 2)};
`;

  const target = join(process.cwd(), "src", "data", "pilot.ts");
  writeFileSync(target, body);
  console.log(`WROTE ${target}\nsummary: ${summary.sources} sources, ${summary.runs} runs, ${summary.snapshots} snapshots, ${summary.sources - summary.healthy} non-healthy [raw=${dbPath}]`);
  db.close();
}

main();