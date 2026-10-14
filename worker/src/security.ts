// ============================================================================
// Worker security layer â€” headers, CORS, rate limiting, egress validation.
//
// Why this exists: worker/src/index.ts serves a public, cacheable JSON API plus
// a redirect door at /go/. None of that was hardened. This module is the single
// place that owns edge-facing security policy so index.ts stays routing-only.
//
// Threat model covered here
//   1. JSON responses sniffed as HTML            -> nosniff + JSON content-type
//   2. Cross-origin scraping of a public API     -> explicit origin allowlist
//   3. Volumetric abuse of a free public API    -> per-IP token bucket
//   4. /go/ used as an open redirector           -> scheme/host allowlist
//   5. Path traversal via /:slug params          -> segment validation
//
// Not covered here (needs infrastructure, see docs/OPERATIONS.md)
//   - Cross-isolate rate limiting. Cloudflare Workers isolates do not share
//     memory, so the bucket below is per-isolate and best-effort. Exact global
//     limits require a Durable Object or a KV-backed counter.
//   - AuthN/AuthZ. V1 is deliberately read-only and public (docs/API-CONTRACT.md).
// ============================================================================

export interface SecurityEnv {
  /** Comma-separated origin allowlist for CORS. Absent = same-origin only. */
  ALLOWED_ORIGINS?: string;
  /** Token bucket capacity per client per window. Default 120. */
  RATE_LIMIT_MAX?: string;
  /** Token bucket refill window in seconds. Default 60. */
  RATE_LIMIT_WINDOW_SECONDS?: string;
}

/** Headers applied to every Worker response. */
const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
};

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// Hostnames that must never be used as a /go/ redirect destination. A redirect
// to these is either an SSRF pivot or a phishing primitive.
const BLOCKED_REDIRECT_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
  "metadata.google.internal",
]);

// ---------------------------------------------------------------------------
// Response decoration
// ---------------------------------------------------------------------------

/**
 * Copy a response and apply security headers. Preserves status, body and the
 * caller's cache headers; never mutates the original. The request is passed in
 * because CORS decisions depend on the inbound Origin, not on the response.
 */
export function withSecurityHeaders(
  request: Request,
  response: Response,
  env: SecurityEnv,
): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(BASE_HEADERS)) headers.set(key, value);

  const cors = corsHeaders(request.headers.get("Origin"), env);
  if (cors) {
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    // A response that varies on Origin must not be cached across origins.
    headers.append("Vary", "Origin");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * CORS is allowlist-only. There is deliberately no "*" fallback: the API is
 * public, but a permissive wildcard makes any site able to read a user-IP-keyed
 * response and removes the audit trail of who called it.
 */
export function corsHeaders(origin: string | null, env: SecurityEnv): Record<string, string> | null {
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/** Prune expired buckets so the Map cannot grow without bound. */
let lastPruneAt = 0;

/**
 * Per-IP token bucket. Returns true when the request may proceed.
 * A bucket refills continuously rather than resetting on a fixed boundary.
 */
export function rateLimit(request: Request, env: SecurityEnv): boolean {
  const max = clampNumber(env.RATE_LIMIT_MAX, 120, 1, 10_000);
  const windowSec = clampNumber(env.RATE_LIMIT_WINDOW_SECONDS, 60, 1, 3600);
  const now = Date.now();
  const id = clientId(request);

  if (now - lastPruneAt > windowSec * 1000) {
    lastPruneAt = now;
    for (const [key, bucket] of buckets) {
      if (now - bucket.updatedAt > windowSec * 1000 * 2) buckets.delete(key);
    }
  }

  let bucket = buckets.get(id);
  if (!bucket) {
    bucket = { tokens: max, updatedAt: now };
    buckets.set(id, bucket);
  }

  const refillPerMs = max / (windowSec * 1000);
  bucket.tokens = Math.min(max, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function clientId(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function clampNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// ---------------------------------------------------------------------------
// Egress validation
// ---------------------------------------------------------------------------

/**
 * Validate a /go/ redirect destination before we hand the user to it.
 *
 * outbound_links.target_url is publisher-supplied data, so it is untrusted input
 * even though we wrote it. A `javascript:` or `data:` target here would turn our
 * domain into an XSS launcher; an internal host would turn it into an SSRF and
 * phishing pivot. Returns the URL when safe, otherwise null.
 */
export function safeRedirectTarget(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  if (!host) return null;
  if (BLOCKED_REDIRECT_HOSTS.has(host)) return null;
  // Refuse anything that is not a real public DNS name.
  if (host.endsWith(".local") || host.endsWith(".internal")) return null;

  return url;
}

/**
 * Validate a single path segment taken from a URL. Rejects traversal, encoded
 * separators and control characters before it reaches a query builder.
 */
export function safeSegment(raw: string): string | null {
  if (!raw || raw.length > 200) return null;
  if (raw.includes("..")) return null;
  if (/[/\\?#%]/.test(raw)) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}
