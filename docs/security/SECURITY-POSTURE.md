# SECURITY-POSTURE

**Status:** current as of the P0.1 architecture freeze.

One page: what is protected, how, and what is honestly not yet solved.

---

## 1. Where security lives

| Layer | Mechanism | Status |
|---|---|---|
| Static site | `public/_headers` (Cloudflare Pages) | Active |
| API | `worker/src/security.ts` | Active + tested |
| Data | Repository-only SQL, bound parameters | Active |
| Ingestion | Host allowlist, byte caps, timeouts, redirect limits | Active |
| Engineering rules | `scripts/check-discipline.cjs` R1–R6 | Active in CI |
| Environment guard | `scripts/guard-env.cjs` R1/R4 | Active at runtime |

---

## 2. Static site headers

`public/_headers`, applied by Cloudflare Pages:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;
  font-src 'self' data:; connect-src 'self'; media-src 'self' https:;
  object-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(),
  magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-DNS-Prefetch-Control: off
```

### Why not `src/middleware.ts`

`next.config.ts` sets `output: "export"`. Next.js middleware **does not execute**
under a static export — it would ship as dead code. `public/_headers` is the
platform equivalent, applied at the edge.

### Why `'unsafe-inline'`

The App Router emits inline bootstrap scripts (`self.__next_f.push`) that cannot be
nonced in a static export. `style-src` needs it for React inline style
attributes. Removing it requires a nonce-capable runtime, i.e. giving up static
export. This is a deliberate trade, not an oversight. Revisit only if SEO cost of
SSR is judged acceptable.

---

## 3. API Worker policy

`worker/src/security.ts`. `worker/src/index.ts` is routing only.

| Control | Default | Notes |
|---|---|---|
| `X-Content-Type-Options: nosniff` | always | JSON never interpreted as HTML |
| `X-Frame-Options: DENY` | always | clickjacking |
| `Referrer-Policy` | always | |
| `Permissions-Policy` | always | camera/mic/geo off |
| CORS allowlist | `ALLOWED_ORIGINS`, empty = same-origin | **no `*` fallback by design** |
| `Vary: Origin` | when CORS granted | prevents cross-origin cache leak |
| Rate limit | 120 tokens / 60 s per IP | `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` |
| Preflight | `OPTIONS` → 204, exempt from limiter | browsers can read policy without spending a token |
| Method | GET only, else 405 | read-only V1 |
| Error messages | generic on 500 | no stack traces leak schema |
| `/go/` egress | `safeRedirectTarget()` | see §4 |
| Path params | `safeSegment()` | see §5 |

Rate-limited responses carry `Retry-After: 60` and still receive all security
headers.

---

## 4. External URL handling

Any externally sourced URL is untrusted input. It is captured by ingestion, so it
must be validated on the way out.

`/go/` redirects — blocked by `safeRedirectTarget()`:

```
javascript:    data:      file:      vbscript:
relative paths (no host)          unparseable strings
localhost, 127.0.0.1, ::1, 0.0.0.0
*.local, *.internal, metadata.google.internal
embedded credentials (user:pass@)
```

Why this matters: `outbound_links.target_url` is publisher-supplied. Without
validation, a single bad row makes our domain an XSS launcher
(`javascript:`) or an SSRF/phishing pivot (internal host).

Ingestion fetching additionally enforces host allowlist, response size caps,
timeouts and redirect limits — SSRF is prevented at fetch time, open redirect at
redirect time.

---

## 5. Path segment validation

`safeSegment()` rejects traversal (`..`), path separators (`/`, `\`), encoded
separators (`%2f`), query/fragment injection (`?`, `#`), control characters
(`\u0000-\u001f`, `\u007f`), empty segments, and anything over 200 chars — before
reaching a query builder.

---

## 6. Engineering rules

`npm run check:discipline` — static, CI-runnable.

| Rule | Enforces |
|---|---|
| R1 | No production shortcuts; env separation |
| R2 | No credentials, tokens, or real D1 ids in any committed file (including docs) |
| R3 | No unguarded destructive SQL |
| R4 | No test data seeded into production |
| R5 | Browser code never imports `lib/repository` or `lib/api` |
| **R6** | Only `src/lib/site-data.ts` imports `@/data/*` |

R6 was verified to fail on a deliberate violation and pass when removed.

---

## 7. Secrets

Never committed. Local secrets in gitignored `worker/.dev.vars`; real secrets in
the Cloudflare secret store / CI vault, injected at deploy. Staging and production
wrangler configs are gitignored, created from `.example` templates. Real D1 ids
are flagged by R2.

---

## 8. OWASP API Top 10 coverage

| Risk | Status |
|---|---|
| Broken Object Level Authorization | **Not built** — no write API exists. Mandatory in P11 |
| Broken Authentication | **Not built** — V1 is public read-only. P11 |
| Broken Object Property Level Authorization | **Not built** — same reason |
| Unrestricted Resource Consumption | Partial — per-isolate token bucket |
| Broken Function Level Authorization | Partial — GET-only enforced |
| SSRF | Mitigated — ingestion host allowlist + caps |
| Security Misconfiguration | Mitigated — headers, CORS allowlist, no default CORS |
| Improper API Inventory | **Open** — endpoints unversioned. P13 |
| Unsafe Consumption of APIs | Mitigated — external URLs validated |

**Four gaps are honestly open, all because V1 has no write surface.** They are
tracked, not waived.

---

## 9. Honest limits

1. **Rate limiting is per-isolate.** Worker isolates share no memory. Global
   enforcement needs a Durable Object or KV counter.
2. **GitHub Pages deploys have no headers.** It cannot set response headers, so
   the current staging deploy runs **without CSP**. Cloudflare Pages is the
   security baseline; GitHub Pages is preview only.
3. **CSP allows `'unsafe-inline'`.** Explained in §2.
4. **No bot management.** Rate limiting is the only volume control.
5. **No authentication.** By design until P11.
6. **No WAF.** Cloudflare's managed rules apply on Pages; not yet configured.

---

## 10. Verifying

```bash
npm run smoke:worker-security    # 60+ negative-case checks
npm run smoke:worker             # API still correct under security
npm run check:discipline         # R1–R6
npm run smoke:ingest-security    # ingestion fetch safety
```

After deploying to Cloudflare Pages, confirm real headers:

```bash
curl -sI https://<your-domain>/laghubitta-khabar/ | grep -iE 'content-security|strict-transport|x-frame|x-content-type|referrer-policy'
```

Headers appearing only locally is not verification. Check the deployed origin.