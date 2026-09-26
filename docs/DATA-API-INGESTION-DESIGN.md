# Laghubitta Khabar — M3.2 Data-API Ingestion (JS-backed sources)

Design freeze for ingesting MFB sites that render content only via client-side
JavaScript (verified live 2026-09-26): `infinitylbsl.com.np` serves a 2 KB
Vite/React shell (`<div id="root">`, zero anchors, Cloudflare bot-challenge);
its content comes from a backing CMS API. Plain-HTTP HTML extraction sees
nothing — "waiting for the JS" is the browser answer, which Phase R forbids.

**Decision:** don't render, don't wait. When a site's own bundle reveals the
backing JSON API, ingest that API directly — deterministic HTTP, no browser,
no AI. The API is the same data source the real site consumes.

## Discovery evidence (recorded, not guessed)

- Shell: `https://infinitylbsl.com.np` → 2092 bytes, `<div id="root">`, 3 scripts,
  0 anchors, Cloudflare challenge (SPA mode).
- Bundle (fetched as inert bytes, never executed): `assets/index-*.js` →
  axios `baseURL: https://vyccudevice.exploretonepal.com/api`.
- Endpoints probed live (all read-only): `/api/branch` (JSON array, 29 KB —
  `code`, `name`, `manager`...), `/api/news` (JSON array, 10 KB — `_id`,
  `title`, `content`, `createdAt`, `fileCon`...), `/api/career` (single object —
  `vacancyAvailable`, `portalUrl`). Reported probes: `/reports`, `/documents`,
  `/interest-rates`, `/notices` → 404 (not registered). Nothing fabricated.

## Config model (schema-less `config_json.data_api`, no DDL change)

```jsonc
"data_api": {
  "provenance": "bundle-discovered 2026-09-26 (infinity lbsl site bundle)",
  "baseUrl": "https://vyccudevice.exploretonepal.com/api",
  "hosts": ["vyccudevice.exploretonepal.com"],
  "routes": [
    { "capability": "BRANCH_DIRECTORY", "path": "/branch" },
    { "capability": "NEWS",                "path": "/news" },
    { "capability": "CAREER_PAGE",         "path": "/career" }
  ]
}
```

Strict validation (`DataApiConfigError`, mirrors `CapabilityConfigError`):
- `baseUrl` must be `https://`; `hosts` are bare domains (no protocol/path) and
  must include the baseUrl hostname.
- `routes[].capability` must be a frozen `CAPABILITY_KINDS` member; `path` must
  start with `/`. Duplicate paths collapse.
- Absent `data_api` ⇒ null (no behaviour change); malformed ⇒ loud failure.

## SSRF/allowlist policy

The source's fetcher policy continues to allow the site's own domain(s). The
`data_api` pass **adds** `hosts` to that source's allowedHosts only after the
config validation above, and every fetch still runs the ControlledFetcher
(HTTPS only, port 443, public-IP DNS check, redirect re-validation, size cap,
timeout, per-host rate limit). No global widening.

## Run semantics

- A `data_api` pre-pass runs in the source run flow (ops-cli/run-pilot), before
  the ordinary HTML run. It executes in the same scratch/pilot DB via the same
  `LocalSqliteEvidenceWriter` conventions:
  - one run row per pass, one item per route (idempotency by url+hash),
  - one `outbound_links` per document-like URL found on a route,
  - assertions derived from `extractDataApiCapability` fields.
- Everything persists exactly like the HTML path: `UNVERIFIED`, evidence-anchored
  (`sourceUrl = baseUrl+path`), parser id `json-api-v1`.

## Generic extractor (no per-MFB code, no AI)

`extractDataApiCapability(payload, capability, ctx)` normalises the response to
item objects (array, `{data:[...]}`, or array-valued keys) and maps known fields
to the SAME assertion vocabulary the HTML parsers use, so downstream counters
and models light up unchanged:

| Capability | recognised fields → emitted | notes |
|---|---|---|
| BRANCH_DIRECTORY | `name/nameEn/title/branch` → `branch_name`; `phone/contact/manager/address/district/place` → `branch_*` attributes | `code` retained in attribute when no name |
| NEWS | `title/notice/topic` → `notice_title`; `createdAt/publishedAt/date` → date attribute; URL-bearing `fileCon/file/url/attachment` → outbound DOCUMENT links | news items are notices |
| CAREER_PAGE | `vacancyAvailable` + title/portal fields → `vacancy_*` / `career_portal_url`; portal URL → outbound link | no invented vacancy names |

Confidence floors follow the R3/R4 convention: identity ≥ 0.5, volatile
attributes 0.45, always UNVERIFIED.

## Scope of this pass

- New pure module `lib/ingestion/dataapi.ts` (config parse + extractor + run
  orchestration) + `smoke:dataapi` fixtures.
- `ops run` and `run-pilot` gain the pre-pass; pilot config seeds Infinity's
  `data_api` (with provenance note) so future re-seeds and the persisted pilot
  DB both carry it.
- Pilot `data/pilot` regeneration picks up the new assertions via the existing
  `pilot-export` counters (no export change needed).

## Non-goals

- No AI, OCR, or browser automation (Phase R unchanged).
- No support for authenticated APIs or JS-interactive scraping.
- SITEMAP/REPORTS/DOCUMENT_ARCHIVE via API stay unimplemented until a real
  endpoint exists.
- No new capability kinds (`CAPABILITY_KINDS` untouched).