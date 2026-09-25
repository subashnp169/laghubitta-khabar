# Laghubitta Khabar — Engineering Discipline (Operations)

Operating rules for every contributor, crawler, and AI tool. These complement the
data commandments in `DATA-GOVERNANCE.md` (facts/evidence) with hard **engineering
separation rules** (environments, credentials, destructive actions). `npm run
check:discipline` enforces R2/R3/R5 statically; the guard module enforces R1/R4 at
runtime. Run it in CI on every PR.

## The rules

### R1 — No production shortcuts. Separate dev / local / staging / production.

- `LK_ENV` is the single source of truth for environment context:
  `(unset | development | local)` = local tooling allowed, anything else is blocked.
- Committed config is **local/dev by default**. The only committed Cloudflare
  config is `worker/wrangler.toml` (placeholder D1 id `00000000-...`, clearly
  marked "placeholder — local only").
- Staging and production configs are **never committed** to the repo, and are never
  created from scratch by hand. Create them from the templates:

  ```bash
  cp worker/wrangler.staging.toml.example    worker/wrangler.staging.toml
  cp worker/wrangler.production.toml.example worker/wrangler.production.toml
  # then fill in the real D1 database ids (see R2) — these filled files stay gitignored.
  ```

- Enforce with `scripts/guard-env.cjs`: any script that writes, deletes, or stages
  data **must** require it first (`const { guardOrExit } = require('./guard-env.cjs');
  guardOrExit('<script-name>')`). It throws/exits when `LK_ENV=staging|production`.

### R2 — Never put production credentials or real D1 ids in source.

- No real Cloudflare D1 `database_id`, `cf-<account id>`, API tokens, AWS keys, or
  credential URLs in any committed file — including docs.
- Templates use token placeholders (`REPLACE_WITH_STAGING_D1_ID`,
  `REPLACE_WITH_PRODUCTION_D1_ID`); the all-zero placeholder
  (`00000000-0000-0000-0000-000000000000`) denotes local-only.
- Enforced by `scripts/check-discipline.cjs` (R2) in `npm run check:discipline`.
- Local secrets (if any) go in `worker/.dev.vars` (gitignored, see
  `worker/.dev.vars.example`); real secrets live in the Cloudflare secret store /
  CI secret vault, injected at deploy time — never in this repo.

### R3 — Never run destructive commands against production.

- Destructive statements (`DROP TABLE`, `DELETE FROM`, `TRUNCATE`, `unlinkSync`)
  are only legal in **local/dev scripts** that call `guard-env.cjs` first or pass an
  explicit `LK_ENV` gate. Anything unguarded is flagged by `check-discipline.cjs` (R3).
- There is intentionally **no destructive-capable code path** that can reach a
  staging/production D1: seed/migration tooling is sqlite-file-local
  (`better-sqlite3`) and refuse to run when `LK_ENV` is not local.

### R4 — Never seed test data into production.

- Seed data (`scripts/seed.cjs`) writes only a **local sqlite file** (`lk.db`,
  gitignored) and is blocked outside local `LK_ENV`. It never writes to D1.
- The local `lk.db` must never be committed (`.gitignore` → `*.db`, `lk.db`).
- Any future prod-data path must be an explicit, logged, idempotent migration run
  through a reviewed deploy step — not the seed script.

### R5 — Never expose production database bindings to browser code.

- The Next static frontend renders from `data/...` (build-time snapshot). Browser
  (`.tsx`/`.jsx`) files must **never** import `lib/repository` or `lib/api`.
- All live data reaches the browser over HTTP through the Worker API
  (`worker/` endpoint). The Worker is the only D1-bound process —
  `env.DB` exists only there.
- Enforced by `check-discipline.cjs` (R5) scanning every `.tsx`/`.jsx`.

## Command reference (all run from repo root)

```bash
npm run typecheck        # tsc --noEmit (strict)
npm run seed             # node scripts/seed.cjs  (local lk.db only; LK_ENV-gated)
npm run smoke            # repository contract, mock + local adapters (never staging/prod)
npm run smoke:worker     # Worker fetch handler over a local D1 shim (never staging/prod)
npm run check:discipline # static audit of R2/R3/R5   → run in CI
npm run build            # next build (static + SSG)
```

## Deployment (staging → prod, in this order)

1. `npm run check:discipline && npm run typecheck && npm run smoke && npm run smoke:worker`
2. Create/fill gitignored `worker/wrangler.staging.toml` from the template (R2).
3. `wrangler deploy --config worker/wrangler.staging.toml` (staging D1 id).
4. Run migrations against the **staging** D1 (never `schema.sql` blind; review).
5. Smoke the staging Worker endpoint against staging D1 before any prod step.
6. Only then: create/fill `worker/wrangler.production.toml`, deploy, migrate, verify.
7. Never combine steps 3–6; never point a local tool at the prod D1 id.

## FAQ

- **Why is `lk.db` gitignored?** It is the local seeded database (R4). Committing it
  would leak test data and couple the repo to a machine-local artifact.
- **Why templates instead of env blocks in one file?** Cloudflare `[env.*]` blocks
  still embed the real id in the committed file. Separate gitignored files keep
  real ids out of the repo entirely.
- **Can I verify a migration outcome locally?** Yes — `scripts/seed.cjs` rebuilds
  `lk.db` and the integrity checks report orphans/coverage; smoke tests then verify
  behavior against that exact file.