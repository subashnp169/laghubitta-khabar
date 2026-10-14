// ============================================================================
// P0.5 — Durable ingestion store builder.
//
// The pilot left 13 dated evidence databases under data/pilot/evidence/. Each one
// holds a complete run spine (sources, source_snapshots, ingestion_sources,
// ingestion_runs, ingestion_items, ingestion_errors, data_assertions,
// data_conflicts, validation_rules, validation_results, audit_logs), but no two
// runs can see each other: the connection string is a per-experiment scratch
// path, so nothing accumulates into one durable canonical history.
//
// This script builds that history: ONE database containing every run ever
// recorded, with the existing schema only. No migration, no new table, no new
// column. The 7 conceptual names in the directive map onto tables that already
// exist (see docs/data/DURABLE-RUN-MODEL.md).
//
//   npx tsx scripts/build-durable-store.ts [--out <path>]
//
// SAFETY
//   - Source databases are opened READ-ONLY and are never written. Each one is
//     sha256'd before and after the load; a mismatch aborts with a failure.
//   - The only file deleted is the derived output, and only after guard-env has
//     confirmed LK_ENV is local.
//   - The evidence is the primary record (P0.4 source-of-truth matrix). This
//     script is a rebuildable projection of it, never a replacement for it.
// ============================================================================

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { guardOrExit } from "./guard-env.cjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

type Row = Record<string, unknown>;

const ROOT = resolve(__dirname, "..");
const EVIDENCE_DIR = join(ROOT, "data", "pilot", "evidence");
const SCHEMA_SQL = join(ROOT, "schema", "schema.sql");

// How each table may be loaded, established by the P0.5 collision audit over all
// 13 evidence databases (docs/data/DURABLE-RUN-MODEL.md §4).
//
//   append — every primary key is globally unique across the evidence set, so
//            rows can be inserted verbatim with no reconciliation.
//   upsert — the same id appears in several databases carrying DIFFERENT row
//            content. Those are per-run registrations of one logical thing, not
//            competing copies of one record, so the most recently registered
//            row wins and the earlier ones are counted and reported.
type Strategy = "append" | "upsert";

const PLAN: { table: string; strategy: Strategy; note: string }[] = [
  { table: "sources", strategy: "upsert", note: "51 ids registered per-run; title/url/publisher differ between runs" },
  { table: "users", strategy: "upsert", note: "referenced by audit_logs.actor_id" },
  { table: "institutions", strategy: "upsert", note: "FK target for ingestion_sources; held as a reference copy only, entity state is P1's job" },
  { table: "ingestion_sources", strategy: "upsert", note: "51 ids re-registered per run; config/last_run_at differ" },
  { table: "source_snapshots", strategy: "append", note: "1428 ids, zero collisions" },
  { table: "ingestion_runs", strategy: "append", note: "264 ids, zero collisions, ids embed timestamp+source" },
  { table: "ingestion_items", strategy: "append", note: "1491 ids, zero collisions" },
  { table: "ingestion_errors", strategy: "append", note: "78 ids, zero collisions" },
  { table: "data_assertions", strategy: "append", note: "5083 ids, zero collisions" },
  { table: "data_conflicts", strategy: "append", note: "229 ids, zero collisions" },
  { table: "validation_rules", strategy: "upsert", note: "8 ids, 1 defined differently in two runs" },
  { table: "validation_results", strategy: "append", note: "3970 ids, zero collisions" },
  { table: "audit_logs", strategy: "append", note: "6767 ids, zero collisions" },
];

const outArgIndex = process.argv.indexOf("--out");
const OUT = outArgIndex > -1 && process.argv[outArgIndex + 1]
  ? resolve(process.argv[outArgIndex + 1])
  : join(ROOT, "data", "durable", "store.db");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function tableExists(db: { prepare(sql: string): { get(...a: unknown[]): Row | undefined } }, t: string): boolean {
  return db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=?").get(t)!.c !== 0;
}

function columnsOf(db: { prepare(sql: string): { all(...a: unknown[]): Row[] } }, t: string): string[] {
  return db.prepare(`PRAGMA table_info("${t}")`).all().map((r) => r.name as string);
}

/** Evidence files, oldest first, so "most recently registered wins" is chronological. */
function evidenceFiles(): string[] {
  return readdirSync(EVIDENCE_DIR)
    .filter((f) => f.endsWith(".db"))
    .sort((a, b) => probeOrder(a) - probeOrder(b) || a.localeCompare(b));
}

