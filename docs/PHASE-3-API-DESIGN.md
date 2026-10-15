# Laghubitta Khabar — Phase 3 (M3.1 B2B API) Design

Design freeze for the first Phase 3 slice: the read-only B2B API that the frozen
`docs/API-CONTRACT.md` describes. Deterministic, evidence-backed, single agreement
between consumers and the data layer.

## The constraint that shapes the design

`next.config.ts` uses `output: "export"` — every page is prerendered at build time
(see the 71-static-pages build). Next's own static-export guidance shows Route
Handlers in `app/api/*` only render **build-time static files**; they cannot read
incoming request query params (`?page=`, `?q=`), which the B2B contract requires.

**Decision:** do not fight the frozen static deploy model. The B2B API is served by
a tiny standalone Node HTTP server (`scripts/api-server.ts`, `node:http`, no new
dependencies) that maps contract routes → a pure repository layer → JSON envelopes.
The static site never changes class; the API is a separate process for B2B clients.

```
B2B client ──GET──▶ scripts/api-server.ts (node:http, read-only)
                        │ HTTP→JSON only
                        ▼
                    lib/api/handler.ts   ← pure router: {method,url} → {status,body}
                        ▼
                    lib/api/repository.ts ← pure read models: envelopes + pagination
                        ▼
              generated modules (institutions/pilot/nrb/jobs/documents)
```

## Scope of this slice (M3.1)

Implemented endpoints (all GET, all read-only, envelope + pagination per contract):

| Endpoint | Action |
|---|---|
| `GET /api/institutions` | list `InstitutionSummary`; `?q=` (name/alias substring), `?province=`, `?status=`, `?page=`, `?limit=` |
| `GET /api/institutions/:slug` | single-resource `InstitutionDetail` (SNOT: identity, capital, geography, coverage, web evidence, NRB docs/events) |
| `GET /api/institutions/:slug/documents` | matched NRB documents via `src/data/nrb.ts` links |
| `GET /api/institutions/:slug/events` | NRB regulatory events filtered by institution slug |
| `GET /api/institutions/:slug/jobs` | canonical vacancy layer (P2-D): both evidence shapes, publisher→registry attribution; the pre-P2-D name-prefix matching is **removed** (it credited ten invented postings to named MFIs) |
| `GET /api/institutions/:slug/branches` | canonical branch layer (P2-B); empty only where branch evidence does not resolve |
| `GET /api/institutions/:slug/leadership` | canonical People + Positions layer (P2-A); empty only where no source states a person |
| `GET /api/institutions/:slug/financials` | canonical financial **document** layer (P2-C); empty only where no document evidence resolves |
| `GET /api/institutions/:slug/interest-rates` | canonical interest-rate **notices** for institution (P2-C); `rate_pct` always null |
| `GET /api/institutions/:slug/graph` | operational graph (P2-F): node + edges (leadership/branches/financials/reports+rates/documents/jobs/news/events/links), merged timeline, evidence trail |
| `GET /api/interest-rates` | canonical interest-rate **notices** (P2-C); 8 notices, `rate_pct` always null |
| `GET /api/search?q=` | grouped `{institutions, people, documents}`; people populated from P2-A evidence |

Not in this slice: notification writes and any non-GET verb (contract is
read-only V1 anyway). `GET /api/news` **is in this slice since P2-E**: its tier
vocabulary is derived from the registered NRB source publishers
(`lib/api/repository.listNews` → `src/util/activity.ts`), never invented —
OFFICIAL/KHABAR/MEDIA are served as honest zero counts until a source-owned
ingestion populates them.

## Honesty rules

- `meta.verification_status` is `"UNVERIFIED"` for every payload — the institution
  pages already carry this caveat; the API must not pretend review happened.
- `last_verified_at` / `source` come from the evidence fields actually recorded
  (`nrb-bfi-mid-may-2026`, `asOf` `2026-05-15`), never invented.
