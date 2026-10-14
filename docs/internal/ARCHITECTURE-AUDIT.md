# Architecture Audit & Strategy Review — 2026-10

Read-only audit of `master` plus a review of the externally supplied strategy
plan ("the plan"). Records what was measured, what we adopt, what we reject, and
what stays undecided. Companion: `FRONTEND-BACKEND-ORGANIZATION.md` for the
operating manual.

All counts below were measured, not estimated. Reproduce with the commands in
§7.

---

## 1. Headline

The **evidence engine works and is well tested**. The **project does not have a
durable canonical store**. Evidence accumulates in dated pilot databases, the
canonical database holds only the institution universe, and the live site reads
generated TypeScript. That single structural gap is the reason work feels like it
keeps restarting.

---

## 2. Measured findings

**F1 — The frontend has no data layer; it has a generated-TypeScript layer.**
24 route pages + 3 components + 2 utils import `@/data/*`. **Zero** frontend
files import `lib/repository` or `lib/api`. There is no `src/app/api` and no
route handler anywhere in `src`. The 15,759-line `lib/` stack reaches the live
site through exactly one 27-line file, `scripts/api-server.ts`.

*This is not a bug — R5 forbids it by design.* The intended path is build-time
projection. The finding is that the projection layer was never formalized, which
is what this audit's code changes fix.

**F2 — Three sources of truth, and the "canonical" one is the emptiest.**

| Store | Contents |
|---|---|
| `lk.db` (1 MB, 53 tables) | 51 institutions, 120 aliases, 62 timeline events, 51 coverage rows, 51 official links, 51 outbound links, 21 sources, 10 ingestion sources, 8 field policies. **All 44 other tables empty**, including `data_assertions`, `data_conflicts`, `source_snapshots`, `validation_results`, `branches`, `people`, `financial_metrics`, `interest_rates`, `jobs`, `users`, `roles`. |
| `data/pilot/evidence/*.db` (13 files, ~18 MB) | The actual extracted evidence: **5,083 `data_assertions`, 1,458 `source_snapshots`** (P0.2 measured). |
| `src/data/*.ts` (~1 MB) | What users actually see. |

**F3 — The evidence engine works; it has no memory.**
Assertions are proven at scale: 2,482 in the base snapshot, 1,773 branch, 629
people, 153 financial, 38 career. But every run writes a **new dated DB**, so
history accumulates as parallel snapshots rather than as one evolving store.

**F4 — Normalized tables are decorative.**
`/branches/`, `/people/`, `/financials/`, `/interest-rates/` all render live
content while their backing tables are empty everywhere. The real chain is
`assertions → bespoke export script → hand-shaped TS`.

**F5 — The institution universe is the strongest asset.**
51 records sourced from `nrb-bfi-mid-may-2026`, grade A, `asOf 2026-05-15`,
`verifiedOn 2026-06-20`, with per-field evidence grades, aliases, `coverageType`,
and `operationDateIsJointAfterMerger`. This should anchor the next phase.

**F6 — Edges are 100% NRB today.**
No institution has a `websiteStatus` above `candidate`; every `officialWebsite`
is `null`. Branding, social and outreach features have nothing to render.

**F7 — Zero enforced organization existed for the data boundary.**
R5 was enforced; the generated-data boundary was not. Fixed by R6 this cycle.

---

## 3. The plan: what we adopt

| Plan element | Decision | Note |
|---|---|---|
| Evidence-first observatory positioning | **Adopt** | Matches `ARCHITECTURE.md` vision. |
| Frontend dumb, never touches D1 | **Adopt** | Already R5; now actually true by construction. |
| One canonical model, many views | **Adopt** | Needs §2 F1/F2 fixed first. |
| Keep static export | **Adopt for now** | Cheapest SEO-per-rupee; revisit at F7 decision. |
| Optional vendor data, never a dependency | **Adopt** | MIS vendors (MicroBanker, Uranus, Softoriel, Premium, Finsoft) already model center/group/branch. We integrate; we do not replace. |
| Activity as a future object, gallery as a view | **Adopt, deferred** | Correct modelling; not now. |
| Source hierarchy NRB → filings → media | **Adopt** | Already `SOURCE-POLICY.md`. |
| One-person admin constraint | **Adopt** | Real and binding. |
| No ad / data-licensing dependency | **Adopt** | Research supports it (see §5). |
| Legal gate before member media | **Adopt** | Press and Publication Act 2048/2082 needs Nepali counsel. |

## 4. The plan: what we correct

1. **"Frontend bypasses the repository in many places" — inaccurate.** It bypasses
   it everywhere. Treat this as an unmade decision, not incremental cleanup.
2. **Missing prerequisite.** The plan's P1/P2 assume a canonical database that
   accumulates. There isn't one (F3). Until that is decided, P1 re-seeds and P2
   re-runs will keep producing snapshots, not history.
