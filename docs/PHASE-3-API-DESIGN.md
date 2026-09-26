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
| `GET /api/institutions/:slug/jobs` | jobs matched deterministically (name-prefix rule, see repository comments) |
| `GET /api/institutions/:slug/branches` | empty collection until Phase B |
| `GET /api/institutions/:slug/leadership` | empty collection until Phase B |
| `GET /api/institutions/:slug/financials` | empty collection until Phase C |
| `GET /api/interest-rates` | empty collection until Phase C |
| `GET /api/search?q=` | grouped `{institutions, people, documents}`; people empty until Phase B |

Not in this slice: `GET /api/news` (needs a source-tier vocabulary that the current
`posts.ts` digest does not carry — do not invent tiers), notification writes, and any
non-GET verb (contract is read-only V1 anyway).

## Honesty rules

- `meta.verification_status` is `"UNVERIFIED"` for every payload — the institution
  pages already carry this caveat; the API must not pretend review happened.
- `last_verified_at` / `source` come from the evidence fields actually recorded
  (`nrb-bfi-mid-may-2026`, `asOf` `2026-05-15`), never invented.
- Missing values are realistically absent or provable (0 counts), never fabricated.
- Branches/leadership/financials/interest-rates return honest empty collections with
  `pagination.total: 0` — the phases have not populated them.

## Error contract (from API-CONTRACT.md)

`NOT_FOUND` (404), `VALIDATION` (422, e.g. search without `q`), `METHOD_NOT_ALLOWED`
(405, additive code for non-GET), `INTERNAL` (500). No UPSTREAM yet (no upstream calls).

## Conventions

- `lib/api/*` are pure (no I/O, no randomness, no AI); the only I/O is the Node server's
  request/response plumbing. `handleApiRequest` is importable so smokes never touch a socket.
- No schema change, no DB writes, no new dependencies (`node:http` builtin only).
- `scripts/api-server.ts` binds `127.0.0.1`, port `PORT` env or `8787`, JSON content-type,
  permissive `Access-Control-Allow-Origin` for public read data, and logs
  `METHOD path → status` per request.
- The Solid/D1-backed adapter behind the repository (`/api/db/*` contract notes) stays
  future work; today repository reads the generated modules exactly like the pages do.

## Non-goals this slice

AuthN/AuthZ/key issuance, rate limiting, caching/CDN config, the news/source-tier
endpoint, B2B subscriptions, any write path, and moving the site off static export.