- Missing values are realistically absent or provable (0 counts), never fabricated.
- Branches (P2-B), leadership (P2-A) and financial documents (P2-C) return
  populated collections from evidence; where a source does not state them they
  stay honestly empty (`pagination.total: 0`).
- Vacancies (P2-D) publish only what evidence states: `deadline` is always
  `""`, `location`/`type` always `"(… not observed)"` placeholders, `kind`
  distinguishes a read posting from an unread notice. General documents
  (P2-D) are intentionally **not** routed through the contract — V1's
  `/documents` route keeps its NRB meaning (see API-CONTRACT.md); exposure is
  the `/documents` page and the D1/worker repository path.

## Error contract (from API-CONTRACT.md)

`NOT_FOUND` (404), `VALIDATION` (422, e.g. search without `q`), `METHOD_NOT_ALLOWED`
(405, additive code for non-GET), `INTERNAL` (500). No UPSTREAM yet (no upstream calls).

## Conventions

- `lib/api/*` are pure (no I/O, no randomness, no AI); the only I/O is the Node server's
  request/response plumbing. `handleApiRequest` is importable so smokes never touch a socket.
- No schema change, no DB writes, no new dependencies (`node:http` builtin only).
- `scripts/api-server.ts` binds `HOST` (default `127.0.0.1`; binding a public
  interface is opt-in), port `PORT` env or `8787`, JSON content-type, and logs
  `METHOD path → status` per request. The server policy (CORS, rate limit,
  liveness) lives in the pure, testable `lib/api/server-policy.ts`.
- The Solid/D1-backed adapter behind the repository (`/api/db/*` contract notes) stays
  future work; today repository reads the generated modules exactly like the pages do.

## P13 — API v1 completion (discovery + machine-readable contract)

The read-only surface is now self-describing and locked:

- `GET /api` returns a discovery index (name, `version: v1`, `read_only`, every endpoint).
- `docs/api/openapi.json` is an OpenAPI 3.1 document generated from
  `lib/api/routes.ts` by `npm run build:openapi`.
- `lib/api/routes.ts` is the single source of truth: the router, the discovery
  index, the OpenAPI document and the guard all read from it.
- `npm run smoke:api-contract` fails if the published spec drifts from the
  builder, if any documented route is not implemented, if any route is
  undocumented, if a non-GET verb is accepted, or if search without `q` is not
  422. It also confirms the router still serves a reachable route for every entry.

## P13 — server hardening

The route table is frozen; hardening lives in the server shell and the pure
`lib/api/server-policy.ts`, so the contract cannot drift:

- **CORS** is an allowlist from `LK_API_ALLOWED_ORIGINS` (comma separated). Unset
  or blank means the local-dev wildcard; a set value is strict, so a
  misconfigured deploy exposes nothing rather than everything. A refused origin
  gets no `Access-Control-Allow-Origin` header. `OPTIONS` preflight is answered
  `204` for `GET, HEAD, OPTIONS` only.
- **Rate limit** is an in-process fixed-window limiter (`LK_API_RATE_LIMIT` per
  minute; `0` or unset = disabled). Over-limit callers get a structured `429`
  `RATE_LIMITED` error with `Retry-After`, never a silent failure.
- **Liveness** is `GET /health`, returning `{ status, read_only, api_version,
  endpoints }` — about the process, not the data, and deliberately free of any
  timestamp or record count, so it is deterministic and cannot read as a
  freshness or coverage claim.
- **Lifecycle**: `SIGINT`/`SIGTERM` drain connections and exit. Responses carry
  `Cache-Control: no-store`, `Vary: Origin`, `X-Content-Type-Options: nosniff`.
- `npm run smoke:api-hardening` locks all of the above without binding a socket.

Network deployment (host, TLS, reverse proxy) is an operations step, not code.

## Non-goals this slice

AuthN/AuthZ/key issuance, rate limiting, caching/CDN config, the news/source-tier
endpoint, B2B subscriptions, any write path, and moving the site off static export.