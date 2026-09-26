// ============================================================================
// M1.6 — schedule + control-plane acceptance tests. Fixture-based: no real
// crawling, no production D1, temp sqlite only. Proves the SCHEDULE DOMAIN,
// not websites:
//   01 frozen default cadence map
//   02 effective cadence = min over capabilities (fallback default)
//   03 schedule overrides: valid values + strict rejection (bad kind/range/type)
//   04 due computation: null / within-cadence / overdue / malformed dates
//   05 cadence buckets (frequent / periodic / slow)
//   06 ops DB integration: listSources reads config_json, last_run_at, and the
//      MAX(ingestion_runs.started_at) fallback; due-now excludes paused sources
// ============================================================================

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  cadenceBucket,
  CADENCE_MAX_MINUTES,
  CAPABILITY_CADENCE_MINUTES,
  computeDue,
  DEFAULT_CADENCE_MINUTES,
  effectiveCadenceMinutes,
  parseScheduleOverrides,
  ScheduleConfigError,
} from "../lib/ingestion/schedule";
import { listSources } from "./ops-cli";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string) => {
  prepare(s: string): {
    get(...a: unknown[]): Record<string, unknown> | undefined;
    all(...a: unknown[]): Record<string, unknown>[];
    run(...a: unknown[]): unknown;
  };
  exec(s: string): void;
  close(): void;
};

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}`);
  }
}

function throws(fn: () => unknown, label: string, err?: new (...a: never[]) => Error): void {
  try {
    fn();
    ok(false, `${label} (expected throw)`);
  } catch (e) {
    ok(err === undefined || e instanceof err, `${label}${e instanceof Error ? ` (got: ${e.message.slice(0, 60)})` : ""}`);
  }
}

console.log("smoke:schedule — frozen default cadence map");
ok(CAPABILITY_CADENCE_MINUTES.NEWS === 60, "NEWS cadence 60 (frequent)");
ok(CAPABILITY_CADENCE_MINUTES.CAREER_PAGE === 60, "CAREER_PAGE cadence 60 (frequent)");
ok(CAPABILITY_CADENCE_MINUTES.RSS === 60, "RSS cadence 60 (frequent)");
ok(CAPABILITY_CADENCE_MINUTES.WEBSITE === 1440, "WEBSITE cadence 1440 (periodic)");
ok(CAPABILITY_CADENCE_MINUTES.REPORTS === 1440, "REPORTS cadence 1440 (periodic)");
ok(CAPABILITY_CADENCE_MINUTES.DOCUMENT_ARCHIVE === 1440, "DOCUMENT_ARCHIVE cadence 1440");
ok(CAPABILITY_CADENCE_MINUTES.BRANCH_DIRECTORY === 10080, "BRANCH_DIRECTORY cadence 10080 (slow)");
ok(CAPABILITY_CADENCE_MINUTES.SITEMAP === 10080, "SITEMAP cadence 10080 (slow)");
ok(DEFAULT_CADENCE_MINUTES === 1440, "default cadence 1440");

console.log("smoke:schedule — effective cadence (min over capabilities)");
ok(effectiveCadenceMinutes([]) === 1440, "no capabilities -> default 1440");
ok(effectiveCadenceMinutes([{ capability: "NEWS" }, { capability: "BRANCH_DIRECTORY" }]) === 60, "min(NEWS 60, BRANCH 10080) -> 60");
ok(effectiveCadenceMinutes([{ capability: "UNKNOWN" }]) === 1440, "unknown capability -> default 1440");
ok(effectiveCadenceMinutes([{ capability: "NEWS" }], { NEWS: 30 }) === 30, "override NEWS 30 wins");
ok(effectiveCadenceMinutes([{ capability: "WEBSITE" }, { capability: "NEWS" }], { NEWS: 90 }) === 90, "min override then frozen -> 90");

console.log("smoke:schedule — config overrides (strict)");
ok(JSON.stringify(parseScheduleOverrides("{}")) === "{}", "empty config -> no overrides");
ok(JSON.stringify(parseScheduleOverrides('{"schedule":{"NEWS":600}}')) === '{"NEWS":600}', "valid override parsed");
throws(() => parseScheduleOverrides("not-json"), "non-JSON config_json -> ScheduleConfigError", ScheduleConfigError);
throws(() => parseScheduleOverrides('{"schedule":{"FOO":30}}'), "unknown kind rejected", ScheduleConfigError);
throws(() => parseScheduleOverrides('{"schedule":{"NEWS":1}}'), "below-min rejected", ScheduleConfigError);
throws(() => parseScheduleOverrides(`{"schedule":{"NEWS":${CADENCE_MAX_MINUTES + 1}}}`), "above-max rejected", ScheduleConfigError);
throws(() => parseScheduleOverrides('{"schedule":{"NEWS":"fast"}}'), "non-integer rejected", ScheduleConfigError);
throws(() => parseScheduleOverrides('{"schedule":[]}'), "non-object schedule rejected", ScheduleConfigError);

console.log("smoke:schedule — due computation");
const now = "2026-06-20T12:00:00.000Z";
const fiveMinAgo = new Date(Date.parse(now) - 5 * 60000).toISOString();
const seventyMinAgo = new Date(Date.parse(now) - 70 * 60000).toISOString();
ok(computeDue(null, 60, now).isDue === true, "no last run -> due now");
ok(computeDue(fiveMinAgo, 60, now).isDue === false, "ran 5m ago (cad 60) -> not due");
ok(computeDue(seventyMinAgo, 60, now).isDue === true, "ran 70m ago (cad 60) -> due");
ok(computeDue("garbage-date", 60, now).isDue === true, "malformed last run -> due now");
ok(computeDue(fiveMinAgo, 60, now).nextDueAt === new Date(Date.parse(fiveMinAgo) + 3600000).toISOString(), "nextDue = lastRun + cadence");

console.log("smoke:schedule — cadence buckets");
ok(cadenceBucket(60) === "frequent", "60 -> frequent");
ok(cadenceBucket(120) === "frequent", "120 -> frequent");
ok(cadenceBucket(121) === "periodic", "121 -> periodic");
ok(cadenceBucket(1440) === "periodic", "1440 -> periodic");
ok(cadenceBucket(10080) === "slow", "10080 -> slow");

console.log("smoke:schedule — ops DB integration");
const dbPath = join(mkdtempSync(join(tmpdir(), "lk-sched-")), "sched.db");
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE ingestion_sources (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, domain TEXT, source_type TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, config_json TEXT NOT NULL DEFAULT '{}',
    last_run_at TEXT
  );
  CREATE TABLE ingestion_runs (
    id TEXT PRIMARY KEY, ingestion_source_id TEXT NOT NULL, started_at TEXT NOT NULL
  );
`);
const ins = db.prepare(
  "INSERT INTO ingestion_sources (id, url, domain, source_type, enabled, config_json, last_run_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
ins.run("s-frequent", "https://a.test", "a.test", "MFB_WEBSITE", 1, JSON.stringify({ capabilities: [{ capability: "NEWS" }, { capability: "BRANCH_DIRECTORY" }] }), null);
ins.run("s-daily", "https://b.test", "b.test", "MFB_WEBSITE", 1, JSON.stringify({ capabilities: [{ capability: "WEBSITE" }] }), fiveMinAgo);
ins.run("s-paused", "https://c.test", "c.test", "MFB_WEBSITE", 0, JSON.stringify({ capabilities: [{ capability: "NEWS" }] }), null);
ins.run("s-override", "https://d.test", "d.test", "MFB_WEBSITE", 1, JSON.stringify({ capabilities: [{ capability: "NEWS" }], schedule: { NEWS: 90 } }), null);
ins.run("s-run-fallback", "https://e.test", "e.test", "MFB_WEBSITE", 1, JSON.stringify({ capabilities: [{ capability: "WEBSITE" }] }), null);
db.prepare("INSERT INTO ingestion_runs (id, ingestion_source_id, started_at) VALUES ('r1', 's-run-fallback', ?)").run(fiveMinAgo);
db.close();

const listed = listSources(dbPath, now);
ok(listed.length === 5, "lists 5 sources");
const byId = Object.fromEntries(listed.map((s) => [s.id, s]));
ok(byId["s-frequent"].cadenceMinutes === 60 && byId["s-frequent"].bucket === "frequent", "s-frequent cadence 60 / frequent");
ok(byId["s-frequent"].isDue === true, "s-frequent due (no last run)");
ok(byId["s-daily"].cadenceMinutes === 1440 && byId["s-daily"].isDue === false, "s-daily cadence 1440 / not due");
ok(byId["s-paused"].enabled === 0 && byId["s-paused"].isDue === true, "s-paused disabled but logically due");
ok(byId["s-override"].cadenceMinutes === 90, "s-override override NEWS 90 applies");
ok(byId["s-run-fallback"].isDue === false, "s-run-fallback reads MAX(runs.started_at) fallback");
const dueEnabled = listed.filter((s) => s.enabled === 1 && s.isDue).map((s) => s.id);
ok(JSON.stringify(dueEnabled) === JSON.stringify(["s-frequent", "s-override"]), "due-now among enabled = [s-frequent, s-override] (paused excluded)");

console.log(`\nsmoke:schedule: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);