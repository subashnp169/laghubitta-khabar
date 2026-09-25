# Laghubitta Khabar — Architecture (Frozen)

Nepal's Microfinance Information & Intelligence Platform.

## Product definition

Laghubitta Khabar is an **MFB knowledge graph + evidence layer + intelligence interface**, not a
news site. The canonical entity is the **institution** (MFB). Every MFB gets a "digital twin":
identity, leadership, branches, financials, documents, news, timeline, digital presence, products,
careers — each with evidence and provenance.

- **Knowledge graph**: structured, historical, source-backed relationships no competitor can
  reproduce ("NPL 2025/26 Q4 = 7.83%, NRB, VERIFIED" — never bare "NPL = 7.83").
- **Evidence layer**: `sources` → `source_snapshots` → `documents`/`data_assertions` — every
  fact traces to a retrievable source.
- **Intelligence interface**: news brings users, jobs bring recurring traffic, financials bring
  utility, NRB brings regulatory usefulness, branch directory brings search traffic — but the
  graph + evidence is the moat.

## Layered architecture

```
                    ┌─────────────────┐
                    │   Next.js UI    │   Frontend is dumb. Never touches D1.
                    └────────┬────────┘
                             │  HTTPS GET only
                    ┌────────▼────────┐
                    │   API / DTO     │   Frozen JSON contracts. Versioned.
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Repository layer│   Only place that knows D1/SQL.
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │       D1        │   Structured facts only. Portable SQLite.
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   R2 (evidence) │   PDFs, source snapshots, logos, screenshots.
                    └─────────────────┘
```

## Storage split (non-negotiable)

- **D1**: structured facts, relationships, metadata, index, events, content hashes.
- **R2**: OPTIONAL archival evidence only — PDF copies are stored ONLY when `archive_policy`
  requires it (REGULATORY_ARCHIVE / ARCHIVE / OPTIONAL per decisions). Default is `LINK_ONLY`.
- **We do NOT become a PDF storage company.** The MFB is the publisher and keeps hosting its
  public documents. We catalogue, index, hash, verify, and (optionally) archive.
- A `documents` row: `document_id, institution_id, doc_type, title, official_url, canonical_url,
  go_slug, period, content_hash, file_size, mime_type, availability_status, archive_policy,
  archived_locally, r2_key(NULL), source_id, published_at`.
- **`go_slug` is the contract**: `/go/{institution-slug}/{go_slug}` is a source-redirect to the
  official document. The `r2_key` stays NULL for LINK_ONLY.

## Document access model (link + evidence, not hosting)

- **Normal case (LINK_ONLY):** user clicks → `/go/mero/annual-report-2081-82` → **302/301
  redirect** → official MFB URL. The MFB server serves the PDF bytes; we serve only a tiny
  redirect + the metadata page. 3,000 clicked PDFs = 3,000 × redirect to MFB, zero MB through us.
- **Evidence stays with us:** SHA-256 `content_hash`, `file_size`, `last_checked_at`,
  `availability_status`. If the official file changes (same URL, new hash), we detect it and
  surface it as a new state — the old hash remains history in `source_snapshots`.
- **Availability check:** periodic re-check. MUST use GET/range requests; do not assume `HEAD`
  is supported (many MFB servers 405 it). If `official_url` itself 302s (e.g. Mero
  `/downloads/{id}/download`), resolve once to `canonical_url` first.
- **Redirect mechanics (Cloudflare, verified 2026):**
  - `_redirects` file supports external destinations + 301/302/303/307/308, default 302.
  - `_redirects` is capped at 2,000 static + 100 dynamic rules (2,100 total).
  - **Use Bulk Redirects (Cloudflare Rules) for the document map** — unlimited slot, runs in
    front of `_redirects`, ideal for 90 MFBs × N docs. Small hand-written rules can stay in
    `_redirects`.
  - `_redirects` does NOT apply to requests served by Pages Functions — a source-redirect
    implemented in a Function must `Response.redirect()` itself, it won't be overridden.
- **Archive policy:** LINK_ONLY (default) → never store bytes. ARCHIVE/REGULATORY_ARCHIVE →
    store one R2 copy (evidence if the publisher removes the file). OPTIONAL → archive when the
    official copy goes missing. In all cases the public UI click path is the same `/go/` redirect;
    the R2 copy is the fallback evidence, not the primary serving.

## Deployment (2026 current)

- Next.js static export remains fully supported on **Cloudflare Pages** (`output: export`).
- For ISR/SSR and D1 bindings from the app, **Cloudflare recommends vinext** (its Vite-based
  Next.js reimplementation) for new Next.js apps on **Workers**; OpenNext remains the documented
  path for existing apps that cannot migrate.
- **Static export and ISR are mutually exclusive** (Next.js docs). Do not configure both.
- Freeze rule: *all public reads go through the API/repository layer with HTTP/CDN/application
  caching. The database is never queried from browser code.*
- Budget **Workers Paid ($5/mo)** from launch: since 2026-09-01 D1 enforces Free-tier daily row
  limits (5M read / 100k write) with hard failures on exceed.

## Caching order (learn after data pipeline works)

1. Database → API → Next.js (no cache).
2. Add cache between API and Next.js.
3. Add CDN/cache at Cloudflare edge.
4. Add Redis only if actually needed. (Not now.)

## Data flow

```
Official MFB websites ─┐
NRB                   ─┼─► INGESTION ENGINE: discover ─► fetch ─► hash ─► extract/parse
NEPSE                 ─┘      ─► AI classify ─► normalize/dedupe ─► validate
                                   │
                    ┌──────────────┴──────────────┐
                    │  AUTO_VERIFIED  │ HUMAN_REVIEW │
                    └──────────────┬──────────────┘
                                   ▼
                              D1 (facts) ─► Repository ─► API Worker ─► Cache ─► Next.js UI
                                   │
                                   └─► R2 (selected evidence only)
Verification / Review is a human-in-the-loop gate; AI never publishes a fact directly.
Static export is not used for continuously changing data — dynamic data is Worker-served.
```

## Phased population (the schema is complete from day one; the app never pretends every
## field has data)

**Phase A** identity+evidence (institutions, aliases, symbols, sources, snapshots, documents,
extractions, outbound_links) → **Phase B** people+branches → **Phase C** financials →
**Phase D** content → **Phase E** regulatory+ingestion. `institution_coverage` per-MFB statuses
track how fully each institution has been researched (internal quality labeller, never a public
score).

## Future expansion (SENNA direction)

The D1/R2/API/provenance core is shared infrastructure. Laghubitta Khabar is the first vertical;
Banking and NRB intelligence verticals can reuse the same engine. Build the data layer correctly
once, and future verticals are source-configuration problems, not re-architecture.