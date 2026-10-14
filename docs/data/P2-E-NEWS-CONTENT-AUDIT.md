# P2-E — News / Content Layer Audit

> Scope: build the canonical **content projection** for the sector news feed —
> one iteration over the frozen NRB evidence snapshot (`src/data/nrb.ts`) that
> feeds both the reader-facing pages (`/news`, `/news/[slug]`, `/alerts`) and
> the frozen `GET /api/news` contract — with a derived tier/scope vocabulary,
> honest zero counts for the tiers that hold no content, page/API parity by
> construction, determinism checks, and a full acceptance suite. No headline is
> invented; no document is summarised; no date is fabricated.
>
> Status: **P2-E = CLOSED**
> Owner: data layer. Evidence source: `src/data/nrb.ts` (frozen), `data/master/master.json`.
> Task id: P2-E (News / content). Roadmap phase: content ([docs/ROADMAP.md](../ROADMAP.md)).
> Preceding: [P2-A](P2-A-PEOPLE-POSITIONS-AUDIT.md) CLOSED, [P2-B](P2-B-BRANCHES-AUDIT.md) CLOSED, [P2-C](P2-C-FINANCIAL-AUDIT.md) CLOSED, [P2-D](P2-D-DOCUMENTS-JOBS-AUDIT.md) CLOSED.
> Follow-up: **P2-E not started** in preceding audits; this task closes it.

---

## 1. What P2-E did

| Artefact | Change |
| --- | --- |
| `src/util/activity.ts` | **REFACTORED to a single canonical iteration**: internal `NewsRecord`s built once by `newsRecords()` (62 regulatory + 93 distinct-document records, one shared sort), from which the feed (`allActivity()`) *and* the API (`lib/api/repository.listNews`) both derive. Feed shape, ids, titles, details, dates, labels, order — externally unchanged. |
| `src/util/activity.ts` | **+`EVENT_SOURCE_ID`** ("nrb-bfi-mid-may-2026") reconstructing the event source attribution the export dropped (see §3); **+`sourceTitleFor()`** registry lookup (replaces the hard-coded `"NRB BFI directory"` label); **+`trailingEvidenceUrl()`** parsing an event's own trailing `https://…` citation, else null. |
| `lib/repository/types.ts` | **+`NewsScope`** (`INSTITUTION`/`NRB`/`MARKET`/`MEDIA`); `NewsItemDto` **+`scope`** and `published_at` widened to `string \| null`; `ListNewsOptions` **+`scope?`**. |
| `lib/api/repository.ts` | **+`listNews()`** — the frozen `/api/news` implementer: scope/tier validation (422), scope filter, `meta.tier` counts (facet semantics), page/limit via the shared pagination helpers, publisher→tier/scope classification with `throw` on an unmapped publisher. |
| `lib/api/handler.ts` | **+`case "news"`** — the static api-server route now serves `GET /api/news`; previously absent. |
| `worker/src/index.ts` | **ALIGNED**: `meta.tiers` (wrong key) → `meta.tier` (contract key); **+`scope` validation** (422) and header; honest zeros comment. D1 `listNews` untouched (`_opts` warning pre-existed at HEAD) and still returns empty. |
| `scripts/smoke-api.ts` | **+section 09** (28 new checks): envelope, `meta.tier` counts, scope/tier filters + 422, pagination edges, page/API id-order parity, per-item evidence tracing. |
| `scripts/smoke-news-p2e.ts` | **NEW acceptance suite** (67 checks, PE-1…PE-10): canonical identity, evidence membership, date honesty, tier/scope derivation recomputed independently, no-fabrication, contract filters, page/API parity, master.json reconstruction lock, registry coherence, news tables empty. |
| `package.json` | **+`smoke:news-p2e`**. |
| `docs/API-CONTRACT.md`, `docs/PHASE-3-API-DESIGN.md` | news endpoint now served/implemented; divergence recorded (§8). |
| `docs/data/CANONICAL-MODEL.md`, `docs/data/P2-D-DOCUMENTS-JOBS-AUDIT.md` | cross-references updated. |

