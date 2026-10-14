# Frontend, Backend & Security — How It Is Organized

Operating manual for the codebase. Read this before adding a page, a data module,
or an API route. Companion documents: `ARCHITECTURE.md` (why), `OPERATIONS.md`
(engineering rules R1–R6), `API-CONTRACT.md` (wire format), `ROADMAP.md` (what).

Last verified against `master` after the data-seam and edge-security work:
`npm run typecheck`, `npm run build` (334 routes), export audit (335 pages,
13,783 links, 1,463 anchors, 0 failures), and all smoke suites green.

---

## 1. The one-paragraph version

Three planes, one direction of truth. **Ingestion** discovers and extracts
evidence into a canonical store. **Projection** turns that store into read
models. **Read** serves those read models two ways — baked into static HTML at
build time, or served live as JSON by the API Worker. Nothing in the browser ever
touches a database, and no page ever imports generated data directly.

---

## 2. Layer map

| Layer | Location | May import | Must never |
|---|---|---|---|
| Pages / routes | `src/app/**` | `@/lib/site-data`, components, utils | `@/data/*`, `lib/repository`, `lib/api`, any DB |
| Components | `src/components/**` | `@/lib/site-data`, other components | same as above |
| Utils | `src/util/**` | `@/lib/site-data` | same as above |
| **Site data facade** | `src/lib/site-data.ts` | `@/data/*`, `@/types` | be bypassed |
| Generated snapshots | `src/data/*` (build output) | `@/types` | be hand-edited or imported directly |
| Domain types | `src/types/index.ts` | — | hold runtime data |
| API Worker | `worker/src/**` | `lib/api`, `lib/repository`, `./security` | be imported from `src/` |
| Repository | `lib/repository/**` | `lib/*` | be imported from `src/` |
| Contracts | `lib/api/contract.ts`, `lib/repository/contract.ts` | — | perform I/O |
| Ingestion engine | `lib/ingestion/**` | ports only | import a concrete fetcher/DB |
| Canonical store | SQLite / D1 (`schema/schema.sql`, 53 tables) | — | be queried from the browser |

Enforcement is mechanical, not cultural:

- **R5** (`check-discipline.cjs`) fails the build if any `.tsx` imports
  `lib/repository` or `lib/api`.
- **R6** (`check-discipline.cjs`) fails the build if any `src/` file except
  `src/lib/site-data.ts` imports `@/data/*`.

---

## 3. Data flow

### Build time — how the static site gets its data

```
Official MFB sites, NRB, media
        │
        ▼
lib/ingestion/  (discover → fetch → hash → extract → normalize → validate)
        │
        ▼
Canonical SQLite store  ── schema/schema.sql (frozen), lk.db locally / D1 in prod
        │
        ▼
scripts/pilot-export*.ts, build-*-module.ts, generate-nrb-data.ts
        │
        ▼
src/data/*.ts   ── GENERATED. Never hand-edited.
        │
        ▼
src/lib/site-data.ts   ── the only sanctioned reader
        │
        ▼
Next static export → out/ → CDN
```

### Request time — how the API gets its data

```
Client → Worker (worker/src/index.ts)
            │  security.ts: rate limit → CORS → route → security headers
            ▼
       lib/repository/d1.ts   (the only module that knows D1/SQL)
            ▼
            D1
```

### Why the frontend does not call the API

The site is a static export. Data that changes between deploys is served by the
Worker, not baked in. Baked data is a **snapshot with a stated provenance
string** (e.g. `financialsProvenance` says exactly how many records and whether
contents were ever read). The API path exists for freshness, for third parties,
and for anything that will eventually need writes.

---

## 4. Security posture

### Static site — `public/_headers`

`next.config.ts` sets `output: "export"`. **Next middleware does not execute
under a static export**, so `src/middleware.ts` would be dead code. Cloudflare
Pages reads `public/_headers` at deploy time, which is the platform equivalent.

