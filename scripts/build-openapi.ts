// ============================================================================
// Phase 3 (P13) — write docs/api/openapi.json from lib/api/openapi.ts.
//
// The document is derived from lib/api/routes.ts (the single source of truth),
// so the published file can never disagree with the router: a drift fails
// `smoke:api-contract`. Deterministic — no timestamps, stable key order.
//
//   npm run build:openapi
// ============================================================================

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildOpenApiDocument } from "../lib/api/openapi";

const ROOT = resolve(__dirname, "..");
const DIR = join(ROOT, "docs", "api");
const OUT = join(DIR, "openapi.json");

mkdirSync(DIR, { recursive: true });
writeFileSync(OUT, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`, "utf8");
console.log(`wrote ${OUT.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "")}`);
