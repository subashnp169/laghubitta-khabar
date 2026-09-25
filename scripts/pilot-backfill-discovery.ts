// ============================================================================
// Phase F — discovery backfill (evidence-anchored). Reads a pilot evidence DB
// (scratch, read-only) and persists, for every pilot source, the real
// capability page that discovery located (known_url). URL choice is ordered by
// anchoring strength, always preferring the page that actually PRODUCED the
// capability's assertions:
//
//   1. evidence-anchored + hint-matching: a URL that produced field evidence
//      for the capability AND whose own URL classifies to the same capability
//   2. evidence-anchored (any URL, e.g. homepage lists branches inline)
//   3. link-anchored: fetched & snapshotted URL matching the capability hint
//   4. null — honest gap, noted (JS-rendered / PDF-only / unreachable)
//
// Deterministic: classification reuses the exact hint rules the live pilot
// discovery used (locateCapabilityForUrl). knownUrl never points at a file
// that was merely the discovery carrier (sitemap indexes/attach buckets) when
// a page-level URL exists; statuses stay CANDIDATE — nothing is VERIFIED.
//
// Run: npx tsx scripts/pilot-backfill-discovery.ts [<db-path>]
//      (db-path defaults to pilot-run-report.json dbPath or LK_PILOT_DB)
//
// Writes (regenerated on every run — idempotent):
//   - data/pilot/pilot-sources.json     (known_url per capability + notes)
//   - data/pilot/discovery-report.json  (per-source located-pages ledger)
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

import { locateCapabilityForUrl } from "../lib/ingestion";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string, opts?: { readonly?: boolean }) => {
  prepare(s: string): {
    get(...a: unknown[]): Record<string, unknown> | undefined;
    all(...a: unknown[]): Record<string, unknown>[];
  };
  close(): void;
};

interface CapabilityRecord {
  capability: string;
  status: string;
  known_url: string | null;
  link_type: string;
  note?: string;
}
interface PilotSource {
  id: string;
  institution_id: string;
  url: string;
  domain: string;
  capabilities: CapabilityRecord[];
}

interface UrlRow {
  url: string;
  http_status: number | null;
  mime_type: string | null;
}

const PAGE_MIME_RE = /text\/html|application\/xhtml\+html|application\/xhtml\+xml/i;

const FIELD_OF: Record<string, string> = {
  BRANCH_DIRECTORY: "branch_name",
  CAREER_PAGE: "vacancy_title",
  REPORTS: "document_title",
  DOCUMENT_ARCHIVE: "document_title",
  WEBSITE: "website",
};

function resolveDbPath(): string {
  const fallback = JSON.parse(
    readFileSync(join(process.cwd(), "data", "pilot", "pilot-run-report.json"), "utf8"),
  ) as { dbPath?: string };
  const p = process.argv[2] ?? process.env.LK_PILOT_DB ?? fallback?.dbPath;
  if (!p || !existsSync(p)) {
    console.error("no pilot DB: pass path or LK_PILOT_DB / pilot-run-report.json dbPath");
    process.exit(1);
  }
  return p;
}

/** Rank rows so a best URL is pickable: 2xx + page-like (html) outrank others;
 *  rows with unknown status are kept (fetched items, snapshot hash drifted). */
function rankRows(rows: UrlRow[]): UrlRow[] {
  return rows
    .filter((r) => r.http_status === null || (r.http_status >= 200 && r.http_status < 400))
    .slice()
    .sort((a, b) => {
      const am = a.mime_type && PAGE_MIME_RE.test(a.mime_type) ? 1 : 0;
      const bm = b.mime_type && PAGE_MIME_RE.test(b.mime_type) ? 1 : 0;
      if (bm !== am) return bm - am;
      const rc = (a.http_status ?? 0) >= 200 && (a.http_status ?? 0) < 300 ? 1 : 0;
      const rb = (b.http_status ?? 0) >= 200 && (b.http_status ?? 0) < 300 ? 1 : 0;
      if (rb !== rc) return rb - rc;
      return a.url === b.url ? 0 : a.url < b.url ? -1 : 1;
    });
}

