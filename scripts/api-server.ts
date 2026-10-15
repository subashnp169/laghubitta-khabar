// ============================================================================
// Phase 3 (M3.1, hardened in P13) — standalone B2B API server. node:http only
// (no new deps). Read-only: serves the frozen API contract from the pure
// handler/repository over the generated modules.
//
// Hardening (P13):
//   * CORS is an allowlist from LK_API_ALLOWED_ORIGINS (comma separated); unset
//     means the dev wildcard. A non-matching origin gets no CORS header, so the
//     browser blocks it, rather than a blanket "*".
//   * OPTIONS preflight is answered (204) with GET/HEAD only.
//   * An in-process fixed-window rate limit (LK_API_RATE_LIMIT per minute, 0 or
//     unset = unlimited) returns a structured 429 instead of failing open.
//   * GET /health is a liveness probe for the process, separate from the data
//     API and carrying no data-plane claim.
//   * The bind host is HOST or 127.0.0.1; binding a public interface is opt-in.
//
//   npm run api                → http://127.0.0.1:8787
//   PORT=9900 npm run api      → http://127.0.0.1:9900
//   HOST=0.0.0.0 npm run api   → bind all interfaces (opt-in)
// ============================================================================

import { createServer } from "node:http";
import { handleApiRequest } from "../lib/api/handler";
import { errorEnvelope } from "../lib/api/contract";
import {
  FixedWindowRateLimiter,
  baseResponseHeaders,
  healthPayload,
  parseOriginAllowlist,
  resolveCorsOrigin,
} from "../lib/api/server-policy";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const ALLOWED_ORIGINS = parseOriginAllowlist(process.env.LK_API_ALLOWED_ORIGINS);
const RATE_LIMIT = Number(process.env.LK_API_RATE_LIMIT ?? 0);
const limiter = new FixedWindowRateLimiter(Number.isFinite(RATE_LIMIT) ? RATE_LIMIT : 0);

function callerKey(remoteAddress: string | undefined): string {
  return remoteAddress ?? "unknown";
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  const method = (req.method ?? "GET").toUpperCase();
  const corsOrigin = resolveCorsOrigin(req.headers.origin, ALLOWED_ORIGINS);

  if (method === "OPTIONS") {
    res.writeHead(204, {
      ...baseResponseHeaders(corsOrigin),
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return;
  }

  const decision = limiter.check(callerKey(req.socket.remoteAddress), Date.now());
  if (!decision.allowed) {
    const { status, body } = errorEnvelope("RATE_LIMITED", "Too many requests; slow down.");
    res.writeHead(status, {
      ...baseResponseHeaders(corsOrigin),
      "Retry-After": String(decision.retryAfterSeconds),
    });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
    console.log(`${new Date().toISOString()} ${method} ${url} → ${status} (rate limited)`);
    return;
  }

  // Liveness probe: about the process, not the data. Never rate-limit-gated away
  // from operators, but it is inside the same shell so proxies see one origin.
  if (url.split("?")[0].replace(/\/+$/, "") === "/health") {
    res.writeHead(200, baseResponseHeaders(corsOrigin));
    res.end(method === "HEAD" ? undefined : JSON.stringify(healthPayload()));
    return;
  }

  const out = handleApiRequest({ method: req.method ?? "GET", url });
  res.writeHead(out.status, baseResponseHeaders(corsOrigin));
  res.end(req.method === "HEAD" ? undefined : out.body);
  const logUrl = url.length > 80 ? `${url.slice(0, 80)}…` : url;
  console.log(`${new Date().toISOString()} ${req.method} ${logUrl} → ${out.status}`);
});

server.listen(PORT, HOST, () => {
  console.log(`laghubitta-khabar B2B API listening on http://${HOST}:${PORT} (read-only, deterministic)`);
  console.log(
    `cors allowlist: ${ALLOWED_ORIGINS.join(", ")}; rate limit: ${RATE_LIMIT === 0 ? "disabled" : `${RATE_LIMIT}/min`}`,
  );
  console.log("endpoints: /health, /api (discovery), /api/institutions, /api/institutions/:slug{/documents,/events,/jobs,/branches,/leadership,/financials}, /api/interest-rates, /api/search?q=");
});

function shutdown(signal: string): void {
  console.log(`${signal} received; draining connections…`);
  server.close(() => {
    console.log("closed.");
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
