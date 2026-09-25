// ============================================================================
// Phase R — controlled pilot expansion (deterministic, evidence-backed).
//
// Reads the canonical master universe (data/master/master.json) and extends
// data/pilot/pilot-sources.json to the requested source count (default 20).
// Selection is purely mechanical and reproducible: the next ACTIVE
// institutions that have an official_website in master.json and are not
// already in the pilot, ordered by institution id ascending. ONLY the
// NRB-proven website URL becomes a real known_url; every other capability
// stays a discovery intent (known_url=null). No URL is invented. Re-running
// with the same target is a no-op (idempotent).
//
//   run: npx tsx scripts/pilot-expand.ts [target-count]
//   env LK_PILOT_TARGET=30
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface MasterInstitution {
  id: string;
  name_en: string;
  short_name: string | null;
  status: string;
  official_website: string | null;
  source_id: string;
}

interface PilotSource {
  id: string;
  source_type: string;
  source_scope: string;
  source_grade: string;
  institution_id: string;
  url: string;
  domain: string;
  title: string;
  publisher: string;
  proven_by: string;
  status: string;
  verified: number;
  is_active: number;
  capabilities: Array<{
    capability: string;
    status: string;
    known_url: string | null;
    link_type: string;
    note: string;
  }>;
}

const MASTER_JSON = join(process.cwd(), "data", "master", "master.json");
const PILOT_JSON = join(process.cwd(), "data", "pilot", "pilot-sources.json");
const TARGET_COUNT = Number(process.argv[2] ?? process.env.LK_PILOT_TARGET ?? "20");

interface PilotFile {
  $schema?: string;
  generated_at?: string;
  provenance_note?: string;
  sources: PilotSource[];
}

const CAP_INTENT = (capability: string, linkType: string, note: string) => ({
  capability,
  status: "CANDIDATE",
  known_url: null,
  link_type: linkType,
  note,
});

function shortIdFromUrl(url: string, taken: Set<string>): string | null {
  let host = url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  host = host.toLowerCase();
  const base = host.replace(/^(www|www2)\./, "").split(".")[0] || host.split(".")[0];
  const clean = base.replace(/[^a-z0-9]+/g, "");
  if (!clean) return null;
  let id = `${clean}-website`;
  let n = 2;
  while (taken.has(id)) {
    id = `${clean}-${n}-website`;
    n += 1;
  }
  return id;
}

function main(): void {
  const master = JSON.parse(readFileSync(MASTER_JSON, "utf8")) as { institutions: MasterInstitution[] };
  const pilot = JSON.parse(readFileSync(PILOT_JSON, "utf8")) as PilotFile;

  const covered = new Set(pilot.sources.map((s) => s.institution_id));
  const taken = new Set(pilot.sources.map((s) => s.id));

  const candidates = master.institutions
    .filter((i) => !covered.has(i.id) && i.status === "ACTIVE" && !!i.official_website)
    .sort((a, b) => a.id.localeCompare(b.id));

  const needed = TARGET_COUNT - pilot.sources.length;
  if (needed <= 0) {
    console.log(`pilot already has ${pilot.sources.length} sources; nothing to add.`);
    return;
  }

  const additions: PilotSource[] = [];
  for (const inst of candidates) {
    if (additions.length >= needed) break;
    const url = inst.official_website as string;
    const id = shortIdFromUrl(url, taken);
    if (!id) continue;
    const urlObj = new URL(url);
    const source: PilotSource = {
      id,
      source_type: "MFB_WEBSITE",
      source_scope: "INSTITUTION",
      source_grade: "A",
      institution_id: inst.id,
      url,
      domain: urlObj.hostname,
      title: `${inst.name_en} — official website`,
      publisher: inst.name_en,
      proven_by: "nrb-bfi-mid-may-2026",
      status: "CANDIDATE",
      verified: 0,
      is_active: 1,
      capabilities: [
        {
          capability: "WEBSITE",
          status: "CANDIDATE",
          known_url: url,
          link_type: "WEBSITE",
          note: "URL from NRB official BFI list (mid-May-2026); not yet fetched",
        },
        CAP_INTENT("REPORTS", "REPORT_PAGE", "discovery intent — page/URL must be located in pilot before any fetch"),
        CAP_INTENT("NEWS", "NOTICE_BOARD", "discovery intent — page/URL must be located in pilot before any fetch"),
        CAP_INTENT("BRANCH_DIRECTORY", "BRANCH_PAGE", "discovery intent — page/URL must be located in pilot before any fetch"),
        CAP_INTENT("CAREER_PAGE", "CAREER_PAGE", "discovery intent — page/URL must be located in pilot before any fetch"),
        CAP_INTENT("DOCUMENT_ARCHIVE", "REPORT_PAGE", "discovery intent — page/URL must be located in pilot before any fetch"),
        CAP_INTENT("SITEMAP", "OTHER", "discovery intent — page/URL must be located in pilot before any fetch"),
      ],
    };
    additions.push(source);
    taken.add(id);
    covered.add(inst.id);
    console.log(`  + ${inst.id} ${inst.name_en} -> ${id} (${url})`);
  }

  void covered;

  pilot.sources.push(...additions);
  pilot.generated_at = new Date().toISOString();
  pilot.provenance_note = `${pilot.provenance_note}\nPhase R expansion: extended deterministically from ${TARGET_COUNT - additions.length} to ${TARGET_COUNT} sources (next ${additions.length} ACTIVE master institutions with an NRB-proven official_website, by id ascending). Only WEBSITE has a real URL; all other capabilities remain discovery intents.`;

  writeFileSync(PILOT_JSON, JSON.stringify(pilot, null, 2) + "\n");
  console.log(`wrote ${TARGET_COUNT} pilot sources -> ${PILOT_JSON}`);
  if (pilot.sources.length !== TARGET_COUNT) {
    console.error(`FAIL: expected ${TARGET_COUNT} sources, got ${pilot.sources.length}`);
    process.exit(1);
  }
}

main();