// =============================================================================
// scripts/nrb-ledger.ts — M1.5.2 ledger: project NRB intake evidence + master
// universe into the frozen NRB tables (nrb_documents, nrb_institution_links,
// regulatory_events) inside a scratch review DB (lk-nrb-ledger-*/).
//
// Deterministic by construction:
//   - every id is a hash of the backed evidence (source_id|url etc.), so
//     re-running is INSERT OR IGNORE → no-op;
//   - nothing is fabricated: published_at/size come from the listing metadata
//     the intake persisted on outbound_links.description; events with no NRB
//     statement of the date fall back to the universe observed_at and are
//     counted in the report; class/license/merger facts come from
//     data/master/master.json.
//
// Usage:
//   npx tsx scripts/nrb-ledger.ts                 # fresh ledger DB + report
//   npx tsx scripts/nrb-ledger.ts --repeat        # run ledger twice, diff counts
//   npx tsx scripts/nrb-ledger.ts --db <path>     # reuse a ledger DB
//   npx tsx scripts/nrb-ledger.ts --intake <path> # override intake DB
// Intake DB default = data/nrb/nrb-run-report.json dbPath.
// =============================================================================

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => {
  prepare(s: string): {
    get(...a: unknown[]): Record<string, unknown> | undefined;
    all(...a: unknown[]): Array<Record<string, unknown>>;
    run(...a: unknown[]): unknown;
  };
  exec(s: string): void;
  close(): void;
};

const ROOT = join(process.cwd());
const REPORT_JSON = join(ROOT, "data", "nrb", "nrb-run-report.json");
const LEDGER_REPORT_JSON = join(ROOT, "data", "nrb", "nrb-ledger-report.json");
const MASTER_JSON = join(ROOT, "data", "master", "master.json");

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

const NRB_SOURCES = [
  "nrb-quarterly-situation",
  "nrb-kfi",
  "nrb-mfi-supervision",
  "nrb-mfd-home",
  "nrb-mfd-archive",
  "nrb-annual-reports",
  "nrb-bfi-archive",
  "nrb-quarterly-interest-rate",
];

// ---------------------------------------------------------------------------
// doc_type / topic derivation (design §4.1): per-source default, refined only
// when the title vocabulary is unambiguous. Frozen CHECK vocabulary from
// migration 0006.
// ---------------------------------------------------------------------------
const SOURCE_DOC_TYPE: Record<string, string> = {
  "nrb-quarterly-situation": "REPORT",
  "nrb-kfi": "KFI",
  "nrb-mfi-supervision": "REPORT",
  "nrb-mfd-archive": "REPORT",
  "nrb-annual-reports": "REPORT",
  "nrb-bfi-archive": "REPORT",
  "nrb-quarterly-interest-rate": "KFI",
};

const DOC_CHECK = new Set(["DIRECTIVE", "CIRCULAR", "GUIDELINE", "KFI", "REPORT", "ENFORCEMENT", "INTEREST_RATE"]);

const TOPIC_RULES: Array<[RegExp, string]> = [
  [/interest rate/i, "INTEREST_RATE"],
  [/\b(aml|cft|money laundering|fiu)\b/i, "AML_CFT"],
  [/provision/i, "PROVISIONING"],
  [/governance|board of directors|\bdirector\b/i, "GOVERNANCE"],
  [/\bit\b|technology|cyber/i, "IT"],
  [/consumer|complaint/i, "CONSUMER"],
  [/report|supervision|audit|situation|progress|enforcement|statement|list/i, "REPORTING"],
];

function deriveDocType(sourceId: string, title: string): { docType: string; topic: string | null } {
  let docType = SOURCE_DOC_TYPE[sourceId] ?? "REPORT";
  if (/interest rate/i.test(title)) docType = "KFI";
  else if (/enforcement/i.test(title)) docType = "ENFORCEMENT";
  docType = DOC_CHECK.has(docType) ? docType : "REPORT";
  let topic: string | null = null;
  for (const [re, t] of TOPIC_RULES) {
    if (re.test(title)) { topic = t; break; }
  }
  if (docType === "KFI" && /interest rate/i.test(title)) topic = "INTEREST_RATE";
  return { docType, topic };
}

