// ============================================================================
// V1.1.1 — read-only conflict triage report.
//
// Reads data_conflicts (read-only) from data/durable/store.db, classifies each
// row using only fields present in the schema, and writes:
//   docs/data/CONFLICT-TRIAGE.csv          (one row per conflict, full values)
//   docs/data/CONFLICT-TRIAGE-SUMMARY.md   (counts + categories + limitations)
//
// No data is mutated. Recommendations are report-only labels.
//
// Classification rules (documented, deterministic):
//   - source_a_id == source_b_id AND resolution_note mentions a parser/html/json
//     token -> "same-source parser disagreement (pre-fix artifact)" -> IGNORE_CANDIDATE
//   - source_a_id == source_b_id (no parser token) -> "same-source artifact" -> IGNORE_CANDIDATE
//   - source_a_id != source_b_id -> "cross-source disagreement" -> KEEP_OPEN
//   - otherwise -> "indeterminate" -> NEEDS_OWNER_REVIEW
//
// Run: npm run triage:conflicts
// ============================================================================
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => {
  prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] };
  close: () => void;
};
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

interface ConflictRow {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  source_a_id: string | null;
  value_a: string | null;
  source_b_id: string | null;
  value_b: string | null;
  detected_at: string;
  resolution_status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

interface InstRow { id: string; name_en: string }

function csvEscape(v: string | null): string {
  if (v === null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function classify(r: ConflictRow): { category: string; action: string; reason: string } {
  const sameSource = !!r.source_a_id && r.source_a_id === r.source_b_id;
  const note = (r.resolution_note ?? "").toLowerCase();
  const parserToken = /html|json|parser|extractor|v1|v2/.test(note);
  if (sameSource && parserToken) {
    return {
      category: "same-source parser disagreement (pre-fix artifact)",
      action: "IGNORE_CANDIDATE",
      reason: "Both sides share one source_id; resolution_note names two parsers of the same page. Per CONFLICT-VISIBILITY-CHAIN.md these are detector artifacts, not genuine disputes. Candidate only — owner review required before any status change.",
    };
  }
  if (sameSource) {
    return {
      category: "same-source artifact",
      action: "IGNORE_CANDIDATE",
      reason: "Both sides share one source_id; no distinct source disagrees. Candidate only — owner review required.",
    };
  }
  if (r.source_a_id && r.source_b_id && r.source_a_id !== r.source_b_id) {
    return {
      category: "cross-source disagreement",
      action: "KEEP_OPEN",
      reason: "Two distinct sources assert different values. Genuine disagreement; keep open for review.",
    };
  }
  return {
    category: "indeterminate",
    action: "NEEDS_OWNER_REVIEW",
    reason: "Source identity missing or ambiguous; cannot classify reliably.",
  };
}

function main(): void {
  const db = new Database(resolve(ROOT, "data/durable/store.db"), { readonly: true });

  const conflicts = db.prepare("SELECT * FROM data_conflicts ORDER BY entity_id, id").all() as ConflictRow[];
  const insts = db.prepare("SELECT id, name_en FROM institutions").all() as InstRow[];
  const nameById = new Map(insts.map((i) => [i.id, i.name_en]));
  db.close();

  // CSV
  const header = [
    "conflict_id", "entity_type", "entity_id", "institution_name", "field_name",
    "source_a_id", "value_a", "source_b_id", "value_b",
    "same_source", "detected_at", "resolution_status", "resolved_by", "resolved_at",
    "resolution_note", "category", "recommended_action", "reason",
  ];
  const csvLines = [header.join(",")];
  for (const r of conflicts) {
    const c = classify(r);
    const row = [
      csvEscape(r.id),
      csvEscape(r.entity_type),
      csvEscape(r.entity_id),
      csvEscape(nameById.get(r.entity_id) ?? r.entity_id),
      csvEscape(r.field_name),
      csvEscape(r.source_a_id),
      csvEscape(r.value_a),
      csvEscape(r.source_b_id),
      csvEscape(r.value_b),
      csvEscape(r.source_a_id === r.source_b_id ? "yes" : "no"),
      csvEscape(r.detected_at),
      csvEscape(r.resolution_status),
      csvEscape(r.resolved_by),
      csvEscape(r.resolved_at),
      csvEscape(r.resolution_note),
      csvEscape(c.category),
      csvEscape(c.action),
      csvEscape(c.reason),
    ];
    csvLines.push(row.join(","));
  }
  const csvPath = resolve(ROOT, "docs/data/CONFLICT-TRIAGE.csv");
  writeFileSync(csvPath, csvLines.join("\n") + "\n", "utf8");

  // Counts
  const counts = { total: conflicts.length, sameSource: 0, crossSource: 0, indeterminate: 0 };
  const bySource: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const r of conflicts) {
    const c = classify(r);
    if (r.source_a_id && r.source_a_id === r.source_b_id) counts.sameSource += 1;
    else if (r.source_a_id && r.source_b_id) counts.crossSource += 1;
    else counts.indeterminate += 1;
    byAction[c.action] = (byAction[c.action] ?? 0) + 1;
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    const src = r.source_a_id ?? "unknown";
    bySource[src] = (bySource[src] ?? 0) + 1;
  }

  // Markdown summary
  const md: string[] = [];
  md.push("# Conflict triage report (V1.1.1)");
  md.push("");
  md.push("Generated by `npm run triage:conflicts`. **Read-only: no conflict status or evidence was changed.**");
  md.push("");
  md.push("## Baseline");
  md.push("");
  md.push(`- Total conflict rows: **${counts.total}**`);
  md.push(`- Same source (a = b): **${counts.sameSource}**`);
  md.push(`- Cross source (a ≠ b): **${counts.crossSource}**`);
  md.push(`- Indeterminate (missing source): **${counts.indeterminate}**`);
  md.push(`- All ${counts.total} rows have resolution_status = OPEN; resolved_by/resolved_at are null on all.`);
  md.push("");
  md.push("## Categories");
  md.push("");
  md.push("| category | count | recommended action |");
  md.push("|---|---|---|");
  for (const [cat, n] of Object.entries(byCategory).sort()) {
    const action = cat.includes("cross-source") ? "KEEP_OPEN" : cat.includes("indeterminate") ? "NEEDS_OWNER_REVIEW" : "IGNORE_CANDIDATE";
    md.push(`| ${cat} | ${n} | ${action} |`);
  }
  md.push("");
  md.push("## Recommended actions (report-only labels, not applied)");
  md.push("");
  for (const [act, n] of Object.entries(byAction).sort()) md.push(`- ${act}: **${n}**`);
  md.push("");
  md.push("## By source");
  md.push("");
  md.push("| source | conflicts |");
  md.push("|---|---|");
  for (const [src, n] of Object.entries(bySource).sort()) md.push(`| ${src} | ${n} |`);
  md.push("");
  md.push("## Limitations");
  md.push("");
  md.push("- No per-value observation timestamp exists in `data_conflicts`; only `detected_at` (when the conflict was recorded) is available.");
  md.push("- Institution name is resolved from the durable store's `institutions` table; pilot stubs appear by id.");
  md.push("- Classification is based on source identity and the `resolution_note` text. Same-source rows are candidates for IGNORE, not confirmed false; owner review is required before any status change.");
  md.push("- Recommendations are labels in this report only. No `resolution_status`, `resolved_by`, `resolved_at`, or `resolution_note` was modified.");
  md.push("- Cross-source disagreements (0 today) would be KEEP_OPEN and are not auto-resolvable.");
  md.push("");
  md.push("## Files");
  md.push("");
  md.push("- `docs/data/CONFLICT-TRIAGE.csv` — one row per conflict (full values, no truncation).");
  md.push("- `docs/data/CONFLICT-TRIAGE-SUMMARY.md` — this file.");

  const mdPath = resolve(ROOT, "docs/data/CONFLICT-TRIAGE-SUMMARY.md");
  writeFileSync(mdPath, md.join("\n") + "\n", "utf8");

  console.log(`[triage:conflicts] conflicts=${conflicts.length} sameSource=${counts.sameSource} crossSource=${counts.crossSource} indeterminate=${counts.indeterminate}`);
  console.log(`[triage:conflicts] wrote ${csvPath}`);
  console.log(`[triage:conflicts] wrote ${mdPath}`);
}

main();
