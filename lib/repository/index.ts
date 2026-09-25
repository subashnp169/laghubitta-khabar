// ============================================================================
// Repository factory — the single entry point for getting the repository.
//
//   LK_DB=  (unset)   → mock   (in-memory master snapshot; dev/build/SSG)
//   LK_DB=mock        → same as above
//   LK_DB=local       → better-sqlite3 over lk.db (run scripts/seed.cjs first)
//   LK_DB=d1          → Cloudflare D1 binding (pass binding via withD1())
//
// Components + route handlers call getRepository() and are responsible only
// for the contract interface — they never know which adapter answered.
//
// `local` is lazy-imported so better-sqlite3 (a dev-only tool) never enters
// a Worker bundle; `mock` and `d1` are pure and statically importable.
// ============================================================================

import type { InstitutionRepository } from "./contract";
import type { D1Database } from "./d1";
import { D1InstitutionRepository } from "./d1";
import { MockInstitutionRepository } from "./mock";

let singleton: InstitutionRepository | null = null;
let singletonKind: string | null = null;

export type RepositoryKind = "mock" | "local" | "d1";

export function resolveKind(): RepositoryKind {
  const k = (process.env.LK_DB || "mock").toLowerCase();
  if (k === "local") return "local";
  if (k === "d1") return "d1";
  return "mock";
}

/** Inject the Cloudflare D1 binding (route handlers in a Worker runtime). */
export function withD1(binding: D1Database): void {
  singleton = new D1InstitutionRepository(binding);
  singletonKind = "d1";
}

export function getRepository(): InstitutionRepository {
  const kind = resolveKind();
  // Explicit injection (withD1/initLocal) always wins over the env default —
  // the caller has already decided which adapter answers this process.
  if (singleton) return singleton;
  if (kind === "d1") {
    throw new Error(
      "LK_DB=d1 requires a D1 binding via withD1(binding) before getRepository().",
    );
  }
  if (kind === "local") {
    throw new Error(
      "LK_DB=local is initialized synchronously via initLocal() — call it at module load.",
    );
  }
  singleton = new MockInstitutionRepository();
  singletonKind = "mock";
  return singleton;
}

/**
 * Swap in the local SQLite adapter (dev/tests/CI). Call once at startup when
 * LK_DB=local. Uses dynamic import so better-sqlite3 stays out of bundles.
 */
export async function initLocal(dbPath?: string): Promise<InstitutionRepository> {
  const { localRepository } = await import("./local");
  const repo = localRepository(dbPath);
  singleton = repo;
  singletonKind = "local";
  return repo;
}