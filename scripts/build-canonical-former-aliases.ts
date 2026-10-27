import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const MASTER = join(ROOT, "data/master/master.json");
const OUT_JSON = join(ROOT, "data/master/canonical-former-aliases.json");

const master = JSON.parse(readFileSync(MASTER, "utf8"));
const timeline = master.timeline || [];
const existing = new Set(
  (master.aliases as Array<{ institution_id: string; normalized_alias?: string; alias: string }>).map(
    (a) => a.institution_id + ":" + (a.normalized_alias || a.alias.toLowerCase()),
  ),
);

const rows: Array<{ institution_id: string; alias: string; alias_type: string; event_type: string; source_id: string }> = [];
for (const ev of timeline) {
  const pid = ev.institution_id;
  const pred = ev.predecessor_name;
  if (!pid || !pred) continue;
  const key = pid+':'+pred.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  if (existing.has(key)) continue;
  rows.push({
    institution_id: pid,
    alias: pred,
    alias_type: 'FORMER',
    is_active: 1,
    source_id: master.universeSnapshot?.source_id || 'nrb-bfi-mid-may-2026',
    reason: 'timeline predecessor absorbed',
    event_type: ev.event_type,
    title: ev.title,
    evidence: ev.evidence_url || ev.evidence_id,
  });
}

const out = {
  generated_by: "scripts/build-canonical-former-aliases.ts",
  purpose: "FORMER aliases from timeline_events predecessors (lineage closure)",
  count: rows.length,
  rows: rows.sort((a,b)=>a.institution_id.localeCompare(b.institution_id)),
};
writeFileSync(OUT_JSON, JSON.stringify(out,null,2)+'\n','utf8');
console.log(`wrote ${rows.length} former aliases`);