function main(): void {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true });
  const dbAny = db as unknown as {
    prepare(s: string): {
      get(...a: unknown[]): Record<string, unknown> | undefined;
      all(...a: unknown[]): Record<string, unknown>[];
    };
  };

  const pilot = JSON.parse(readFileSync(join(process.cwd(), "data", "pilot", "pilot-sources.json"), "utf8")) as {
    provenance_note: string;
    sources: PilotSource[];
  };

  const ANCHOR_NOTE = "Phase F backfill:";
  const cut = pilot.provenance_note.indexOf(`\n${ANCHOR_NOTE}`);
  if (cut >= 0) pilot.provenance_note = pilot.provenance_note.slice(0, cut);

  const ledger: Array<Record<string, unknown>> = [];
  let located = 0;
  const perCap: Record<string, number> = {};

  const fetchClassified = (sourceId: string): Map<string, UrlRow[]> => {
    const rows = dbAny
      .prepare(
        `SELECT DISTINCT i.url url, ss.http_status http_status, ss.mime_type mime_type
           FROM ingestion_items i
           JOIN ingestion_runs r ON r.id = i.run_id
           LEFT JOIN source_snapshots ss ON ss.content_hash = i.content_hash
          WHERE r.ingestion_source_id = ?`,
      )
      .all(sourceId) as unknown as UrlRow[];
    const map = new Map<string, UrlRow[]>();
    for (const r of rows) {
      const cap = locateCapabilityForUrl(r.url);
      if (!cap) continue;
      const arr = map.get(cap) ?? [];
      arr.push(r);
      map.set(cap, arr);
    }
    return map;
  };

  const evidenceFor = (sourceId: string, field: string): UrlRow[] => {
    if (!field) return [];
    return dbAny
      .prepare(
        `SELECT DISTINCT i.url url, ss.http_status http_status, ss.mime_type mime_type
           FROM data_assertions a
           JOIN source_snapshots ss ON ss.id = a.source_snapshot_id
           JOIN ingestion_items i ON i.content_hash = ss.content_hash
           JOIN ingestion_runs r ON r.id = i.run_id
          WHERE a.field_name = ? AND r.ingestion_source_id = ?`,
      )
      .all(field, sourceId) as unknown as UrlRow[];
  };

  const assertionCount = (sourceId: string, field: string): number => {
    if (!field) return 0;
    const r = dbAny
      .prepare(
        `SELECT COUNT(*) n FROM data_assertions a JOIN source_snapshots ss ON ss.id = a.source_snapshot_id
          WHERE a.field_name = ? AND ss.source_id = ?`,
      )
      .get(field, sourceId) as { n: number } | undefined;
    return r?.n ?? 0;
  };

  const homepageFetched = (sourceId: string, url: string): boolean => {
    const r = dbAny
      .prepare(
        `SELECT COUNT(*) n FROM ingestion_items i JOIN ingestion_runs r ON r.id = i.run_id
          WHERE r.ingestion_source_id = ? AND i.url = ?`,
      )
      .get(sourceId, url) as { n: number } | undefined;
    return (r?.n ?? 0) > 0;
  };

  for (const s of pilot.sources) {
    const classifiedPages = fetchClassified(s.id);
    const locatedForSource: Record<string, { url: string; http_status: number | null; anchor: string }> = {};

    for (const cap of s.capabilities) {
      const capKind = cap.capability as string;
      if (capKind === "WEBSITE") {
        cap.known_url = s.url;
        cap.note = undefined; // persistent root, cleared of per-run noise
        locatedForSource[capKind] = { url: s.url, http_status: null, anchor: "config" };
        continue;
      }

      const field = FIELD_OF[capKind];
      // 1) evidence URLs whose own URL classifies to this capability
      const allEvidence = evidenceFor(s.id, field);
      const evidenceMatching = allEvidence.filter(
        (r) => locateCapabilityForUrl(r.url) === capKind,
      );
      // 2) remaining evidence URLs (the page really produced the data); when
      //    none hash-match (raw-vs-canonical drift, e.g. homepage SPA), anchor
      //    to the fetched homepage — the page the capability data lived on.
      const evidenceAny = allEvidence.filter((r) => !evidenceMatching.some((m) => m.url === r.url));
      const evidenceHome: UrlRow[] =
        evidenceMatching.length === 0 && evidenceAny.length === 0 && assertionCount(s.id, field) > 0 && homepageFetched(s.id, s.url)
          ? [{ url: s.url, http_status: 200, mime_type: "text/html" }]
          : [];
      // 3) fetched page classified as this capability
      const linkPages = classifiedPages.get(capKind) ?? [];

      const best =
        rankRows(evidenceMatching)[0] ??
        rankRows(evidenceAny)[0] ??
        evidenceHome[0] ??
        rankRows(linkPages)[0];
      if (best) {
        const anchor = evidenceHome.some((m) => m.url === best.url)
          ? "evidence-homepage"
          : evidenceMatching.some((m) => m.url === best.url)
            ? "evidence-hint"
            : evidenceAny.some((m) => m.url === best.url)
              ? "evidence"
              : "link";
        cap.known_url = best.url;
        cap.note = `phase F backfill ${new Date().toISOString().slice(0, 10)}: anchor=${anchor} (http ${best.http_status ?? "?"}, ${best.mime_type ?? "?"})`;
        located += 1;
        perCap[capKind] = (perCap[capKind] ?? 0) + 1;
        locatedForSource[capKind] = { url: best.url, http_status: best.http_status, anchor };
      } else {
        cap.known_url = null;
        cap.note = `phase F backfill ${new Date().toISOString().slice(0, 10)}: no ${capKind} page located (${linkPages.length} hint pages fetched, ${evidenceAny.length} evidence-producing URLs)`;
        locatedForSource[capKind] = { url: "", http_status: null, anchor: "none" };
      }
    }

    ledger.push({
      institution: s.institution_id,
      source: s.id,
      root: s.url,
      located: locatedForSource,
      lastRunSnapshots:
        (dbAny
          .prepare(
            `SELECT COUNT(*) n FROM source_snapshots
              WHERE source_id=? AND fetched_at >=
                (SELECT started_at FROM ingestion_runs WHERE ingestion_source_id=? ORDER BY started_at DESC LIMIT 1)`,
          )
          .get(s.id, s.id) as { n: number } | undefined)?.n ?? 0,
    });
  }

  const note = `\n${ANCHOR_NOTE} Discovery results from the pilot evidence DB persisted back into each capability's known_url where a real same-domain page was located & snapshotted (deterministic classification via the shared hint matcher, evidence-anchored: prefers the page that produced the capability's field assertions over a bare hint match; regenerated ${new Date().toISOString().slice(0, 10)}). All statuses stay CANDIDATE; nothing is VERIFIED.`;
  pilot.provenance_note += note;
  writeFileSync(join(process.cwd(), "data", "pilot", "pilot-sources.json"), JSON.stringify(pilot, null, 2) + "\n");

  const summaryLocated = ledger.reduce(
    (acc, l) =>
      acc + Object.values((l.located as Record<string, { url: string }>)).filter((v) => v.url !== "").length,
    0,
  );
  const report = {
    generatedAt: new Date().toISOString(),
    dbPath,
    sources: pilot.sources.length,
    locatedUrls: located,
    locatedSlotsPerSource: summaryLocated,
    perCapability: perCap,
    perSource: ledger,
  };
  writeFileSync(join(process.cwd(), "data", "pilot", "discovery-report.json"), JSON.stringify(report, null, 2) + "\n");

  console.log(`located ${located} capability URLs across ${pilot.sources.length} sources:`);
  for (const [cap, n] of Object.entries(perCap)) console.log(`  ${cap}: ${n}`);
  for (const row of ledger) {
    const hits = Object.entries(row.located as Record<string, { url: string; anchor: string }>)
      .filter(([, v]) => v.url !== "")
      .map(([c, v]) => `${c}=${v.url} [${v.anchor}]`)
      .join(" ");
    const misses = (Object.entries(row.located as Record<string, { anchor: string }>).filter(([, v]) => v.anchor === "none") as Array<[string, { anchor: string }]>)
      .map(([c]) => c)
      .join(",");
    console.log(`  ${row.source}: ${hits || `none (miss: ${misses})`}`);
  }
  db.close();
}

main();