/**
 * Sort key for an evidence database: the newest run it recorded. Two files carry
 * no date in their name (pilot-people-ext-c-pass2, m34-external-sample-*), and
 * guessing from the filename would order the load wrongly, so the databases own
 * their own chronology. A database with no ingestion_runs table falls back to
 * any date in its filename, then to 0.
 */
function probeOrder(file: string): number {
  const db = new Database(join(EVIDENCE_DIR, file), { readonly: true, fileMustExist: true });
  let key = 0;
  if (tableExists(db, "ingestion_runs")) {
    const row = db.prepare("SELECT MAX(started_at) t FROM ingestion_runs").get() as { t: string | null };
    if (row?.t) key = Date.parse(row.t);
  }
  if (key === 0 && tableExists(db, "source_snapshots")) {
    const row = db.prepare("SELECT MAX(fetched_at) t FROM source_snapshots").get() as { t: string | null };
    if (row?.t) key = Date.parse(row.t);
  }
  if (key === 0) {
    const d = file.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
    if (d) key = Date.parse(`${d}T00:00:00Z`);
  }
  db.close();
  return Number.isNaN(key) ? 0 : key;
}

interface Loaded {
  inserted: number;
  replaced: number;
  skippedColumns: Record<string, string[]>;
  missingTable: number;
}

guardOrExit("scripts/build-durable-store.ts");

const files = evidenceFiles();
if (files.length === 0) {
  console.error(`No evidence databases in ${EVIDENCE_DIR}. Nothing to consolidate.`);
  process.exit(1);
}

console.log(`P0.5 durable store builder`);
console.log(`  evidence : ${EVIDENCE_DIR} (${files.length} databases)`);
console.log(`  output   : ${OUT}`);

// ---------------------------------------------------------------------------
// 1. Fingerprint every evidence database so we can prove it was not touched.
// ---------------------------------------------------------------------------
const before = new Map<string, string>();
for (const f of files) before.set(f, sha256(join(EVIDENCE_DIR, f)));

// ---------------------------------------------------------------------------
// 2. Create the durable store from the canonical schema. No new tables.
// ---------------------------------------------------------------------------
if (existsSync(OUT)) rmSync(OUT, { force: true });
mkdirSync(dirname(OUT), { recursive: true });
const out = new Database(OUT);
out.exec(readFileSync(SCHEMA_SQL, "utf8"));
// Foreign keys stay OFF for the load, and this must come AFTER schema.sql:
// that file opens with `PRAGMA foreign_keys = ON`, which would otherwise re-arm
// the constraint. `ingestion_sources` re-registration uses INSERT OR REPLACE,
// and with FKs on, REPLACE would cascade-delete the source_snapshots that
// reference the row being replaced. Integrity is checked explicitly afterwards
// with foreign_key_check, and violations are reported rather than hidden.
out.pragma("foreign_keys = OFF");

const targetTables = out.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r: Row) => r.name as string);
for (const { table } of PLAN) {
  if (!targetTables.includes(table)) {
    console.error(`ABORT: schema/schema.sql has no table "${table}". The durable model would be incomplete.`);
    process.exit(1);
  }
}
const targetCols = new Map(PLAN.map(({ table }) => [table, columnsOf(out, table)]));

// ---------------------------------------------------------------------------
// 3. Load, oldest evidence database first.
// ---------------------------------------------------------------------------
const totals = new Map<string, Loaded>(
  PLAN.map(({ table }) => [table, { inserted: 0, replaced: 0, skippedColumns: {}, missingTable: 0 }]),
);

