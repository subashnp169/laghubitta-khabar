// ============================================================================
// Phase 3 (P13) — API server policy: the pure, testable half of the standalone
// B2B server (scripts/api-server.ts). CORS resolution, a fixed-window rate
// limiter, and the liveness payload. No sockets, no clock reads, no randomness:
// every function takes its inputs (including `now`) as arguments, so the server
// shell stays a thin wire and this behaviour can be unit-tested without binding
// a port. Matches the read-only contract in docs/API-CONTRACT.md.
// ============================================================================
import { API_ROUTES, API_VERSION } from "./routes";

/** A wildcard entry: allow any origin (the local/dev default). */
export const WILDCARD_ORIGIN = "*";

/**
 * Parse the `LK_API_ALLOWED_ORIGINS` env value into an allowlist. An unset or
 * blank value means the wildcard (local dev); a set value is an explicit
 * allowlist, so a misconfigured deploy exposes nothing rather than everything.
 */
export function parseOriginAllowlist(raw: string | undefined | null): string[] {
  const entries = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return entries.length === 0 ? [WILDCARD_ORIGIN] : entries;
}

/**
 * The `Access-Control-Allow-Origin` value to echo for a request, or null when the
 * origin is not allowed (in which case no CORS header is sent, so the browser
 * blocks the read). A request with no Origin (a server-to-server call) is always
 * allowed with the wildcard, since CORS does not apply to it.
 */
export function resolveCorsOrigin(requestOrigin: string | undefined | null, allowlist: string[]): string | null {
  if (!requestOrigin) return WILDCARD_ORIGIN;
  if (allowlist.includes(WILDCARD_ORIGIN)) return WILDCARD_ORIGIN;
  return allowlist.includes(requestOrigin) ? requestOrigin : null;
}

export interface RateDecision {
  allowed: boolean;
  /** Seconds until the window resets, for the Retry-After header. 0 when allowed. */
  retryAfterSeconds: number;
  /** Requests left in the current window. -1 means the limiter is disabled. */
  remaining: number;
}

/**
 * A fixed-window rate limiter keyed by caller. It is intentionally simple and
 * in-process: this server is a single Node process and the point is to stop one
 * client from monopolising it, not to be a distributed quota service. A limit of
 * 0 disables it (used when no limit is configured).
 */
export class FixedWindowRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(limitPerWindow: number, windowMs = 60_000) {
    this.limit = Math.max(0, Math.trunc(limitPerWindow));
    this.windowMs = windowMs;
  }

  check(key: string, now: number): RateDecision {
    if (this.limit === 0) return { allowed: true, retryAfterSeconds: 0, remaining: -1 };

    const current = this.hits.get(key);
    if (!current || now >= current.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return { allowed: true, retryAfterSeconds: 0, remaining: this.limit - 1 };
    }
    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        remaining: 0,
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0, remaining: this.limit - current.count };
  }

  /** Drop windows that have already reset so the map cannot grow unbounded. */
  private prune(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) {
      if (now >= v.resetAt) this.hits.delete(k);
    }
  }
}

export interface HealthPayload {
  status: "ok";
  read_only: true;
  api_version: string;
  endpoints: number;
}

/**
 * The liveness payload for `GET /health`. It restates only what the process can
 * assert about itself and deliberately carries no timestamp and no counts from
 * the data plane, so it stays deterministic and cannot be mistaken for a
 * freshness or coverage claim about the records.
 */
export function healthPayload(): HealthPayload {
  return { status: "ok", read_only: true, api_version: API_VERSION, endpoints: API_ROUTES.length };
}

/**
 * The headers sent on every API response. `Cache-Control: no-store` is
 * deliberate: the payload is a build-time projection whose vintage is carried in
 * `meta`, and a shared cache would serve it past the point a consumer could tell.
 */
export function baseResponseHeaders(corsOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (corsOrigin) headers["Access-Control-Allow-Origin"] = corsOrigin;
  return headers;
}
