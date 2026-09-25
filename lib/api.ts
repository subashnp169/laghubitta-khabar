// ============================================================================
// Shared API helpers — frozen response envelopes (docs/API-CONTRACT.md).
// Single-resource, collection, and error shapes. Framework-agnostic: uses the
// platform `Response` so the same module serves Next route handlers AND the
// Cloudflare Worker (worker/src uses it unchanged).
// ============================================================================

import { NotFoundError, ValidationError } from "./repository/contract";
import type { Pagination, SourceMeta } from "./repository/types";

export function single<T>(data: T, meta: SourceMeta, init?: ResponseInit) {
  return Response.json({ data, meta }, init);
}

export function collection<T>(
  data: T[],
  pagination: Pagination,
  meta?: Record<string, unknown>,
  init?: ResponseInit,
) {
  return Response.json(
    { data, pagination, ...(meta ? { meta } : {}) },
    init,
  );
}

export function apiError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function handleError(e: unknown): Promise<Response> {
  if (e instanceof NotFoundError) return apiError("NOT_FOUND", e.message, 404);
  if (e instanceof ValidationError) return apiError("VALIDATION", e.message, 422);
  console.error("API error:", e);
  return apiError("INTERNAL", "Something went wrong.", 500);
}

export function parsePage(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
  return { page, limit };
}