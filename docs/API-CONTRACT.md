# Laghubitta Khabar — API Contract (Frozen)

The single agreement between the frontend and the data layer. Frontend never touches D1; the
**repository layer** is the only place SQL/D1 exists. Reactions fetch JSON matching this contract.

## Layering rule

```
page.tsx / components          ← React, presentation only, no D1 knowledge.
        ↓  HTTPS GET              (or direct repository call in the same runtime,
app/api/* route handlers          never from the browser)
        ↓
Repository layer                ← interface + adapters (D1 / local / mock).
        ↓
D1 / local DB
```

## Response envelope

**Single resource**

```json
{
  "data": {},
  "meta": {
    "source": "nrb-bfi-mid-may-2026",
    "sources": ["nrb-bfi-mid-may-2026"],
    "last_verified_at": "2026-06-20",
    "verification_status": "VERIFIED"
  }
}
```

`meta.sources` lists every source that currently owns an observation backing the
payload, sorted, and is the public expression of **corroboration**: two or more
entries mean independent sources assert the same normalized claim, derived from
source-owned observations rather than from merged claims. `meta.source` remains
the first-published owning source, for single-value attribution.

**Collection**

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 51
  }
}
```

**Error**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No institution with slug 'no-such-mfb'"
  }
}
```

Codes: `NOT_FOUND` (404), `VALIDATION` (422), `UPSTREAM` (502), `INTERNAL` (500).

## Common query params

- `?page=1&limit=20` — pagination, default `limit=20`, max `limit=100`.
- `?scope=INSTITUTION|NRB|MARKET|MEDIA` — filter source scope (news).
- `?status=VERIFIED|CANDIDATE|STALE|FAILED` — evidence status.
- Verification statuses: `UNVERIFIED`, `AUTO_VERIFIED`, `HUMAN_VERIFIED`, `CONFLICT`, `STALE`.

## Endpoints (V1)

### GET /api/institutions

List institutions (directory). Returns collection envelope. Each item is `InstitutionSummary`.
Supports `?q=` (name/alias/slug substring), `?province=`, `?status=`.

### GET /api/institutions/:slug

Full institution "digital twin": identity, official links, aliases, timeline, coverage.
Returns `data` = `InstitutionDetail`.

### GET /api/institutions/:slug/leadership

Board + senior management (Phase B). Returns collection envelope; empty until Phase B populates.

### GET /api/institutions/:slug/branches

Branch directory. Collection envelope; empty until Phase B.

### GET /api/institutions/:slug/financials

Financial snapshot + history. Collection envelope of `FinancialReport`; empty until Phase C.

### GET /api/institutions/:slug/documents

Categorised documents (reports, notices, directives). Collection envelope; Phase A/E.

### GET /api/institutions/:slug/events

Timeline events (MERGE/ACQUIRE/RENAME…). Collection envelope; seeded from master data.

### GET /api/institutions/:slug/jobs

Job listings for the MFB. Phase D; empty until then.

### GET /api/people/:slug

Person profile (Tier-1/2 board + senior mgmt). Single-resource envelope; Phase B.

### GET /api/news

News list, typed by source (OFFICIAL / NRB / KHABAR / MEDIA). Collection envelope with
`meta.tier` counts. `?scope=` + `?tier=` filters, `?page=`.

### GET /api/search

Free-text search across institutions, aliases, people, documents. Returns grouped results:

```json
{
  "data": {
    "query": "infinity",
    "groups": {
      "institutions": [],
      "people": [],
      "documents": []
    }
  }
}
```

### GET /api/interest-rates

Rate table with periods (`interest_rate_periods` → `interest_rates`). Collection envelope; Phase C.

## Not in V1

No POST/PUT/DELETE (read-only V1). Writes happen via the ingestion/admin pipeline, not public API.

## Versioning

- Path-prefixless; breaking changes → `/v2/...`. Additive changes never break V1 shape.
- `meta` is extendable; `data` shape changes only via new version.