// ============================================================================
// Phase 3 (M3.1) — API contract primitives: envelope shapes, pagination rules,
// metadata. Pure module; no I/O, no randomness, no AI. Matches
// docs/API-CONTRACT.md exactly.
// ============================================================================

export interface ApiMeta {
  source: string;
  // Every source that currently owns an observation backing the response
  // payload, sorted. Two or more entries means the payload is corroborated by
  // that many independent sources. Derived from source-owned observations, so
  // it is a relationship between rows rather than a count of merged claims.
    sources: string[];
    // Raw, followable URL of the primary source backing this response, so a
    // consumer can open the evidence instead of trusting a bare identifier.
    // Null when no source URL is known — never a guessed or synthesised link.
    source_url: string | null;
    last_verified_at: string | null;
    verification_status: string;
}

export interface CollectionEnvelope<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
  meta?: ApiMeta;
}

export interface ResourceEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

function toPositiveInt(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.trunc(n) !== n) return fallback;
  return Math.min(Math.max(n, 1), max);
}

/** Clamp page/limit into the contract's safe range; never throws. */
export function parsePagination(search: URLSearchParams): Pagination {
  const limit = toPositiveInt(search.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  const page = toPositiveInt(search.get("page"), DEFAULT_PAGE, Math.floor(Number.MAX_SAFE_INTEGER / Math.max(limit, 1)));
  return { page, limit, offset: (page - 1) * limit };
}

export function slicePage<T>(items: T[], pagination: Pagination): CollectionEnvelope<T> {
  return {
    data: items.slice(pagination.offset, pagination.offset + pagination.limit),
    pagination: { page: pagination.page, limit: pagination.limit, total: items.length },
  };
}

export function emptyCollection(page: number, limit: number): CollectionEnvelope<never> {
  return { data: [], pagination: { page, limit, total: 0 } };
}

export function errorEnvelope(code: string, message: string): { status: number; body: ErrorEnvelope } {
  const status = code === "NOT_FOUND" ? 404 : code === "VALIDATION" ? 422 : code === "METHOD_NOT_ALLOWED" ? 405 : 500;
  return { status, body: { error: { code, message } } };
}