Headers applied: CSP (`default-src 'self'`, no `object-src`, `frame-ancestors
'none'`), HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy` (camera/mic/geolocation off), COOP, CORP.

> **Deployment gap, stated plainly:** GitHub Pages **ignores** `_headers` and
> cannot set custom response headers at all. The GitHub Pages deploy in
> `.github/workflows/deploy.yml` therefore has **no CSP and no security
> headers**. `docs/ARCHITECTURE.md` already names Cloudflare Pages as the
> supported host. Treat Cloudflare Pages as the security baseline; treat GitHub
> Pages as a preview environment only.

### API Worker — `worker/src/security.ts`

Single owner of edge policy. `worker/src/index.ts` is routing only.

| Control | What it stops |
|---|---|
| `X-Content-Type-Options: nosniff` | JSON responses interpreted as HTML |
| CORS allowlist (`ALLOWED_ORIGINS`) | Any site reading a user-IP-keyed response. **No `*` fallback by design** — a wildcard also erases who called |
| `Vary: Origin` when CORS granted | Cross-origin cache poisoning of allowlisted responses |
| Per-IP token bucket (`RATE_LIMIT_MAX`, default 120/60s) | Volumetric abuse of a free public API. Preflight is exempt so browsers can read policy without spending a token |
| `safeRedirectTarget()` on `/go/` | Open redirect. `outbound_links.target_url` is publisher-supplied, so a `javascript:` or `data:` target would make our domain an XSS launcher and an internal host would be an SSRF/phishing pivot. Only `http:`/`https:`, no embedded credentials, no `localhost`/`.local`/`.internal` |
| `safeSegment()` on path params | Traversal, encoded separators, control characters reaching a query builder |
| GET-only + 405 | Write attempts against a read-only V1 |
| `handleError()` returns a generic message | Stack traces leaking schema and internals |

Every control has a negative-case test: `npm run smoke:worker-security`.

### Known limits — do not pretend these are solved

- **Rate limiting is per-isolate and best-effort.** Worker isolates do not share
  memory. Exact global limits need a Durable Object or a KV-backed counter.
- **No authn/authz.** V1 is deliberately public and read-only.
- **CSP allows `'unsafe-inline'` for scripts and styles.** The App Router emits
  inline bootstrap scripts that cannot be nonced in a static export. Removing it
  requires a nonce-capable runtime (i.e. dropping static export) — a deliberate
  trade, not an oversight.
- **No bot management.** Rate limiting is the only volume control.

---

## 5. Recipes

### Add a page
1. Create `src/app/<section>/page.tsx`.
2. Import data from `@/lib/site-data` only.
3. Add the route to the internal link graph so the export audit covers it.
4. `npm run typecheck && npm run build && node scripts/audit-export.cjs`.

### Add a new generated dataset
1. Write the generator under `scripts/`, writing into `src/data/<name>.ts` with a
   `GENERATED FILE - do not edit` header and a provenance string.
2. Re-export it from `src/lib/site-data.ts`.
3. Consume it via `@/lib/site-data`. Do **not** widen the R6 allowlist.
4. Commit the generated file — the site must build from a clean checkout.

### Add an API endpoint
1. Extend the contract in `lib/api/contract.ts` and the repository interface in
   `lib/repository/contract.ts` first. Then implement the adapter, then route.
2. Use `single` / `collection` / `apiError` from `lib/api` so envelopes stay uniform.
3. Validate every path segment with `safeSegment`.
4. Never `Response.redirect` an unvalidated URL — go through `safeRedirectTarget`.
5. Add a case to `scripts/smoke-worker.ts`.

### Add an ingestion source
1. Register it as a source spec. **No per-institution code** — that constraint is
   the whole point of the engine.
2. Declared capabilities drive discovery; the fetcher owns SSRF and size limits.
3. Extraction writes `data_assertions` + `source_snapshots`, never a bare fact.
4. Add a fixture case to `scripts/smoke-ingest-fixtures.ts`.

---

## 6. Housekeeping

- `scripts/` is flat with ~57 files and no subdirectories. It is the least
  organised part of the repo and the main source of accidental duplication.
  Recommended split when touching it: `scripts/ingest/`, `scripts/export/`,
  `scripts/smoke/`, `scripts/ops/`.
- `src/types/index.ts` declares `Job`, `Post`, `Video`, `Document`,
  `ResearchItem`, `ReportMetric`, `IndustryReport`. Of these only `Job` is
  referenced, and the live one is the duplicate declared in `src/data/jobs.ts`.
  The rest are dead type surface and can be deleted.
- `npm run lint` fails on **pre-existing** errors in `.cjs` scripts (`require()`
  in ESM scope, one `prefer-const`). Frontend `npx eslint src lib worker` is
  clean with 0 errors. Pre-existing, tracked, not introduced here.

---

## 7. Open architectural questions

These are decisions, not tasks. Each needs an explicit owner decision.

1. **Read-plane wiring.** R5 forbids the frontend calling the repository. The
   sanctioned path today is build-time projection into `src/data/*`. The
   alternative is runtime fetches against the Worker API, which costs static
   export benefits but makes data always fresh. Undecided.
2. **Durable canonical store.** Every pilot run has written a *new dated
   database* under `data/pilot/evidence/`, so evidence accumulates in snapshots
   rather than in one store. `lk.db` currently holds the 51-institution universe
   but zero assertions. Whether to make one store append-only across runs is the
   highest-value structural decision outstanding.
3. **Hosting.** GitHub Pages (current CI) vs Cloudflare Pages (documented target,
   and the only place the security headers apply).