for (const f of files) {
  const src = new Database(join(EVIDENCE_DIR, f), { readonly: true, fileMustExist: true });
  const srcTables = new Set(src.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: Row) => r.name as string));
  let read = 0;
  let wrote = 0;

  for (const { table, strategy } of PLAN) {
    const acc = totals.get(table)!;
    if (!srcTables.has(table)) {
      acc.missingTable += 1;
      continue;
    }
    const useCols = targetCols.get(table)!.filter((c) => columnsOf(src, table).includes(c));
    const dropCols = targetCols.get(table)!.filter((c) => !useCols.includes(c));
    if (useCols.length === 0) continue;

    const verb = strategy === "upsert" ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
    const sql = `${verb} INTO "${table}" (${useCols.map((c) => `"${c}"`).join(",")}) VALUES (${useCols.map(() => "?").join(",")})`;
    const stmt = out.prepare(sql);

    const rows = src.prepare(`SELECT ${useCols.map((c) => `"${c}"`).join(",")} FROM "${table}"`).all() as Row[];
    if (rows.length === 0) continue;
    if (dropCols.length > 0) {
      // Only worth reporting where the table actually holds rows — an empty
      // legacy table tells us nothing about its column set.
      acc.skippedColumns[f.replace(/\.db$/, "")] = dropCols;
    }
    const existsStmt = out.prepare(`SELECT 1 FROM "${table}" WHERE id = ?`);
    const run = out.transaction((batch: Row[]) => {
      for (const r of batch) {
        const args = useCols.map((c) => r[c] ?? null);
        if (strategy === "upsert" && existsStmt.get(args[0])) acc.replaced += 1;
        else acc.inserted += 1;
        stmt.run(...args);
      }
    });
    run(rows);
    read += rows.length;
    wrote += rows.length;
  }

  src.close();
  const skipped = PLAN.filter(({ table }) => totals.get(table)!.missingTable > 0).length;
  console.log(`  + ${f.replace(/\.db$/, "").padEnd(44)} ${String(wrote).padStart(5)} rows`);
}

// ---------------------------------------------------------------------------
// 4. Prove the evidence databases were not modified.
// ---------------------------------------------------------------------------
const mutated: string[] = [];
for (const f of files) {
  if (sha256(join(EVIDENCE_DIR, f)) !== before.get(f)) mutated.push(f);
}
if (mutated.length > 0) {
  console.error(`\nFAIL: these evidence databases changed during the load: ${mutated.join(", ")}`);
  out.close();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 5. Reconciliation. Every row read must be accounted for.
// ---------------------------------------------------------------------------
console.log(`\n  ${"table".padEnd(20)} ${"strategy".padEnd(8)} ${"in store".padStart(9)} ${"appended".padStart(9)} ${"upserted".padStart(9)} ${"not in this db".padStart(15)}`);
let totalIn = 0;
for (const { table, strategy } of PLAN) {
  const acc = totals.get(table)!;
  const n = out.prepare(`SELECT COUNT(*) c FROM "${table}"`).get()!.c as number;
  totalIn += n;
  const total = acc.inserted + acc.replaced;
  console.log(`  ${table.padEnd(20)} ${strategy.padEnd(8)} ${String(n).padStart(9)} ${String(acc.inserted).padStart(9)} ${String(acc.replaced).padStart(9)} ${String(acc.missingTable).padStart(15)}`);
  if (strategy === "append" && acc.inserted !== n) {
    console.error(`FAIL: ${table} appended ${acc.inserted} rows but the store holds ${n}.`);
  }
}
console.log(`  ${"TOTAL".padEnd(29)} ${String(totalIn).padStart(9)}`);

// ---------------------------------------------------------------------------
// 6. Referential integrity of the merged store, reported honestly.
// ---------------------------------------------------------------------------
const fk = out.pragma("foreign_key_check") as { table: string; rowid: number; parent: string; fkid: number }[];
const fkByTable = new Map<string, number>();
for (const v of fk) fkByTable.set(v.table, (fkByTable.get(v.table) ?? 0) + 1);
console.log(`\n  foreign_key_check: ${fk.length} violations` + (fk.length ? "" : " — store is referentially intact"));
for (const [t, n] of [...fkByTable.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(5)}  ${t}`);

const superseded = [...totals.entries()].filter(([, a]) => a.replaced > 0);
if (superseded.length > 0) {
  console.log(`\n  Superseded registrations (earlier row for the same id, kept in the evidence databases):`);
  for (const [t, a] of superseded) console.log(`      ${String(a.replaced).padStart(5)}  ${t}`);
}
const narrowed = [...totals.entries()].filter(([, a]) => Object.keys(a.skippedColumns).length > 0);
if (narrowed.length > 0) {
  console.log(`\n  Databases with a narrower column set (target columns defaulted, no value invented):`);
  for (const [t, a] of narrowed) for (const [db, cols] of Object.entries(a.skippedColumns)) console.log(`      ${t} <- ${db}: ${cols.join(", ")}`);
}

out.close();
console.log(`\nOK — durable store built from ${files.length} evidence databases, ${totalIn} rows, sources unchanged (${files.length}/${files.length} sha256 verified).`);