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
    "source_url": null,
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

`meta.source_url` is the raw, followable URL of that primary source, so a consumer
can open the evidence rather than trust a bare identifier. It is `null` whenever no
URL is known for the source — including when `source` names an evidence *document*
rather than a web page. A source URL is never synthesised, guessed, or substituted
with the institution's website: an absent link is reported as absent.

### Roles are multi-holder, not single-slot

`PersonDto.positions[].shared_by` is the number of distinct people the institution
currently lists in that same role field, including that person.

A role slot is not single-occupancy. An institution can list several directors,
several board members, or a joint chief executive, and the read model publishes
every name the source gave. Without `shared_by` a client sees two people both
titled `Chief Executive Officer` and reasonably concludes the data is broken.

`shared_by` is a derived count of published rows. It is **not** a claim that the
office is shared — when it is greater than 1 the source listed several names under
one heading and the reason is unknown. That is reported, not resolved, and the names
are never dropped to make a slot fit one person.

### `CONFLICT` means cross-source disagreement only

`verification_status: "CONFLICT"` is reserved for a genuine disagreement between
two **independent sources** over the same field. Several names from **one** source
under one heading is a multi-holder role, not a contradiction, and does not degrade
the record.

This distinction matters: treating a single source's multi-name listing as a
conflict made honest source data look self-contradictory and pushed records to
`CONFLICT` for no evidentiary reason. A record with `sources.length === 1` cannot
be in cross-source conflict at all.

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