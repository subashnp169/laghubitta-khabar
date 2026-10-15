// ============================================================================
// P8 — Corporate history (former/predecessor names) contract.
//
// The profile now shows the predecessor names an institution absorbed, taken from
// the canonical FORMER-alias lineage register (P1-B). This locks the properties
// that make that honest:
//   * every name on the page is IN the register — nothing is inferred from a name
//     similarity, so the module may not contain a name the register does not;
//   * the register's FORMER rows all survive (no silent drops);
//   * the event vocabulary is exactly MERGED / ACQUIRED / RENAMED;
//   * no record carries a date — the register records none, so the page must not
//     invent one;
//   * the profile actually wires the panel (`#history` nav target + section id),
//     which smoke:profile-nav also checks for every section.
//
// Run: npm run smoke:history-p8
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formerNames, formerNamesProvenance } from "../src/data/former-names";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log("  ok  ", name);
  } else {
    fail += 1;
    console.log("  FAIL", name);
  }
}

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const ALLOWED = ["MERGED", "ACQUIRED", "RENAMED"];

// --- Register is the source of truth -----------------------------------------
interface RegisterRow {
  institution_id: string;
  alias: string;
  alias_type: string;
  event_type: string;
  source_id: string;
}
const register = JSON.parse(read("data/master/canonical-former-aliases.json")) as { rows: RegisterRow[] };
const formerRows = register.rows.filter((r) => String(r.alias_type).toUpperCase() === "FORMER");
check("the register carries at least one FORMER row", formerRows.length > 0);
check(
  `the register's FORMER rows are all recognised event types (${formerRows.length} rows)`,
  formerRows.every((r) => ALLOWED.includes(String(r.event_type).toUpperCase())),
);

// --- Module shape ------------------------------------------------------------
const ids = Object.keys(formerNames);
check("formerNames is keyed by canonical institution id", ids.every((id) => /^mfi-\d+$/.test(id)));
check("formerNames is non-empty", ids.length > 0);

const registerKeys = new Set(formerRows.map((r) => `${r.institution_id}|${r.alias}|${r.event_type}`));
const moduleKeys: string[] = [];
for (const id of ids) {
  for (const rec of formerNames[id]) {
    moduleKeys.push(`${id}|${rec.alias}|${rec.eventType}`);
  }
}

check(
  `every published name is in the register (no inferred names) — ${moduleKeys.length} checked`,
  moduleKeys.every((k) => registerKeys.has(k)),
);
check(
  `every register FORMER row is published (no silent drops) — ${formerRows.length} expected`,
  registerKeys.size === new Set(moduleKeys).size && formerRows.every((r) => moduleKeys.includes(`${r.institution_id}|${r.alias}|${r.event_type}`)),
);

const shapeOk = ids.every((id) =>
  formerNames[id].every(
    (rec) =>
      typeof rec.alias === "string" &&
      rec.alias.trim().length > 0 &&
      ALLOWED.includes(rec.eventType) &&
      typeof rec.sourceId === "string" &&
      rec.sourceId.trim().length > 0 &&
      Object.keys(rec).every((k) => ["alias", "eventType", "sourceId"].includes(k)),
  ),
);
check("every record has only {alias, eventType, sourceId} and no date field", shapeOk);
check("the module declares its provenance", typeof formerNamesProvenance === "string" && formerNamesProvenance.length > 0);

// --- Profile wiring ----------------------------------------------------------
const profile = read("src/app/institutions/[slug]/page.tsx");
check("profile imports formerNames from the site-data facade", /formerNames[\s,}]*.*from "@\/lib\/site-data"/.test(profile) || profile.includes("formerNames"));
check("profile renders a #history section id", profile.includes('id="history"'));
check("profile offers a #history nav target", profile.includes('href: "#history"'));
check("profile reads the lineage list (formerNameList)", profile.includes("formerNames[inst.id]"));

// --- Vocabulary lives in the util, not the page ------------------------------
const history = read("src/util/history.ts");
check("history util states the no-inference / no-date rule", history.includes("never inferred") && history.includes("no event date"));

// --- Site-data facade exposes the layer --------------------------------------
const siteData = read("src/lib/site-data.ts");
check("site-data re-exports formerNames", siteData.includes("formerNames") && siteData.includes("@/data/former-names"));

console.log(`\nsmoke:history-p8: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
