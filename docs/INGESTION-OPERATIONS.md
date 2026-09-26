# Laghubitta Khabar — Ingestion Scheduling & Control Plane

Decision record for the operational layer on top of the capability engine. Builds on
`docs/PHASE-15-DESIGN.md` and `docs/OPERATIONS.md` (R1–R5). Scope: what runs when,
how operators pause/resume/retry, and how the control room reflects schedule state.

## Status

Adopted. Implemented in M1.6 (schedules + control plane). Deterministic only (AI OFF),
no schema change, no publication from any schedule run.

## 1. Cadence is capability-based (frozen default map)

Every ingest source runs as a unit, but its **refresh cadence is driven by the most
frequently-refreshable capability it carries** (sources fetch everything on a run, so
the tightest capability wins). Cadences come from two sources, overridable per source:

1. `lib/ingestion/schedule.ts` — the frozen default map. One row per frozen capability
   kind (`CAPABILITY_KINDS`, `lib/ingestion/types.ts`):
   - frequent (≈ hourly):  `NEWS 60`, `CAREER_PAGE 60`, `RSS 60`
   - periodic (≈ daily):   `WEBSITE 1440`, `SOCIAL 1440`, `REPORTS 1440`, `API 1440`
   - slow (weekly):         `SITEMAP 10080`, `BRANCH_DIRECTORY 10080`
   - `DOCUMENT_ARCHIVE 1440`
   - Anything without a recognized capability → default `1440`.
2. `config_json.schedule` — optional per-source override, JSON only (no schema change):

   ```json
   { "schedule": { "NEWS": 30 } }
   ```

   Keys must be frozen kinds; values are integers in `[15, 43200]` minutes. An unknown
   key or malformed value raises `ScheduleConfigError` (fail loud, never silently ignore).

Effective source cadence = `min` of the cadences of the source's configured capability
kinds (override first, then frozen map). Validated/computed in `schedule.ts`:

- `effectiveCadenceMinutes(capabilities, overrides)`
- `computeDue(lastRunAt, cadence, now)` → `{ nextDueAt, isDue }`; `lastRunAt === null`
  ⇒ due immediately.
- `cadenceBucket(minutes)` → `"frequent" | "periodic" | "slow"` for the control room.

## 2. Ops CLI — `npm run ops <verb> -- <db>`

`scripts/ops-cli.ts`. The existing `npm run control -- <db>` stays **read-only** and
full; ops adds the actionable verbs over the same local sqlite DB:

| verb | effect |
| --- | --- |
| `status` | compact operations view: sources (enabled/paused), health counts, cadence bucket counts, due-now list. No writes. |
| `schedule` | schedule manifest (dry) with due list; also writes `data/control/schedule-report.json`. No DB writes. |
| `run [--due\|--all\|--source=X]` | engine runs for the matching sources (default due). Skips paused. Writes runs/items/snapshots/errors. |
| `retry <source>` | force a run now for one source (fails loudly if it is paused). |
| `pause <source\|--all>` | `enabled = 0` (scheduler must skip paused sources). |
| `resume <source\|--all>` | `enabled = 1`. |

DB resolution: `--db <path>` → `LK_OPS_DB` → `data/pilot/pilot-run-report.json#dbPath`.
Write verbs (`run`, `retry`, `pause`, `resume`) must pass `guard-env.cjs`
(R1/R3/R4); read-only verbs do not. `run`/`retry` reuse the same engine composition as
the source's own intake flow (`MFB_WEBSITE` → pilot set; `NRB` → NRB set) so ops runs
produce identical evidence semantics. Budgets come from `config_json.budget`
(M1.5.1 storage) falling back to `data/pilot/pilot-budget.json` defaults.

## 3. Control room reflects schedule (no new generator)

`pilot-export.ts` (existing `npm run pilot:export`) is extended to emit, per source:
`cadenceMinutes`, `cadenceBuckets` (sorted unique capability cadences), `nextDueAt`;
plus `schedule` summary counts (frequent/periodic/slow, due-now, paused). `/ingestion`
shows a Scheduling strip from the same `pilot.ts` data. No action verbs in the static
control room — Retry/Pause/Resume are CLI (operators' job, not the public page).

## 4. Hard constraints

- No schema change: cadence lives in code + `config_json.schedule`.
- Deterministic only: AI/OCR/browser OFF in every run path.
- Schedule runs write only the local sqlite DB given; never `lk.db`, never D1, never
  the public site.
- `enabled = 0` is authoritative: `run`/`run --due`/`run --all` must skip it;
  `retry` must refuse it.
- Schedules are advisory here — this repo has no cron/worker trigger yet. The ops CLI
  is the trigger; Cloudflare scheduled triggers are future work in Phase 1.6+
  (`worker/wrangler.toml` remains trigger-free).