# READ-WRITE-BOUNDARY — Phase P0.1 Freeze

**Status:** FROZEN (Phase P0.1)

The single most important boundary in this system. Everything else follows from it.

---

## 1. The boundary

```
┌─ READ PLANE ──────────────────────────────────────────┐
│  Next.js pages/components                             │
│      ↓                                                │
│  src/lib/site-data.ts   (the only sanctioned seam)    │
│      ↓                                                │
│  src/data/*.ts          (generated, build artifact)   │
└───────────────────────────────────────────────────────┘
                            ╳   never crosses   ╳
┌─ BACKEND ─────────────────────────────────────────────┐
│  lib/repository/**       (only module that knows SQL)│
│  lib/api/**              (envelopes, no I/O)          │
│  worker/src/**           (HTTP + security)            │
│      ↓                                                │
│  SQLite / D1             (canonical store)            │
└───────────────────────────────────────────────────────┘
```

**Nothing crosses this line from the browser inward.** A page never sends SQL, a
table name, or a D1 binding. Enforced statically by **R5**.

---

## 2. Why the frontend does not call the API

This is deliberate, and it is the thing most likely to be "fixed" by mistake.

1. **Static export.** `next.config.ts` sets `output: "export"`. The site is
   pre-rendered HTML on a CDN. There is no server to call at request time.
2. **SEO.** Baked pages are indexable and fast. A client-fetched shell is neither.
3. **Cost.** Static hosting is near-free at this scale (§58).
4. **Reliability.** A page cannot 500 because D1 is slow.

The cost is freshness: data is as fresh as the last deploy. That is acceptable
because the public site is a publication, and its provenance strings state
exactly when each dataset was generated.

**Freshness is served by the API path** for consumers that need it.

---

## 3. The sanctioned read seams

Exactly two exist.

### Seam 1 — build-time (public site)

```
src/lib/site-data.ts   ← the ONLY module permitted to import @/data/*
        ↑
src/data/*.ts          ← GENERATED. Rewritten by scripts/pilot-export*.ts,
                         scripts/build-*-module.ts, scripts/generate-nrb-data.ts
        ↑
data/pilot/evidence/*.db, data/master/master.json
```

Enforced by **R6** (`scripts/check-discipline.cjs`). Pages importing `@/data/*`
directly fail the discipline check.

Why this exists: when pages import generated modules directly, an export script
renaming a field silently breaks unrelated routes, and the repository contract
drifts from what the site renders. The facade keeps the generated layer swappable.

### Seam 2 — runtime (API)

```
client → worker/src/index.ts → lib/repository → D1
```

Read-only V1. GET only; everything else 405. Frozen envelopes from
`lib/api/contract.ts`.

---

## 4. Query functions (target shape, §6 of directive)

Pages must call stable query functions, never touch tables. Current sanctioned
surface is `src/lib/site-data.ts`. The target shape when `src/lib/queries/` is
introduced (P0.3):

```
getInstitutions()          getInstitution(slug)
getInstitutionHistory()    getInstitutionPeople()
getInstitutionBranches()   getInstitutionFinancials()
getInstitutionDocuments()  getInstitutionActivities()   ← Activity is P10

getPeople()                getPerson(slug)
getFinancialOverview()     getFinancialHistory()
getNews()                  getDocuments()
getJobs()                  getResearch()
getActivities()            getCoverageStatus()
getSourceEvidence()
```

**Frozen:** the function names and the storage-agnostic guarantee. The
implementation may change (static snapshot → API → hybrid) without changing page
code. That is the whole point.

---

## 5. Write boundary — DEFERRED

Not implemented. No partial write path exists or may be created casually.

When it arrives (P11), the path is fixed:

```
USER → AUTHENTICATION → AUTHORIZATION → WRITE API → VALIDATION →
MODERATION → CANONICAL STORE → PROJECTION → PUBLIC SITE
```

Rules that apply from day one of implementation:

| Rule | Reason |
|---|---|
| Authorization enforced **server-side** | Hiding a button is not authorization |
| Scoped to resource/institution | `institution_admin` means Institution X only |
| Every write emits an `audit_logs` row | who / what / before / after / when / why |
| No client-supplied role or ownership | Never trust the caller |
| No borrower/member PII | Privacy boundary, frozen |
| Media binary → R2; metadata → DB | Do not put blobs in the relational store |

Roles (designed, not yet implemented): `anonymous`, `authenticated`,
`institution_admin`, `contributor`, `reviewer`, `operator`, `admin`.

---

## 6. Threats the boundary prevents

| Threat | Control |
|---|---|
| Browser reaching D1 | R5 static check |
| Page depending on generated shape | R6 static check + facade |
| SQL injection | Only repository issues SQL; parameters always bound |
| BOLA on write endpoints | Resource-scoped authorization (P11) — **not yet built** |
| Unrestricted resource consumption | Worker token bucket (per-isolate; see limits) |
| SSRF / open redirect | `safeRedirectTarget()`, `safeSegment()`, ingestion host allowlist |
| JSON rendered as HTML | `X-Content-Type-Options: nosniff` |
| Clickjacking | CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY` |

---

## 7. Known gaps at this freeze

Stated plainly rather than implied:

- **No authentication or authorization exists.** V1 is public read-only by design.
- **Rate limiting is per-isolate**, not global. Worker isolates share no memory.
  Exact limits need a Durable Object or KV counter.
- **CSP permits `'unsafe-inline'`** for script and style. The App Router emits
  inline bootstrap scripts that cannot be nonced under static export. Removing it
  requires abandoning static export — a real trade-off, not an oversight.
- **GitHub Pages ignores `public/_headers`** and cannot set response headers at
  all. The GitHub Pages deploy currently has **no CSP and no security headers**.
  Cloudflare Pages is the security baseline (`docs/security/SECURITY-POSTURE.md`).
- **The generated layer is the live read source, not the repository**, for every
  public page. This is transitional and tracked in `STORAGE-ADAPTER-STRATEGY.md`.

---

## 8. Change protocol

Any change to this boundary is an architecture change. Per directive §53, stop and
file:

```
ARCHITECTURE CHANGE PROPOSED:
WHY:
IMPACT:
ALTERNATIVES:
RECOMMENDATION:
APPROVAL REQUIRED: YES
```

Specifically frozen without approval: replacing the repository approach with
direct DB access, creating a second frontend data source, introducing a second
competing data model, adding a browser→DB path.