No builder was added and **no schema was touched**: the API is a pure runtime
projection over the already-frozen `nrb.ts`, so `durable:build` is unchanged.

---

## 2. Coverage

The content layer is **155 records**:

| Kind | Count | What it is |
| --- | --- | --- |
| regulatory event | 62 | structural changes the NRB BFI directory records (merger / acquisition / rename) |
| publication (distinct document) | 93 | NRB documents, collapsed by URL from the raw 97 listings |

- The 97 listings collapse to 93 because **4 documents are indexed under more
  than one source list** (e.g. "Interest rate structure as of (2083 Asar)" is on
  both the supervision archive and the quarterly interest-rate list). Both
  numbers are true and mean different things: the source catalogue keeps every
  listing; the content layer presents the collapsed set. (Pre-existing
  `distinctNrbDocuments()` behaviour, kept.)
- **Sources:** all records come from the 9 registered NRB sources in
  `nrbSummary.sources`; every one is published by *Nepal Rastra Bank*.
- **Tiers:** because every record is NRB-published about the NRB institution
  universe, all 155 classify as **tier `NRB`, scope `NRB`**; `OFFICIAL`,
  `KHABAR`, `MEDIA` and the scopes `INSTITUTION`, `MARKET`, `MEDIA` are
  honestly **zero** (see §5).

---

## 3. Provenance and identity

The evidence chain for the two kinds differs, and each is handled transparently:

- **Documents** carry their full evidence in the export: `sourceId`,
  `sourceTitle`, `officialUrl`, `publishedAt`. The content layer reads these
  verbatim; `meta.source` is the **registry title** looked up by `sourceId`
  (measured: `sourceTitle` carried in the 97 listings equals the registered
  title in 97/97 cases, so the lookup is not a relabel).
- **Regulatory events** are the one place the pipeline drops attribution:
  `scripts/generate-nrb-data.ts`'s SELECT omits `source_id`, so `nrb.ts` events
  cannot carry it. The surviving artifacts still name the source:
  - `data/master/master.json` — all 62 `timeline[]` rows carry
    `source_id: "nrb-bfi-mid-may-2026"`, and `universeSnapshot.source_id` is
    the same;
  - `scripts/nrb-ledger.ts` copies it into `regulatory_events` row-by-row as
    `e.source_id ?? uniSource`.
  
  `EVENT_SOURCE_ID` restates that measured value in code, and smoke **PE-8**
  locks it to `master.json` on every run: any future export whose timeline stops
  agreeing fails the suite rather than drifting silently.