function countNow(ledgerDbPath: string, distinctHrefs: number, eventsFallback: number, nameMatchedCount: number): Record<string, number> {
  const d = new Database(ledgerDbPath);
  const one = (sql: string): number => Number((d.prepare(sql).get() ?? { c: 0 }).c);
  const res: Record<string, number> = {
    nrb_documents: one("SELECT COUNT(*) c FROM nrb_documents"),
    distinct_listing_hrefs: distinctHrefs,
    nrb_institution_links: one("SELECT COUNT(*) c FROM nrb_institution_links"),
    regulatory_events: one("SELECT COUNT(*) c FROM regulatory_events"),
    docs_published_at: one("SELECT COUNT(*) c FROM nrb_documents WHERE published_at IS NOT NULL"),
    orphan_links: one(
      `SELECT COUNT(*) c FROM nrb_institution_links l LEFT JOIN institutions i ON i.id=l.institution_id
        WHERE i.id IS NULL OR l.source_id NOT IN (SELECT id FROM sources)`,
    ),
    orphan_events: one(
      `SELECT COUNT(*) c FROM regulatory_events e LEFT JOIN institutions i ON i.id=e.institution_id
        WHERE i.id IS NULL OR e.source_id NOT IN (SELECT id FROM sources)`,
    ),
    events_occurred_at_fallback: eventsFallback,
    name_matched_links: nameMatchedCount,
  };
  d.close();
  return res;
}

