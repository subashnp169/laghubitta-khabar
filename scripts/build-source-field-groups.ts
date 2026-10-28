// ============================================================================
// V1.1 — build source -> field-group mapping.
//
// Maps each registered source to the field groups it can refresh, using the
// existing field_refresh_policies thresholds. The mapping is a judgment, documented
// here and in the generated file; it is additive (no schema change) and feeds the
// staleness section of report:data-quality.
//
// Heuristic (documented):
//   - MFB website sources feed all institution-level groups.
//   - NRB sources feed NEWS + ANNUAL_REPORT (regulatory).
//   - Market data providers feed FINANCIALS.
//   - The NRB BFI master source feeds no refreshable group (identity is
//     refreshed by master rebuild, not by ingestion runs).
//
// Usage: npm run build:source-field-groups
// ============================================================================
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => {
  prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] };
  close: () => void;
};
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

const MFB_GROUPS = ["BRANCHES", "CEO", "FINANCIALS", "JOBS", "NEWS", "CONTACT", "SOCIAL", "ANNUAL_REPORT"];
const NRB_GROUPS = ["NEWS", "ANNUAL_REPORT"];
const MARKET_GROUPS = ["FINANCIALS"];

function groupForSource(id: string): string[] {
  if (id.startsWith("mero-") || id === "share-sansar") return MARKET_GROUPS;
  if (id.startsWith("nrb-") || id === "nrb-bank-list") return NRB_GROUPS;
  if (id === "nrb-bfi-mid-may-2026") return [];
  return MFB_GROUPS;
}

function main(): void {
  const db = new Database(resolve(ROOT, "data/durable/store.db"), { readonly: true });
  const sources = db.prepare("SELECT id FROM sources ORDER BY id").all() as Array<{ id: string }>;
  db.close();

  const mapping: Record<string, string[]> = {};
  for (const s of sources) mapping[s.id] = groupForSource(s.id);

  const body = JSON.stringify(
    {
      generatedBy: "scripts/build-source-field-groups.ts",
      rationale: "MFB website sources feed all institution-level field groups; NRB sources feed NEWS+ANNUAL_REPORT; market providers feed FINANCIALS; the NRB BFI master source feeds none (refreshed by master rebuild).",
      mapping,
    },
    null,
    2,
  );

  const outPath = resolve(ROOT, "data/master/source-field-groups.json");
  writeFileSync(outPath, body + "\n", "utf8");
  console.log(`[build:source-field-groups] wrote ${outPath} (${Object.keys(mapping).length} sources)`);
}

main();
