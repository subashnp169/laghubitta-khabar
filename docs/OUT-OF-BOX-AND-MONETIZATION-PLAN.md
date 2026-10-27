# Out-of-the-box plan — Laghubitta Khabar

> Status: planning document (V1 complete + released; this is the V2/OOTB roadmap).
> Companion to `docs/architecture/WORKMAP.md` (all phases P0–P19 now resolved)
> and `docs/NEXT-PRODUCT-PRIORITIES.md`.

## 1. Where we are (V1, released as v1.0.0)

Every WORKMAP phase is resolved with an honest status. Nothing is fabricated; every
figure carries its source and vintage.

Shipped surfaces (routes):
- `/` home, `/institutions` (+ `/institutions/[slug]` profiles), `/people` (+ `[slug]`)
- `/news` (regulatory events + NRB documents), `/documents`, `/jobs`
- `/financials`, `/interest-rates`, `/nrb`, `/compare`, `/research`, `/reports`
- `/alerts` (evidence conflicts, coverage gaps, regulatory events, snapshot diff)
- `/search`, `/ingestion` (source health, coverage honesty)
- `/media` (videos/posts/digital services — honest empty today)
- `/digital` (official websites + social accounts — honest empty socials)
- `/contribute` (read-only intake via GitHub), `/data-products`, `/support`
- `/sitemap.xml`, `/robots.txt`, `_headers` (Cloudflare Pages security set)

Data (all sourced, none invented): 51 institutions, 62 regulatory events,
97 NRB documents, 48 financial documents, 99 vacancies, 62 former names across 25
institutions, 5083 assertions, 1458 snapshots, 264 ingestion runs.

Guards: identity (5488 refs), data-truth (3970 results), discipline (clean),
tsc 0, build 394 pages, 26+ smoke suites, eslint 0 errors.

## 2. Out-of-the-box experience (target look & feel)

Goal: a reader lands on the site and, within 10 seconds, understands (a) what it
is, (b) what is sourced vs. not, (c) how to find their institution. No
fabricated freshness, no invented counts, no "verified" claims the data cannot
support.

### 2.1 Information architecture (OOTB)
Top nav (keep to 7, current): Institutions · People · News · Documents · Jobs ·
Financials · Rates. Plus a global search (Cmd/Ctrl+K) and a mobile drawer.

Secondary (footer, grouped): Sector (News, Institutions, People, NRB, Media,
Digital), Information (Financials, Rates, Jobs, Documents, Reports, Research,
Data products), Tools (Ingestion, Alerts, Compare, Search, Contribute, Support).

### 2.2 Visual system
- Tailwind tokens already in use: `mfi-50/950` palette, `lk-*` component classes.
- Shared primitives: `Container`, `PageHeader`, `Panel`, `SectionNav`, `Breadcrumb`,
  `Stat`/`StatGrid`, `Chip`/`StatusChip`, `EmptyState`/`StateNote`, `Provenance`.
- Every field shows its state via the shared vocabulary (Unknown / Partial /
  Not extracted / Not confirmed / Verified / Candidate) — never a naked number.
- Empty states are first-class: "Not extracted — a coverage gap, not a statement
  that the institution has none."
- Provenance footer on every data page: directory vintage, financial/vacancy
  counts + UNVERIFIED flag, source monitoring, last report date.

### 2.3 Page templates (OOTB)
1. **Home**: hero (what the site is, not what it has), counts with vintage,
   "how to read a record" pointer, sector nav, footer provenance.
2. **Institution profile**: identity block → section nav → Overview, Leadership,
   Governance, Branches, Financials, Interest rates, Corporate history, Timeline,
   Regulatory events, Documents, Careers, Regulatory record, Sources. Each section
   is a `Panel` with a `StateNote` when empty.
3. **Compare**: rows declare source + comparability class (comparable/context/
   telemetry) + per-row coverage marker.
4. **Alerts**: conflicts (high) → coverage (med) → regulatory events → snapshot
   diff, each group sorted, separated, never interleaved.
5. **NRB/regulatory**: categorised by NRB-SOURCE-MAP series, with "declared but
   absent" stated, not hidden.
6. **Media / Digital**: honest empty states + provenance (ready for data).

### 2.4 Trust signals (non-negotiable)
- No invented dates, counts, or "verified" claims.
- Candidate websites shown as "unconfirmed", never as official.
- Logos/colours never guessed (BRANDING_NOTE).
- Every cross-link uses canonical identity (smoke:canonical-links).
- sitemap + robots + per-entity JSON-LD (verified-only sameAs).

## 3. Earning strategy (best path, honest)

V1 is free and read-only. Monetisation is gated on validated demand (P16/P17).
The best earning path, in order of risk/reward:

1. **Sponsorship (lowest risk, now):** GitHub Sponsors on /support. Voluntary,
   no feature gating, no paywall. Keeps the record free and the trust intact.
2. **Data products (medium risk, needs demand):** bulk exports (CSV/JSON of
   institutions, branches, people, financials), API tiers (higher rate limits,
   SLA), research datasets. Only build after ≥3 concrete requests with a stated
   use case (the /data-products page collects them via GitHub issues).
3. **Research / analysis (medium risk):** labelled fact/calculation/analysis/
   external statements on /research, with a methodology page. Could become a
   paid research note, but only if it stays clearly separated from the record.
4. **Services (higher risk, later):** institution-specific data packs, custom
   extracts, consulting. Needs a legal entity + invoicing.
5. **Never:** paywalling the core record, sponsored rankings, or "verified"
   badges sold to institutions. These destroy the one thing that makes the site
   valuable (trust).

Rule: money never changes a published fact. The record stays free; money buys
convenience (bulk, SLA, custom extracts) or supports the work.

## 4. Remaining setup (ops, not code)

- **Deploy:** GitHub Actions builds on push to master → GitHub Pages (staging).
  Cloudflare Pages is the security baseline (reads `public/_headers`); copy
  `robots.txt` to the domain root (crawlers read `/robots.txt` outside basePath).
- **R2:** set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET`, `R2_PUBLIC_URL` when media assets arrive; code path is ready.
- **API server:** host/TLS/proxy for the B2B API (runs on 127.0.0.1:8787);
  set `LK_API_ALLOWED_ORIGINS`, `LK_API_RATE_LIMIT`, `HOST` as needed.
- **Media ingestion:** populate `videos`/`posts`/`digital_services`/`social_accounts`
  tables, then re-run `build:media` / `build:social`.
- **Social ingestion:** populate `social_accounts`, then `build:social`.

## 5. V2 backlog (when demand justifies)

- Search coverage expansion (branches/reg events/metrics) — P4-2 done; deeper
  facets.
- Snapshot-diff alerts over the full durable store (not just pilot people).
- Per-institution OG images.
- Auth + moderation (V2, if contribution volume justifies).
- Paid data products (gated on ≥3 validated requests).
- Mobile nav polish (P3-1, source-done).

## 6. Definition of "complete"

V1 is complete and released (v1.0.0). The OOTB plan above is the V2 target.
Nothing further is buildable without either (a) new data, (b) infra/credentials,
or (c) an explicit product decision — and all three are now documented as the
remaining setup, not as unfinished code.
EOF
echo "written"