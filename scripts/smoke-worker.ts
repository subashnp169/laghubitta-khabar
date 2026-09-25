// scripts/smoke-worker.ts — exercises the API Worker's fetch handler end-to-end
// against a local better-sqlite3 shim of the D1Database interface (same shape
// as lib/repository/local.ts). Requires scripts/seed.cjs to have created lk.db.
//
// Run: npx tsx scripts/smoke-worker.ts
//
// DISCIPLINE (docs/OPERATIONS.md): test tooling. Never against staging/prod.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

import { guardOrExit } from "./guard-env.cjs";
import worker, { type Env } from "../worker/src/index";
import type { D1Database, D1ResultRow, D1Statement } from "../lib/repository/d1";

guardOrExit("scripts/smoke-worker.ts");

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
};

function sqliteD1(dbPath: string): D1Database {
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3");
  const conn = new Database(dbPath, { readonly: true });
  return {
    prepare(sql: string) {
      const mk = (boundArgs: unknown[]): D1Statement => {
        const stmt = conn.prepare(sql);
        return {
          bind(...params: unknown[]) { return mk([...boundArgs, ...params]); },
          first: () => Promise.resolve((stmt.get(...boundArgs) ?? null) as D1ResultRow | null),
          all: () => Promise.resolve({ results: stmt.all(...boundArgs) as D1ResultRow[], success: true }),
        };
      };
      return mk([]);
    },
  };
}

async function main() {
  if (!existsSync("lk.db")) throw new Error("lk.db missing — run: node scripts/seed.cjs");
  const env: Env = { DB: sqliteD1("lk.db") };
  const call = (path: string) => worker.fetch(new Request(`https://laghubitta.example${path}`), env);

  // ---- institutions list ----
  const list = await call("/api/institutions?page=1&limit=5");
  const listBody = await list.json();
  assert(list.status === 200, "GET /api/institutions → 200");
  assert(listBody.data.length === 5 && listBody.pagination.total === 51, "list pagination (5/51)");
  assert(listBody.data[0].slug && !("timeline" in listBody.data[0]), "list items are summaries (no detail payload)");

  // ---- detail ----
  const detail = await call("/api/institutions/matribhumi-laghubitta-bittiya-sanstha-ltd");
  const detailBody = await detail.json();
  assert(detail.status === 200, "GET /api/institutions/:slug → 200");
  assert(detailBody.data.id === "mfi-047", "detail resolves matribhumi → mfi-047");
  assert(Array.isArray(detailBody.data.timeline) && detailBody.data.timeline.length >= 1, "detail has timeline");
  assert(!!detail.headers.get("cache-control")?.includes("s-maxage=300"), "detail cache-control set");
  const detail404 = await call("/api/institutions/no-such-mfb");
  const nf = await detail404.json();
  assert(detail404.status === 404 && nf.error.code === "NOT_FOUND", "unknown slug → 404 NOT_FOUND");

  // ---- sub-resources ----
  const events = await call("/api/institutions/matribhumi-laghubitta-bittiya-sanstha-ltd/events");
  const eventsBody = await events.json();
  assert(events.status === 200 && eventsBody.data.length === 8, "events sub-resource (8 timeline)");
  const leadership = await call("/api/institutions/matribhumi-laghubitta-bittiya-sanstha-ltd/leadership");
  assert(leadership.status === 200, "leadership sub-resource → 200 (empty until Phase B)");
  const badSub = await call("/api/institutions/matribhumi-laghubitta-bittiya-sanstha-ltd/nonsense");
  assert(badSub.status === 404, "unknown sub-resource → 404");

  // ---- news / search / people / interest-rates ----
  const news = await call("/api/news?tier=KHABAR");
  assert(news.status === 200, "GET /api/news?tier=KHABAR → 200");
  const newsBad = await call("/api/news?tier=BOGUS");
  assert(newsBad.status === 422, "bad tier → 422");

  const search = await call("/api/search?q=deprosc");
  const searchBody = await search.json();
  assert(search.status === 200 && searchBody.data.groups.institutions.length >= 1, "search finds Deprosc");
  assert((await call("/api/search")).status === 422, "missing q → 422");

  const person = await call("/api/people/anyone");
  assert(person.status === 404, "people/:slug → 404 (Phase B)");

  const rates = await call("/api/interest-rates");
  assert(rates.status === 200, "GET /api/interest-rates → 200");

  // ---- /go/ outbound redirect ----
  const go = await call("/go/mfi-047/website");
  assert(go.status === 302 && !!go.headers.get("location")?.startsWith("http"), "/go/mfi-047/website → 302");
  const goMissing = await call("/go/mfi-047/social");
  assert(goMissing.status === 404, "/go/mfi-047/social → 404");

  const methodBlocked = await worker.fetch(
    new Request("https://laghubitta.example/api/institutions", { method: "POST" }),
    env,
  );
  assert(methodBlocked.status === 405, "POST → 405 (read-only)");

  const noRoute = await call("/api/nope");
  assert(noRoute.status === 404, "unknown api route → 404");

  console.log(process.exitCode ? "\nSMOKE: FAILURES" : "\nSMOKE: all checks passed");
}

main();