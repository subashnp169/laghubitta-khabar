# Laghubitta Khabar — Data Governance (Frozen)

Applies to every contributor, crawler, and AI tool. These are the developer commandments.

## The 20 commandments

1. Do not build a news portal first. Institution is the primary entity.
2. Every important external fact requires provenance (`sources`).
3. Never silently overwrite historical facts (`positions`, `data_assertions` with history).
4. Never delete evidence merely because newer information exists.
5. Never treat scraped information as verified automatically (default `UNVERIFIED`).
6. Official sources have priority (SOURCE-POLICY tiers).
7. Conflicting sources must remain visible to administrators (`data_conflicts`).
8. Personal data is restricted to publicly documented Tier-1/Tier-2 info. No employee scraping.
9. No AI-generated fact enters production without validation.
10. No financial number enters production without source + period + unit.
11. Frontend cannot directly access D1. API/DTO layer only.
12. Database schema is portable SQLite SQL. No Postgres-only features.
13. All schema changes use migrations (`migrations/000N_*.sql`; 53 canonical tables, 0001–0007).
14. Every crawler run is auditable (`ingestion_runs`, `ingestion_errors`).
15. Every public page shows source/freshness where appropriate.
16. Historical data must remain queryable (`valid_to` = NULL means "currently true").
17. Slugs are URLs, not database relationships. Slugs are permanent; renames get 301 via
    `slug_aliases`.
18. Build the data layer before expanding the UI.
19. Money integrity: amounts stored canonically (integer paisa / normalized crore, REAL for %).
    Display unit is UI metadata, not stored with the value.
20. Mergers/renames preserve history: `institution_relationships` (RENAMED_FROM, MERGED_FROM,
    MERGED_INTO) with `effective_at` + `source_id`.

## Laws of data

- **Current ≠ History.** A table that overwrites a time-dependent fact is a bug, not a feature.
- **Evidence ≠ Claim.** `sources`/`source_snapshots` hold evidence; `data_assertions` hold claims.
- **Conflicts surface, never hide.** Admin dashboard shows `⚠️ Conflicting CEO information`.
- **Freshness is per-field.** `field_refresh_policies` + `next_review_at`. UI: "Verified 12 days ago".
- **Reject, don't drop.** Failed/missing records remain queryable (with `verification_status`,
  `availability_status`, and reason) for audit. LINK_ONLY documents carry a NULL `r2_key` **by
  design** — `archived_locally=0` is valid, `r2_key` is only required for archived copies.
- **Link + hash, not host.** `official_url` + `content_hash` + `last_checked_at` are the evidence
  we always keep; the PDF bytes are archived only when `archive_policy` says so. Changing hash at
  the same official URL = a changed external document; record the change, never overwrite history.

## Verification workflow

1. Ingest → `UNVERIFIED`. 2. Hash-match higher tier → `AUTO_VERIFIED`.
3. Disagreement → `CONFLICT` + `data_conflicts` row. 4. Editor review → `HUMAN_VERIFIED` or
   `REJECTED`. 5. Past review date → `STALE`, re-crawl scheduled.

## Data ownership

- D1 = facts + relationships + metadata + events + indexes (≤10 GB hard cap, single-threaded).
- R2 = OPTIONAL archival evidence: PDF copies, source snapshots, logos. `archived_locally=1` +
  NON-NULL `r2_key` only for archived copies (LINK_ONLY documents are evidence-less by design).
- Budget Workers Paid ($5/mo): D1 Free row limits are enforced with hard failures since 2026-09-01
  (5M reads / 100k writes per day). Design reads to hit cache, not the DB.
- Index every column used in `WHERE`/`JOIN`/`ORDER BY` — row-based billing makes scans expensive.

## Migration rules

- One SQL file per change, ordered, in `schema/migrations/`.
- Never edit `schema.sql` in place after it's applied; append a migration.
- Migrations must be rerunnable/idempotent or versioned with a lock table (`schema_migrations`).

## Crawler rules

- Configurable source definitions only. No per-institution hard-coded crawlers.
- Every run: record `started_at`, `items_found`, `items_changed`, `items_new`, `items_failed`,
  `parser_version`, errors.
- Compute `content_hash`; if unchanged since last snapshot, skip reprocessing (but still store the
  new snapshot with `is_active` flags) — this gives the change-detection loop without re-extraction.