3. **It understates what exists.** "Build NRB ingestion" — `nrb-ingest.ts`,
   `nrb-ledger.ts`, `generate-nrb-data.ts` and a 104 KB `src/data/nrb.ts` already
   exist. "Build the ingestion pipeline" — 15,759 LOC with canonicalizer,
   discovery, fetcher, structured extractor, validators, review, 60+ smoke tests.
   The correct move is **adopt and give it memory**, not rebuild. A rewrite here
   would destroy the most valuable asset in the repo.
4. **"One canonical model" is currently untrue in the type system.** Four
   overlapping institution shapes exist (schema row, `InstitutionSummary`/
   `InstitutionDetail`, `src/data` `Institution`, D1 row). They agree by
   convention, not construction.
5. **"Retire dead paths" must not delete `lib/repository`.** The ~16 K tested
   lines are the only component that can ever support writes, a public API, or
   non-static delivery. Archive nothing until the read-plane decision is made.
6. **It defers the emotional core entirely.** "Everyone connected" gets nothing
   near-term. But the human graph is *already modeled* (`people`, `positions`,
   `committees`, with `appointed_at`/`ended_at` and `source_id`) and already
   renders. Deepening **verified human records** is the cheapest real expression
   of that vision — an extension, not a new subsystem.

---

## 5. Monetization, corrected order

Research findings, all directional rather than forecasts:

- Nepal ad economics are weak: ~$1–$5 RPM per 1,000 pageviews, $0.01–$0.05
  Nepali CPC; international English traffic prices far higher. Ads on an
  unknown-traffic directory produce noise, not signal.
- Standalone microfinance data licensing has weak precedent (MIX charged roughly
  $486–$24,000/yr before access was reopened under CC-BY).
- Donor categories worth targeting (World Bank, UNCDF, CGAP, ADB, GIZ, KfW,
  JICA) — targets, not endorsements, and never a dependency.

Revised ladder:

1. **Research / data services and sector reports** — validate in parallel from day
   one. `data_assertions` + `source_snapshots` + `document_extractions` is exactly
   the provenance substrate a paid sector audit would buy. It is the only line
   item that pays for evidence discipline rather than exploiting it.
2. **Institution presence** — profile, verified logo, analytics.
3. **Grants / research partnerships.**
4. **Vendor and MIS partnerships** — optional data exchange.
5. **Ads / SEO** — a side effect of authority, not a business plan.

Constraints: paid presence must never alter factual verification or ranking.

---

## 6. Re-sequenced phases

| Phase | Work | Change vs plan |
|---|---|---|
| P0 | Architecture audit | **Done** — this document |
| P0.5 | Decide the durable canonical store; make runs append to it | **New — the true blocker** |
| P1 | Canonical NRB universe anchored on the existing 51 records | Data already exists |
| P2 | Adopt existing NRB ingestion + ledger into the store | **Build → adopt** |
| P3 | Reconcile the four institution shapes into one | **New** |
| P4 | Versioned public API | Deferred |
| P5 | Execute the read-plane decision (projection vs runtime fetch) | **New, must follow P3** |
| P6 | Bilingual enforcement | Deferred |
| P7 | Institution-authorized contributions | Deferred, legal gate |
| P8 | Trusted field contributions | Deferred |
| P9 | Media and consent | Deferred, legal gate |
| P10 | Geography and map | Deferred |

---

## 7. How to reproduce these findings

```bash
npx tsc --noEmit                      # 0 errors
npm run build                         # 334 routes
node scripts/audit-export.cjs         # 335 pages, 13,783 links, 1,463 anchors, 0 failures
npm run smoke                         # 79 passed
npm run smoke:worker                  # all checks passed
npm run smoke:worker-security         # all checks passed (new this cycle)
npm run smoke:people-lifecycle        # 64 passed
npm run check:discipline              # 0 violations (R1-R6)
```

Row counts:

```bash
node -e "const D=require('better-sqlite3');const db=new D('lk.db',{readonly:true});\
for(const t of db.prepare('select name from sqlite_master where type=?').all('table'))\
console.log(db.prepare('select count(*) c from '+t.name).get().c, t.name)"
```

Direct `@/data/*` imports outside the facade:

```bash
grep -rn "@/data/" src --include=*.ts --include=*.tsx
```

---

## 8. Decisions required from the owner

1. **Read plane:** keep build-time projection (status quo, enforced by R6) or move
   to runtime API fetches (always fresh, loses static-export benefits)?
2. **Durable store:** make one SQLite/D1 store append-only across runs, and if so
   which is canonical — local SQLite with export, or D1 directly?
3. **Human graph first?** Build verified CEO/board/tenure across the 51
   institutions before branches. This is the highest-value expression of the
   "people connection" vision and the schema already supports it.
4. **Hosting:** move CI from GitHub Pages to Cloudflare Pages so `public/_headers`
   and the security baseline actually apply.
5. **Language:** confirm bilingual rather than English-first.
6. **Revenue validation:** research concrete monetization prospects now, or after
   P1 is stable?