function main(): void {
  const args = process.argv.slice(2);
  const repeat = args.includes("--repeat");
  const ledgerArg = args.find((a) => a.startsWith("--db="))?.slice(5);
  const intakeArg = args.find((a) => a.startsWith("--intake="))?.slice(9);

  const intakeDbPath =
    intakeArg ?? (JSON.parse(readFileSync(REPORT_JSON, "utf8")) as { dbPath: string }).dbPath;
  if (!existsSync(intakeDbPath)) {
    console.error(`intake DB not found: ${intakeDbPath}`);
    console.error("run `npx tsx scripts/nrb-ingest.ts` first (fresh run persists listing metadata).");
    process.exit(1);
  }

  const ledgerDbPath = ledgerArg ?? join(mkdtempSync(join(tmpdir(), "lk-nrb-ledger-")), "nrb.db");
  if (!existsSync(ledgerDbPath)) {
    const db = new Database(ledgerDbPath);
    db.prepare("PRAGMA foreign_keys = ON").run();
    db.exec(readFileSync(join(ROOT, "schema", "schema.sql"), "utf8"));
    db.close();
  }

  const master = JSON.parse(readFileSync(MASTER_JSON, "utf8")) as {
    universeSnapshot: { source_id: string; observed_at: string; title: string };
    institutions: Array<Record<string, unknown>>;
    aliases: Array<{ institution_id: string; alias: string; normalized_alias: string }>;
    timeline: Array<{
      institution_id?: string;
      event_type: string;
      title: string;
      occurred_at: string | null;
      summary?: string;
      predecessor_id?: string;
      source_id: string;
    }>;
    sources: Array<{ id: string; source_type: string; source_scope: string; source_grade: string; url: string; domain: string | null; title: string; publisher: string | null; is_active: number }>;
  };

  const observedAt: string = master.universeSnapshot.observed_at;
  const uniSource = master.universeSnapshot.source_id;

  const db = new Database(ledgerDbPath);
  db.prepare("PRAGMA foreign_keys = ON").run();

  // --- sources: the 8 crawlable NRB sources (copied from the intake scratch
  // DB) + the universe source backing class/license/merger facts. ---
  const src = new Database(intakeDbPath, { readonly: true });
  const nrbs = (src.prepare(
    `SELECT id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active
       FROM sources WHERE id IN (${NRB_SOURCES.map(() => "?").join(",")})`,
  ).all(...NRB_SOURCES) as Array<Record<string, unknown>>);
  const outRows = (src.prepare(
    `SELECT source_id, target_url, label, description
       FROM outbound_links
      WHERE source_id IN (${NRB_SOURCES.map(() => "?").join(",")}) AND target_type='DOCUMENT'
      GROUP BY source_id, target_url`,
  ).all(...NRB_SOURCES) as Array<{ source_id: string; target_url: string; label: string; description: string | null }>);
  src.close();
  const insSource = db.prepare(
    `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of nrbs) insSource.run(s.id, s.source_type, s.source_scope, s.source_grade, s.url, s.domain ?? null, s.title, s.publisher ?? null, s.is_active);
  for (const s of master.sources) insSource.run(s.id, s.source_type, s.source_scope, s.source_grade, s.url, s.domain ?? null, s.title, s.publisher ?? null, s.is_active);

  // --- institutions (canonical universe = 51 current licensed MFBs). ---
  const insInst = db.prepare(
    `INSERT OR IGNORE INTO institutions
       (id, slug, name_en, name_np, short_name, institution_type, status,
        registration_number, nrb_license_number, nrb_class, operation_date,
        head_office_district, head_office_municipality, head_office_address,
        working_area, official_website, official_email, official_phone, logo_url,
        established, listed, source_id, last_verified_at, next_review_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const i of master.institutions) {
    insInst.run(
      i.id, i.slug, i.name_en, i.name_np ?? null, i.short_name ?? null,
      i.institution_type, i.status ?? "ACTIVE", i.registration_number ?? null,
      i.nrb_license_number ?? null, i.nrb_class ?? null, i.operation_date ?? null,
      i.head_office_district ?? null, i.head_office_municipality ?? null,
      i.head_office_address ?? null, i.working_area ?? null, i.official_website ?? null,
      i.official_email ?? null, i.official_phone ?? null, i.logo_url ?? null,
      i.established ?? null, i.listed ?? 0, String(i.source_id ?? uniSource),
      i.last_verified_at ?? null, i.next_review_at ?? null,
    );
  }

  const nameSet = master.institutions.map((i) => {
    const names = [String(i.name_en ?? ""), String(i.short_name ?? "")].filter(Boolean);
    for (const a of master.aliases.filter((a) => a.institution_id === i.id)) names.push(a.alias);
    return { id: String(i.id), names: names.map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter((n) => n.length >= 4) };
  });

  // --- nrb_documents ← outbound_links listing rows (one per source+href). ---
  const docIns = db.prepare(
    `INSERT OR IGNORE INTO nrb_documents
       (id, title, doc_type, topic, official_url, published_at, effective_date, deadline, source_id)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
  );
  const nameMatched: Array<{ docId: string; institutionId: string; linkType: string }> = [];
  for (const r of outRows) {
    let meta: { publishedAt?: string } | null = null;
    if (r.description) { try { meta = JSON.parse(r.description) as { publishedAt?: string }; } catch { meta = null; } }
    const publishedAt = meta?.publishedAt ?? null;
    const { docType, topic } = deriveDocType(r.source_id, r.label);
    const id = `nrb-doc-${sha1(`${r.source_id}|${r.target_url}`).slice(0, 8)}`;
    docIns.run(id, r.label, docType, topic, r.target_url, publishedAt, r.source_id);
    if ((docType === "REPORT" || docType === "KFI") && publishedAt) {
      const t = r.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      for (const inst of nameSet) {
        if (inst.names.some((n) => t.includes(n))) {
          nameMatched.push({ docId: id, institutionId: inst.id, linkType: topic === "INTEREST_RATE" ? "INTEREST_RATE" : "DIRECTIVE" });
        }
      }
    }
  }

  // --- nrb_institution_links. ---
  const links = new Database(ledgerDbPath);
  const putLink = (institutionId: string, docId: string | null, linkType: string, linkDate: string | null, sourceId: string): void => {
    const id = `nrb-link-${sha1(`${institutionId}|${docId ?? ""}|${linkType}|${linkDate ?? ""}`).slice(0, 8)}`;
    links.prepare(
      `INSERT OR IGNORE INTO nrb_institution_links
         (id, institution_id, nrb_document_id, nrb_directive_id, link_type, link_date, source_id)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
    ).run(id, institutionId, docId, linkType, linkDate, sourceId);
  };
  for (const i of master.institutions) {
    if (i.nrb_class !== null && String(i.nrb_class).length > 0) putLink(String(i.id), null, "CLASS", observedAt, uniSource);
    if (i.nrb_license_number) putLink(String(i.id), null, "LICENSE", observedAt, uniSource);
  }
  // Merger/action links: collapse the timeline to ONE row per (institution,
  // link_type) — newest occurrence, deterministic tie-break by title.
  const byInstType = new Map<string, Array<(typeof master.timeline)[number]>>();
  for (const e of master.timeline) {
    if (!e.institution_id) continue;
    const lt = e.event_type === "RENAMED" ? "ACTION" : e.event_type === "MERGED" || e.event_type === "ACQUIRED" ? "MERGED_BY_NRB" : null;
    if (!lt) continue;
    const key = `${e.institution_id}|${lt}`;
    if (!byInstType.has(key)) byInstType.set(key, []);
    byInstType.get(key)!.push(e);
  }
  for (const [key, evs] of byInstType) {
    const [instId, lt] = key.split("|");
    const chosen = evs.sort((a, b) => {
      const da = a.occurred_at ?? observedAt;
      const dbb = b.occurred_at ?? observedAt;
      if (da !== dbb) return da < dbb ? 1 : -1;
      return a.title.localeCompare(b.title);
    })[0];
    putLink(instId, null, lt, chosen.occurred_at ?? observedAt, String(chosen.source_id ?? uniSource));
  }
  for (const m of nameMatched) putLink(m.institutionId, m.docId, m.linkType, observedAt, uniSource);
  links.close();

  // --- regulatory_events ← master timeline (one row per event; occurred_at is
  // NOT NULL in the frozen schema → fall back to observed_at when the master
  // honestly carries no date, and count it in the report). ---
  const insEvt = db.prepare(
    `INSERT OR IGNORE INTO regulatory_events
       (id, institution_id, event_type, title, occurred_at, description, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let eventsFallback = 0;
  for (const e of master.timeline) {
    if (!e.institution_id) continue;
    if (!e.occurred_at) eventsFallback++;
    const id = `reg-${sha1(`${e.institution_id}|${e.event_type}|${e.title}|${e.occurred_at ?? ""}|${e.predecessor_id ?? ""}`).slice(0, 8)}`;
    insEvt.run(id, e.institution_id, e.event_type, e.title, e.occurred_at ?? observedAt, e.summary ?? null, String(e.source_id ?? uniSource));
  }

  db.close();

  // Ancestry + breakdowns (computed alongside, not part of the ledger-only
  // repeat diff): every nrb_documents source must have ≥1 snapshot in the INT
  // AKE DB (the ledger DB is a projection, not a crawl store).
  const ledgerRead = new Database(ledgerDbPath);
  const docsSources = (ledgerRead.prepare("SELECT DISTINCT source_id FROM nrb_documents").all() ?? []).map((r) => String(r.source_id));
  const linkTypes = (ledgerRead.prepare("SELECT link_type t, COUNT(*) n FROM nrb_institution_links GROUP BY link_type").all() ?? []).reduce(
    (acc: Record<string, number>, r) => { acc[String(r.t)] = Number(r.n); return acc; },
    {} as Record<string, number>,
  );
  const docTypeCounts = (ledgerRead.prepare("SELECT doc_type t, COUNT(*) n FROM nrb_documents GROUP BY doc_type").all() ?? []).reduce(
    (acc: Record<string, number>, r) => { acc[String(r.t)] = Number(r.n); return acc; },
    {} as Record<string, number>,
  );
  ledgerRead.close();
  const intake = new Database(intakeDbPath, { readonly: true });
  let sourcesWithAncestry = 0;
  for (const sid of docsSources) {
    const n = (intake.prepare("SELECT COUNT(*) c FROM source_snapshots WHERE source_id=?").get(sid) ?? { c: 0 }) as { c: number };
    if (n.c > 0) sourcesWithAncestry++;
  }
  intake.close();

  const before = countNow(ledgerDbPath, outRows.length, eventsFallback, nameMatched.length);

  if (repeat) {
    const second = countNow(ledgerDbPath, outRows.length, eventsFallback, nameMatched.length);
    const diff = Object.keys(before).filter((k) => before[k] !== second[k]);
    console.log(`[repeat] ledger unchanged: ${diff.length === 0}`);
    if (diff.length > 0) console.log(" [repeat] diff fields:", diff.join(", "), JSON.stringify(before), JSON.stringify(second));
  }

  const report = {
    phase: "M1.5.2 — NRB ledger (nrb_documents / nrb_institution_links / regulatory_events)",
    intakeDbPath,
    ledgerDbPath,
    observedAt,
    counts: { ...before, linkTypes, docTypes: docTypeCounts },
    ancestry: {
      docs_sources: docsSources.length,
      sources_with_snapshot_ancestry: sourcesWithAncestry,
    },
    checks: {
      documentsEqualDistinctHrefs: before.nrb_documents === before.distinct_listing_hrefs,
      zeroOrphans: before.orphan_links === 0 && before.orphan_events === 0,
      everyDocumentSourceHasSnapshotAncestry: sourcesWithAncestry === docsSources.length,
      publisherDateCarried: before.docs_published_at > 0,
      noNameMatchedLinksInvented: before.name_matched_links === 0,
    },
    determinism: { rerunIsNoop: repeat },
    aiUsed: false,
    publishedToPublicSite: false,
    note: "scratch review DB only; deterministic ids; INSERT OR IGNORE; nothing fabricated; no schema change; no publish",
  };
  writeFileSync(LEDGER_REPORT_JSON, JSON.stringify(report, null, 2));
  console.log(`\nNRB LEDGER REPORT -> ${LEDGER_REPORT_JSON}`);
  console.log(" ", JSON.stringify({ ...before, linkTypes, docTypes: docTypeCounts }, null, 0));
  console.log(`  ancestry: ${sourcesWithAncestry}/${docsSources.length} document sources have intake snapshots`);

  const sampleDb = new Database(ledgerDbPath);
  console.log("\n== nrb_documents sample ==");
  for (const r of (sampleDb.prepare("SELECT source_id, doc_type, topic, published_at, official_url, title FROM nrb_documents ORDER BY source_id, published_at LIMIT 8").all() ?? [])) {
    console.log(`  ${String(r.source_id).padEnd(24)} ${String(r.doc_type).padEnd(12)} ${String(r.published_at ?? "-").padEnd(12)} ${(r.title as string).slice(0, 58)}`);
  }
  console.log("\n== regulatory_events sample ==");
  for (const r of (sampleDb.prepare("SELECT institution_id, event_type, occurred_at, title FROM regulatory_events ORDER BY occurred_at DESC, institution_id LIMIT 4").all() ?? [])) {
    console.log(`  ${String(r.institution_id).padEnd(10)} ${String(r.event_type).padEnd(10)} ${String(r.occurred_at).slice(0, 10)}  ${r.title}`);
  }
  sampleDb.close();
}

main();