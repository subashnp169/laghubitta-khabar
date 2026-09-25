// ============================================================================
// Local adapter — pure Node better-sqlite3 over the seeded portable SQLite
// file (lk.db, created by scripts/seed.cjs). Use for local dev, tests, and
// CI where no Cloudflare D1 binding exists. Same contract as D1 adapter.
//
// NOTE: better-sqlite3 is a dev tool, not a runtime dep — it's loaded lazily
// so route handlers never pull it into a Worker bundle. The adapter exposes
// the same structural D1Database shape, so mapInstitutionRow/SQL live once in
// d1.ts and are shared.
// ============================================================================

import { createRequire } from "node:module";
import { existsSync } from "node:fs";

import type { InstitutionRepository } from "./contract";
import { D1InstitutionRepository, type D1Database, type D1ResultRow, type D1Statement } from "./d1";

export function localRepository(dbPath?: string): InstitutionRepository {
  const path = dbPath || process.env.LK_DB_PATH || "lk.db";
  if (!existsSync(path)) {
    throw new Error(
      `Local DB not found at ${path}. Run "node scripts/seed.cjs" first (creates lk.db).`,
    );
  }
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3");
  const conn = new Database(path, { readonly: true });

  const db: D1Database = {
    prepare(sql: string) {
      const mk = (boundArgs: unknown[]): D1Statement => {
        const stmt = conn.prepare(sql);
        return {
          bind(...params: unknown[]) {
            return mk([...boundArgs, ...params]);
          },
          first: () => Promise.resolve((stmt.get(...boundArgs) ?? null) as D1ResultRow | null),
          all: () =>
            Promise.resolve({
              results: stmt.all(...boundArgs) as D1ResultRow[],
              success: true,
            }),
        };
      };
      return mk([]);
    },
  };
  return new D1InstitutionRepository(db);
}