- **Event dates** are the documented fallback: the ledger's `occurred_at`
  column is `NOT NULL`, so every event that carried no real date was written
  with the observation date `nrbSummary.observedAt` (`"2026-06-20"`), counted as
  `events_occurred_at_fallback: 62` in `data/nrb/nrb-ledger-report.json`. P2-E
  carries them verbatim — **the page and API say exactly what the ledger says**
  — and flags them (§6), it does not guess a real date. (Auditor's honesty
  concern: all 62 events share one fallback date, so nothing about "20 June
  2026" beyond "this is when the snapshot was observed" is being claimed.)

---

## 4. Two surfaces, one canonical projection — never merged

Before P2-E, the feed was built by mapping events and documents into
`ActivityItem`s directly. The API had **no** news route. After P2-E:

- `src/util/activity.ts` builds the canonical `NewsRecord[]` **once**
  (`newsRecords()`: identical content + the source evidence the feed does not
  render), sorted with one shared comparator.
- `allActivity()` maps records *down* to the feed shape (explicit field map —
  serialized page payloads carry no source-evidence fields), and
  `lib/api/repository.listNews` maps the same records *up* to `NewsItemDto`.
- **Parity is therefore structural**: the page cannot disagree with the API —
  the same array produces both. Smoke PE-7 asserts id order, titles and
  snippets agree for all 155 records by deep comparison.

No second interpretation exists anywhere: `NewsRecord` → `ActivityItem` and
`NewsRecord` → `NewsItemDto` are the only two mappings, and the D1/worker path
returns honest empties rather than a third interpretation (§10).

---

## 5. Tier & scope vocabulary — derived, never defaulted

- `tier` = who published; `scope` = what the item is about. Both are derived
  from the record's **registered source publisher** via two small maps
  (`TIER_BY_PUBLISHER` / `SCOPE_BY_PUBLISHER`), never from ids, titles or URLs.
- Every publisher present today maps to `NRB`/`NRB`. The maps are **closed**: a
  publisher with no mapping makes `classify()` **throw**, so a future
  OFFICIAL-tier source (an institution's own site) cannot silently collapse
  into a plausible-but-wrong tier.
- `meta.tier` counts are a **facet**: computed over the scope-filtered set,
  *before* the tier filter. `?tier=KHABAR` therefore returns an empty list
  while `meta.tier` still shows the full `{OFFICIAL:0, NRB:155, KHABAR:0,
  MEDIA:0}` breakdown a front-end needs to render a grouped list. Smoke PE-4/PE-6
  prove both filter directions and the unchanged-count property.
- `OFFICIAL`/`KHABAR`/`MEDIA` cards are deliberately **zero, not hidden**:
  the API must report the vocabulary exists and is empty, and the static route
  and worker had to agree on the envelope (see §8).

---

## 6. No fabrication — fields deliberately honest

Every fabrication-prone field is traced to a record, or is explicitly absent:

| Field | Rule | Measured today |
| --- | --- | --- |
| `published_at` | event = ledger's `occurred_at` (all `observedAt` fallback — §3); document = its listing's `publishedAt` | 0 null, 0 invalid; events all `2026-06-20` |
| `title` | event = `${EVENT_PHRASE} ${event.title}` (closed phrase vocabulary); document = listing title verbatim | PE-5 recomputes every title independently |
| `snippet` | = the feed's `detail` line: for events the institution's name, for documents the literal `"Document published; contents not read"` | no document contents ever summarised |
| `source_id` | document = listing's `sourceId`; event = `EVENT_SOURCE_ID` locked to master.json | all 155 trace |
| `meta.source_url` | document = `officialUrl`; event = the trailing `https://…` inside its own description, **else null** (10 events end an internal `Evidence: evt-…` id and have no URL — null, never a "likely" link) | 52 with URL, 10 null |
| `meta.last_verified_at` | `nrbSummary.generatedAt` date (`2026-09-26`) for **all** records — a property of the frozen snapshot, not of any single observation | ≥ every record's own date (smoke PE-3) |
| `meta.verification_status` | `UNVERIFIED` (P2-C convention; nothing here has been read or corroborated) | all 155 |

`published_at` and `NewsItemDto` stayed **nullable in type**: a future undated
record must report `null` honestly rather than force a coercion to a placeholder
string. Today nothing is null, and smoke locks that.

---

## 7. Conflicts

**None to compute — recorded, not hidden.** The P2-A/B/C/D conflict machinery
operates on assertion rows where the *same claim* arrives from multiple sources.
The news/content layer has no assertion layer: `posts`, `news` and
`post_sources` are empty in every environment (store.db and lk.db — smoke PE-10
asserts 0 rows), and `src/data/nrb.ts` is a single frozen, already-resolved
snapshot. There is nothing to cross-check; manufacturing a "conflict report"
from one evidence source would be decoration, so P2-E does not carry one.

---

## 8. API exposure

- **`GET /api/news`**

  ```
  ?scope=INSTITUTION|NRB|MARKET|MEDIA   (default: all)
  ?tier=OFFICIAL|NRB|KHABAR|MEDIA      (default: all)
  ?page&limit                           (default 20, max 100)
  ```

  Contract shape: collection envelope `{data, pagination, meta:{tier:{OFFICIAL,NRB,KHABAR,MEDIA}}}`.
  Unknown tier/scope → `422 VALIDATION`; values are accepted case-insensitively.
  Served by:
  1. **static api-server** (`lib/api/handler` → `lib/api/repository.listNews`)
     — real, 155 records;
  2. **Worker** (`worker/src/index.ts` `handleNews`) — same validation and
     envelope key, but reads D1 (`repo.listNews`), which holds **no news rows**,
     so it returns honest zeros.
- **Known divergence (recorded):** the worker and the static route answer
  differently *by construction* — D1 has no news evidence yet, the static route
  derives from the frozen NRB snapshot. Both are honest about what they have;
  the divergence is the evidence gap, not a shape disagreement. P2-D precedent:
  documented in §10, resolved when a news ingestion seeds D1.
- **Worker alignment fixes:** the meta key was `tiers` (wrong — diverged from
  the frozen contract `meta.tier`); it is now `tier`. Scope was unvalidated; it
  now 422s. `smoke-worker` asserts both, plus `meta.tier` presence and absence
  of the old `tiers` key.
- `NewsItemDto.slug === id` — the same id the `/news/[slug]` static route
  already serves, so a consumer can follow either surface. (`smoke-worker` and
  smoke section 09 cover parity.)

---

## 9. Pages

- `/news`, `/news/[slug]`, `/alerts` and every other consumer of
  `@/util/activity` are **unchanged in behaviour** — same ids, titles, details,
  dates, labels, order (`smoke:api` 115 checks and the Next SSG build pass
  unmodified).
- **One visible label change:** regulatory rows previously showed
  `sourceTitle: "NRB BFI directory"` (a descriptive, non-registered label).
  P2-E derives it from the source registry (`EVENT_SOURCE_ID` →
  `"NRB BFI List in English (Mid May 2026)"`), so the feed, the API
  (`meta.source`) and the registry now print the *same source-owned title*.
  Audited reason: a single canonical label per record, and the label must be a
  real registry entry a consumer could verify.

---

## 10. D1 / worker read model

- `listNews` (D1 `lib/repository/d1.ts` and `mock.ts`) takes
  `ListNewsOptions` with the new `scope` and returns `Paged<NewsItemDto>`; both
  currently return honest empty collections because **the `news`/`posts`/
  `post_sources` tables have 0 rows everywhere** (smoke PE-10 re-checks
  store.db and lk.db).
- The worker wires `tier`/`scope` validation and `meta.tier` zeros to it. The
  "Phase D fills real counts" comment is replaced with the honest statement of
  *why* zeros are the correct answer today and where the real counts come from
  (the static route).
- This mirrors the P2-A/B/C/D pattern: the readers are correct projections;
  seeding is a deployment concern.

---

## 11. Determinism and build chain

- The content layer is **a pure runtime projection** — no builder, no generated
  module. `newsRecords()` reads the frozen `src/data/nrb.ts` arrays and nothing
  else (no cache, no clock, no I/O), so two calls in the same process are
  byte-identical (PE-1) and the durable build chain is untouched.
- Worst case if `nrb.ts` is regenerated by a future crawl: the projection
  re-derives and the suites (155-count, 93-distinct, 52/10-URL split,
  source-id/master lock) re-verify it automatically — a changed snapshot fails
  loudly instead of publishing a silently different feed.

---

## 12. Verification

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | clean |
| Discipline (R1–R6) | `npm run check:discipline` | `OK — no discipline violations` |
| Canonical identity | `npm run identity:verify` | `OK — master.json intact` |
| Durable chain | `npm run durable:build` | full chain rebuilt OK |
| Full build (SSG) | `npm run build` | OK; static export complete |
| Link & anchor audit | `node scripts/audit-export.cjs` | 395 pages, **0 failures** |
| API suite | `npm run smoke` | **115 passed, 0 failed** (87 pre-existing + 28 new news checks) |
| News/content acceptance | `npm run smoke:news-p2e` | **67 passed, 0 failed** (PE-1…PE-10) |
| Documents+jobs (regression) | `npm run smoke:documents-jobs-p2d` | 74 / 0 |
| People acceptance (regression) | `npm run smoke:people-p2a` | 32 / 0 |
| Branch acceptance (regression) | `npm run smoke:branches-p2b` | 33 / 0 |
| Financial acceptance (regression) | `npm run smoke:financials-p2c` | 31 / 0 |
| Worker | `npm run smoke:worker` | all checks passed (incl. new scope + `meta.tier` asserts) |
| Worker security | `npm run smoke:worker-security` | all checks passed |
| People lifecycle | `npm run smoke:people-lifecycle` | 64 / 0 |
| Ingest security | `npm run smoke:ingest-security` | 50 / 0 |
| Lint | `npm run lint` | **0 findings in any P2-E file** (22 errors remain pre-existing P0-era `require()`/`no-explicit-any` in `.cjs` scripts; 1 pre-existing `_opts` warning in `d1.ts`) |

PE coverage, in short: canonical identity (155 = 62 + 93, 97 → 93 by 4 shared
URLs, ids unique, deterministic); evidence membership (every record traces to a
`nrb.ts` id, hrefs routable); date honesty (0 null/invalid, events = observedAt
fallback, last_verified ≥ max date); tier/scope recomputed independently of the
code under test and locked to all-155-NRB/NRB; nothing fabricated (titles
recomputed from the phrase vocabulary, snippets = detail, 52/10 URL split,
institution slugs); contract filters incl. 422 and facet-count semantics;
page/API deep parity; the master.json source-attribution reconstruction lock;
registry coherence; and the news/posts/post_sources tables at 0 rows.

---

## 13. Blockers carried forward

- **`src/data/nrb.ts` is orphaned-derived**: its input temp DBs are gone, so it
  is frozen and can only be regenerated by a re-crawl. The content layer runs
  over it as-is (SOURCE-OF-TRUTH-MATRIX row 9).
- **Event dates are the `observed_at` fallback for all 62 events.** Carried
  verbatim for ledger/page/API consistency and flagged in §3/§6; a future crawl
  that records real `occurred_at` dates fixes the feed without code change.
- **D1 has no news rows** → `listNews` returns honest empty collections; the
  worker/static divergence (0 vs 155) is the evidence gap (§8, §10) and must
  not be "fixed" by seeding fabricated news.
- **API divergence to resolve:** the `/api/news` static-route answer (155) vs
  worker answer (0) differs until a news ingestion seeds D1. Contract shape
  already agrees.
- **Not committed:** everything above sits uncommitted (see §14); the staged
  evidence DBs and modified `.gitignore` must not be committed without
  approval.

---

## 14. Git state (at completion — nothing committed by this task)

```
HEAD:       14b96d4   (pre-P2-E baseline; P2-A…P2-D work also uncommitted)
staged:     13   (evidence DBs under data/pilot/evidence/, added earlier)
unstaged:   <same 45 modified files as P2-D + P2-E edits>
untracked:  <same 31 entries as P2-D + scripts/smoke-news-p2e.ts + docs/data/P2-E-NEWS-CONTENT-AUDIT.md>
modified:   src/util/activity.ts, lib/repository/types.ts, lib/api/repository.ts,
            lib/api/handler.ts, worker/src/index.ts, scripts/smoke-api.ts,
            package.json, docs/API-CONTRACT.md, docs/PHASE-3-API-DESIGN.md,
            docs/data/CANONICAL-MODEL.md, docs/data/P2-D-DOCUMENTS-JOBS-AUDIT.md,
            .gitignore (from earlier phases)
```

No `git add`/`commit`/`reset`/`clean`/`discard` was performed. The staged
evidence databases and the `.gitignore` modification must not be committed
without explicit approval.

---

## 15. Verdict

**P2-E = CLOSED.** The news/content layer is now a single canonical projection:
155 records (62 regulatory events + 93 distinct NRB documents) derived once in
`src/util/activity.ts` and served identically to the `/news` pages and the
frozen `GET /api/news` contract, with the scope/tier vocabulary derived from
registered source publishers (`OFFICIAL`/`KHABAR`/`MEDIA` honestly at zero), a
reconstructed event source attribution locked to `data/master/master.json` on
every run, every fabrication-prone field traced or explicitly absent (event
dates carried as the ledger's documented `observed_at` fallback and flagged),
page/API parity structural rather than coincidental, the worker aligned to the
contract (`meta.tier`, scope validation, honest zeros), and the full
verification suite green — 67 P2-E checks, 115 API checks, all prior-phase
suites, worker + security suites, deterministic by construction, and lint clean
in every P2-E file. **No schema change; no builder change; no fabricated date,
title, snippet or URL.**