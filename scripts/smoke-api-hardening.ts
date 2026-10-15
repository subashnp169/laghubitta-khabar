// ============================================================================
// P13 — API server hardening policy (pure, no sockets).
//
// Locks the behaviour the standalone server relies on so it cannot silently
// regress to a blanket wildcard CORS or an unbounded/failing-open limiter:
//   * an unset origin allowlist is the dev wildcard; a set one is a strict list
//     (a misconfigured deploy exposes nothing rather than everything);
//   * a request with no Origin is always allowed (CORS does not apply);
//   * the rate limiter allows `limit` requests per window, then refuses with a
//     retry hint, and resets after the window; a limit of 0 disables it;
//   * the liveness payload is deterministic and makes no data-plane claim.
//
// Run: npm run smoke:api-hardening
// ============================================================================
import { errorEnvelope } from "../lib/api/contract";
import {
  FixedWindowRateLimiter,
  WILDCARD_ORIGIN,
  baseResponseHeaders,
  healthPayload,
  parseOriginAllowlist,
  resolveCorsOrigin,
} from "../lib/api/server-policy";

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

// --- Origin allowlist --------------------------------------------------------
check("unset allowlist is the dev wildcard", parseOriginAllowlist(undefined).join() === WILDCARD_ORIGIN);
check("blank allowlist is the dev wildcard", parseOriginAllowlist("  ,  ").join() === WILDCARD_ORIGIN);
check("a set allowlist is a strict list", parseOriginAllowlist("https://a.test, https://b.test").join() === "https://a.test,https://b.test");

check("no Origin is allowed (server-to-server)", resolveCorsOrigin(undefined, ["https://a.test"]) === WILDCARD_ORIGIN);
check("an allowlisted Origin is echoed", resolveCorsOrigin("https://a.test", ["https://a.test"]) === "https://a.test");
check("a non-listed Origin is refused (null)", resolveCorsOrigin("https://evil.test", ["https://a.test"]) === null);
check("wildcard allowlist echoes wildcard", resolveCorsOrigin("https://anything.test", [WILDCARD_ORIGIN]) === WILDCARD_ORIGIN);

// --- Response headers --------------------------------------------------------
const wildcardHeaders = baseResponseHeaders(WILDCARD_ORIGIN);
check("base headers carry no-store", wildcardHeaders["Cache-Control"] === "no-store");
check("base headers vary on Origin", wildcardHeaders.Vary === "Origin");
check("no CORS header when origin refused", !("Access-Control-Allow-Origin" in baseResponseHeaders(null)));
check("CORS header present when allowed", wildcardHeaders["Access-Control-Allow-Origin"] === WILDCARD_ORIGIN);

// --- Rate limiter ------------------------------------------------------------
const limiter = new FixedWindowRateLimiter(3, 60_000);
const t0 = 1_000_000;
const a1 = limiter.check("ip-1", t0);
limiter.check("ip-1", t0 + 1);
const a3 = limiter.check("ip-1", t0 + 2);
const a4 = limiter.check("ip-1", t0 + 3);
check("first request in a window is allowed", a1.allowed && a1.remaining === 2);
check("third request in a window is allowed", a3.allowed && a3.remaining === 0);
check("over-limit request is refused", !a4.allowed && a4.remaining === 0);
check("refusal carries a positive retry hint", a4.retryAfterSeconds > 0);
check("a different key has its own window", limiter.check("ip-2", t0 + 3).allowed);
check("the window resets after it elapses", limiter.check("ip-1", t0 + 60_000).allowed);

const disabled = new FixedWindowRateLimiter(0, 60_000);
let allAllowed = true;
for (let i = 0; i < 50; i += 1) allAllowed = allAllowed && disabled.check("ip", t0 + i).allowed;
check("a limit of 0 disables the limiter", allAllowed);

// --- 429 envelope ------------------------------------------------------------
const rate = errorEnvelope("RATE_LIMITED", "slow down");
check("RATE_LIMITED maps to HTTP 429", rate.status === 429 && rate.body.error.code === "RATE_LIMITED");

// --- Health payload ----------------------------------------------------------
const health = healthPayload();
check("health reports ok and read-only", health.status === "ok" && health.read_only === true);
check("health is deterministic (no timestamp field)", !Object.keys(health).some((k) => /time|date|now/i.test(k)));
check("health names the api version", typeof health.api_version === "string" && health.api_version.length > 0);

console.log(`\nsmoke:api-hardening: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
