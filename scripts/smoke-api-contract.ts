// ============================================================================
// P13 — API v1 contract acceptance tests.
//
// Locks the public read-only surface to its single source of truth:
//   * the published docs/api/openapi.json matches lib/api/openapi.ts exactly
//     (no drift between the spec and the router);
//   * the OpenAPI paths are exactly lib/api/routes.ts, each with a GET operation;
//   * GET /api discovery lists every route and is read-only;
//   * every documented route is actually implemented by the router (never the
//     generic "No such endpoint" error) and returns the documented envelope;
//   * non-GET verbs are refused (405) and search without `q` is 422.
//
// Run: npm run smoke:api-contract
// ============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { handleApiRequest } from "../lib/api/handler";
import { API_ROUTES, buildDiscoveryDocument, type ApiRoute } from "../lib/api/routes";
import { buildOpenApiDocument } from "../lib/api/openapi";
import { institutionLeadership, listInstitutions } from "../lib/api/repository";

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

interface ErrorBody {
  error?: { code?: string; message?: string };
}
interface CollectionBody {
  data?: unknown;
  pagination?: { total?: number };
  meta?: Record<string, unknown>;
}
interface DiscoveryBody {
  api?: string;
  version?: string;
  read_only?: boolean;
  endpoints?: unknown[];
}

const call = (method: string, url: string): { status: number; body: string } => handleApiRequest({ method, url });
const parse = <T>(raw: string): T => JSON.parse(raw) as T;

// --- 0. A real institution + person to probe with ---------------------------
const listed = listInstitutions({}).body;
const realSlug = listed.data[0]?.slug;
check("have a real institution slug", typeof realSlug === "string" && realSlug.length > 0);

let personSlug: string | undefined;
for (const inst of listed.data) {
  const r = institutionLeadership(inst.slug, {});
  if (r.status === 200 && "data" in r.body && r.body.data.length > 0) {
    personSlug = r.body.data[0].slug;
    break;
  }
}
check("have a real person slug", typeof personSlug === "string" && personSlug.length > 0);

// --- 1. Published OpenAPI matches the builder -------------------------------
const publishedPath = resolve(__dirname, "..", "docs", "api", "openapi.json");
const published = JSON.parse(readFileSync(publishedPath, "utf8")) as Record<string, unknown>;
check(
  "published docs/api/openapi.json matches the builder (run npm run build:openapi)",
  JSON.stringify(published) === JSON.stringify(buildOpenApiDocument()),
);
check("openapi version is 3.1.0", published.openapi === "3.1.0");

// --- 2. OpenAPI paths == the route table ------------------------------------
const specPaths = Object.keys((published.paths as Record<string, unknown>) ?? {});
check("openapi has every route path", API_ROUTES.every((r) => specPaths.includes(r.path)));
check("openapi has no extra route paths", specPaths.length === API_ROUTES.length);

const paths = published.paths as Record<string, Record<string, unknown>>;
for (const route of API_ROUTES) {
  const op = paths[route.path]?.[route.method.toLowerCase()] as
    | { operationId?: string; responses?: Record<string, unknown>; parameters?: { name?: string; in?: string }[] }
    | undefined;
  check(`openapi operation ${route.method} ${route.path}`, !!op && typeof op.operationId === "string");
  check(`openapi 200 documented ${route.path}`, !!op?.responses?.["200"]);
  const paramNames = Array.from(route.path.matchAll(/\{([^}]+)\}/g), (m) => m[1]);
  const declared = new Set((op?.parameters ?? []).filter((p) => p.in === "path").map((p) => p.name));
  check(`openapi declares path params ${route.path}`, paramNames.every((n) => declared.has(n)));
}

// --- 3. Discovery index ------------------------------------------------------
const disco = call("GET", "/api");
const discoBody = parse<DiscoveryBody>(disco.body);
check("GET /api is 200", disco.status === 200);
check("discovery is read_only", discoBody.read_only === true);
check("discovery reports v1", discoBody.version === "v1");
check("discovery lists every route", discoBody.endpoints?.length === API_ROUTES.length);
check("discovery equals the builder", JSON.stringify(discoBody) === JSON.stringify(buildDiscoveryDocument()));

// --- 4. Read-only: non-GET is refused ---------------------------------------
const post = call("POST", "/api/institutions");
check("POST /api/institutions is 405", post.status === 405);
check("405 error code is METHOD_NOT_ALLOWED", parse<ErrorBody>(post.body).error?.code === "METHOD_NOT_ALLOWED");

// --- 5. Every documented route is routed and well-shaped --------------------
const urlFor = (route: ApiRoute): string => {
  let p = route.path;
  if (p.includes("{slug}")) {
    const slug = p.startsWith("/api/people/") ? personSlug : realSlug;
    p = p.replace("{slug}", slug ?? "__probe__");
  }
  if (route.path === "/api/search") p += `?q=${encodeURIComponent(listed.data[0]?.name ?? "a")}`;
  return p;
};

for (const route of API_ROUTES) {
  if (route.kind === "discovery") continue;
  const res = call(route.method, urlFor(route));
  const body = parse<CollectionBody & ErrorBody>(res.body);
  const routed = !(body.error?.code === "NOT_FOUND" && /No such endpoint/.test(body.error.message ?? ""));
  check(`routed: ${route.method} ${route.path}`, routed);

  if (route.kind === "collection") {
    check(
      `collection envelope: ${route.path}`,
      Array.isArray(body.data) && typeof body.pagination?.total === "number" && res.status === 200,
    );
  } else if (res.status === 200) {
    check(`resource envelope: ${route.path}`, body.data !== undefined && body.meta?.verification_status === "UNVERIFIED");
  } else {
    check(`resource 404 is a structured error: ${route.path}`, res.status === 404 && !!body.error?.code);
  }
}

// --- 6. Error contract -------------------------------------------------------
const noQ = call("GET", "/api/search");
check("search without q is 422", noQ.status === 422);
check("422 error code is VALIDATION", parse<ErrorBody>(noQ.body).error?.code === "VALIDATION");

const unknown = call("GET", "/api/nonexistent");
check("unknown endpoint is 404", unknown.status === 404);
check("unknown endpoint uses NOT_FOUND", parse<ErrorBody>(unknown.body).error?.code === "NOT_FOUND");

const unknownSub = call("GET", `/api/institutions/${realSlug}/wat`);
check("unknown sub-resource is 404", unknownSub.status === 404 && /No such endpoint/.test(parse<ErrorBody>(unknownSub.body).error?.message ?? ""));

// --- 7. Positive 200s --------------------------------------------------------
const list = call("GET", "/api/institutions");
check("GET /api/institutions is 200 collection", list.status === 200 && Array.isArray(parse<CollectionBody>(list.body).data));
if (realSlug) {
  const one = call("GET", `/api/institutions/${realSlug}`);
  check("GET /api/institutions/{slug} is 200 resource", one.status === 200 && parse<CollectionBody>(one.body).data !== undefined);
}
if (personSlug) {
  const person = call("GET", `/api/people/${personSlug}`);
  check("GET /api/people/{slug} is 200 resource", person.status === 200 && parse<CollectionBody>(person.body).meta?.verification_status === "UNVERIFIED");
}

console.log(`\nsmoke:api-contract: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
