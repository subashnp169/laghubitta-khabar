// ============================================================================
// Phase 3 (P13) — API v1 route table: the SINGLE source of truth for the public
// read-only surface. The router (lib/api/handler.ts), the discovery index
// (GET /api), the OpenAPI document (lib/api/openapi.ts -> docs/api/openapi.json)
// and the contract guard (scripts/smoke-api-contract.ts) all read from here, so
// they cannot drift apart. Pure module; no I/O, no randomness, no AI.
// ============================================================================

export interface ApiQueryParam {
  name: string;
  required?: boolean;
  description: string;
}

export type ApiRouteKind = "collection" | "resource" | "discovery";

export interface ApiRoute {
  method: "GET";
  /** OpenAPI-style template; `{slug}` denotes a path parameter. */
  path: string;
  summary: string;
  kind: ApiRouteKind;
  tags: string[];
  query?: ApiQueryParam[];
}

export const API_VERSION = "v1";

export const API_ROUTES: ApiRoute[] = [
  {
    method: "GET",
    path: "/api",
    summary: "Discovery index: API name, version, and every read-only endpoint.",
    kind: "discovery",
    tags: ["Meta"],
  },
  {
    method: "GET",
    path: "/api/institutions",
    summary: "List canonical institutions (directory).",
    kind: "collection",
    tags: ["Institutions"],
    query: [
      { name: "q", description: "Substring match on name, source name, or alias." },
      { name: "province", description: "Substring match on working area + head office." },
      { name: "status", description: "Filter by website status vocabulary." },
      { name: "page", description: "Page number (1-based). Default 1." },
      { name: "limit", description: "Page size. Default 20, max 100." },
    ],
  },
  {
    method: "GET",
    path: "/api/institutions/{slug}",
    summary: "Full institution digital twin: identity, links, timeline, coverage.",
    kind: "resource",
    tags: ["Institutions"],
  },
  {
    method: "GET",
    path: "/api/institutions/{slug}/leadership",
    summary: "Board + senior management (canonical People + Positions layer).",
    kind: "collection",
    tags: ["Institutions"],
  },
  {
    method: "GET",
    path: "/api/institutions/{slug}/branches",
    summary: "Branch directory (canonical branch layer).",
    kind: "collection",
    tags: ["Institutions"],
  },
  {
    method: "GET",
    path: "/api/institutions/{slug}/financials",
    summary: "Published financial documents (report files, bodies unread).",
    kind: "collection",
    tags: ["Institutions"],
  },
  {
    method: "GET",
    path: "/api/institutions/{slug}/interest-rates",
    summary: "Interest-rate notices linked on the institution's own site (rate_pct always null).",
    kind: "collection",
    tags: ["Institutions"],
  },
  {
    method: "GET",
    path: "/api/institutions/{slug}/documents",
    summary: "NRB-matched documents for the institution (frozen V1 meaning).",
    kind: "collection",
    tags: ["Institutions"],
  },
  {
    method: "GET",
    path: "/api/institutions/{slug}/events",
    summary: "NRB regulatory events filtered by institution.",
    kind: "collection",
    tags: ["Institutions"],
  },
  {
    method: "GET",
    path: "/api/institutions/{slug}/jobs",
    summary: "Evidence-derived vacancies (publisher -> registry attribution).",
    kind: "collection",
    tags: ["Institutions"],
  },
  {
    method: "GET",
    path: "/api/institutions/{slug}/graph",
    summary: "Operational graph: node + edges + merged timeline + evidence trail.",
    kind: "resource",
    tags: ["Institutions"],
  },
  {
    method: "GET",
    path: "/api/people/{slug}",
    summary: "Person profile (Tier-1/2 board + senior management).",
    kind: "resource",
    tags: ["People"],
  },
  {
    method: "GET",
    path: "/api/news",
    summary: "News list typed by source tier (OFFICIAL / NRB / KHABAR / MEDIA).",
    kind: "collection",
    tags: ["News"],
    query: [
      { name: "tier", description: "Filter by news tier." },
      { name: "scope", description: "Filter by source scope." },
      { name: "page", description: "Page number (1-based). Default 1." },
      { name: "limit", description: "Page size. Default 20, max 100." },
    ],
  },
  {
    method: "GET",
    path: "/api/search",
    summary: "Free-text search: grouped institutions / people / documents.",
    kind: "resource",
    tags: ["Search"],
    query: [{ name: "q", required: true, description: "Search query. Required and non-empty (422 otherwise)." }],
  },
  {
    method: "GET",
    path: "/api/interest-rates",
    summary: "Every published interest-rate notice across all institutions.",
    kind: "collection",
    tags: ["Interest rates"],
    query: [
      { name: "page", description: "Page number (1-based). Default 1." },
      { name: "limit", description: "Page size. Default 20, max 100." },
    ],
  },
];

export interface DiscoveryDocument {
  api: string;
  version: string;
  read_only: true;
  docs: { contract: string; openapi: string };
  endpoints: { method: string; path: string; summary: string; kind: ApiRouteKind }[];
}

/** The GET /api discovery payload, derived from the same route table. */
export function buildDiscoveryDocument(): DiscoveryDocument {
  return {
    api: "laghubitta-khabar",
    version: API_VERSION,
    read_only: true,
    docs: { contract: "docs/API-CONTRACT.md", openapi: "docs/api/openapi.json" },
    endpoints: API_ROUTES.map((r) => ({ method: r.method, path: r.path, summary: r.summary, kind: r.kind })),
  };
}
