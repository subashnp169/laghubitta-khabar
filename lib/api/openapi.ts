// ============================================================================
// Phase 3 (P13) — OpenAPI 3.1 document generated FROM lib/api/routes.ts (the
// single source of truth). `npm run build:openapi` writes docs/api/openapi.json
// and scripts/smoke-api-contract.ts fails if the published file drifts from this
// builder. Pure module; no I/O, no randomness, no AI, no new dependencies.
// ============================================================================

import { API_ROUTES, API_VERSION, type ApiRoute } from "./routes";

const JSON_TYPE = "application/json";
const ERROR_REF = "#/components/schemas/Error";

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
}

const TAG_DESCRIPTIONS: Record<string, string> = {
  Meta: "Discovery and contract metadata.",
  Institutions: "Canonical institution records and their sub-resources.",
  People: "Tier-1/2 board and senior management profiles.",
  News: "News records typed by source tier.",
  Search: "Cross-entity free-text search.",
  "Interest rates": "Canonical interest-rate notices (values never extracted).",
};

function pathParamNames(path: string): string[] {
  return Array.from(path.matchAll(/\{([^}]+)\}/g), (m) => m[1]);
}

function operationId(route: ApiRoute): string {
  const tail = route.path.replace(/^\//, "").replace(/[{}]/g, "");
  return `${route.method.toLowerCase()}_${tail.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function responseRef(route: ApiRoute): string {
  const schema =
    route.kind === "collection"
      ? "CollectionEnvelope"
      : route.kind === "discovery"
        ? "Discovery"
        : "ResourceEnvelope";
  return `#/components/schemas/${schema}`;
}

function pathItem(route: ApiRoute): Record<string, unknown> {
  const names = pathParamNames(route.path);
  const parameters: unknown[] = names.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  for (const q of route.query ?? []) {
    parameters.push({
      name: q.name,
      in: "query",
      required: q.required ?? false,
      description: q.description,
      schema: { type: "string" },
    });
  }

  const responses: Record<string, unknown> = {
    "200": {
      description: route.summary,
      content: { [JSON_TYPE]: { schema: { $ref: responseRef(route) } } },
    },
    "405": { description: "Read-only API: only GET/HEAD are supported.", content: { [JSON_TYPE]: { schema: { $ref: ERROR_REF } } } },
    "500": { description: "Internal error.", content: { [JSON_TYPE]: { schema: { $ref: ERROR_REF } } } },
  };
  if (names.length > 0) {
    responses["404"] = { description: "Requested resource does not exist.", content: { [JSON_TYPE]: { schema: { $ref: ERROR_REF } } } };
  }
  if ((route.query ?? []).some((q) => q.required)) {
    responses["422"] = { description: "Validation error, e.g. a required query parameter is missing.", content: { [JSON_TYPE]: { schema: { $ref: ERROR_REF } } } };
  }

  return {
    summary: route.summary,
    operationId: operationId(route),
    tags: route.tags,
    parameters,
    responses,
  };
}

export function buildOpenApiDocument(): OpenApiDocument {
  const tags = Array.from(
    new Set(API_ROUTES.flatMap((r) => r.tags)),
  ).map((name) => ({ name, description: TAG_DESCRIPTIONS[name] ?? name }));

  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of API_ROUTES) {
    paths[route.path] = { ...(paths[route.path] ?? {}), [route.method.toLowerCase()]: pathItem(route) };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Laghubitta Khabar B2B API",
      version: "1.0.0",
      description:
        `Read-only ${API_VERSION} contract (docs/API-CONTRACT.md). Every payload carries provenance; ` +
        "missing values are absent or provable zeros, never fabricated. No POST/PUT/DELETE.",
    },
    servers: [{ url: "http://127.0.0.1:8787", description: "Local development (scripts/api-server.ts)" }],
    tags,
    paths,
    components: {
      schemas: {
        ApiMeta: {
          type: "object",
          required: ["source", "sources", "source_url", "last_verified_at", "verification_status"],
          properties: {
            source: { type: "string" },
            sources: { type: "array", items: { type: "string" } },
            source_url: { type: ["string", "null"] },
            last_verified_at: { type: ["string", "null"] },
            verification_status: { type: "string" },
          },
        },
        Pagination: {
          type: "object",
          required: ["page", "limit", "total"],
          properties: {
            page: { type: "integer" },
            limit: { type: "integer" },
            total: { type: "integer" },
          },
        },
        CollectionEnvelope: {
          type: "object",
          required: ["data", "pagination"],
          properties: {
            data: { type: "array", items: { type: "object" } },
            pagination: { $ref: "#/components/schemas/Pagination" },
            meta: { $ref: "#/components/schemas/ApiMeta" },
          },
        },
        ResourceEnvelope: {
          type: "object",
          required: ["data", "meta"],
          properties: {
            data: { type: "object" },
            meta: { $ref: "#/components/schemas/ApiMeta" },
          },
        },
        Discovery: {
          type: "object",
          required: ["api", "version", "read_only", "docs", "endpoints"],
          properties: {
            api: { type: "string" },
            version: { type: "string" },
            read_only: { type: "boolean" },
            docs: {
              type: "object",
              properties: { contract: { type: "string" }, openapi: { type: "string" } },
            },
            endpoints: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  method: { type: "string" },
                  path: { type: "string" },
                  summary: { type: "string" },
                  kind: { type: "string" },
                },
              },
            },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: { code: { type: "string" }, message: { type: "string" } },
            },
          },
        },
      },
    },
  };
}
