# V1.3 Pilot approval request — ingestion recovery

> Status: **AWAITING OWNER APPROVAL.** No ingestion has been executed.
> Prepared: 2026-10-28. Baseline HEAD `40fdfc3` (V1.2, clean, in sync).

## 1. Verified Git/database baseline

- Branch `master`, HEAD `40fdfc3`, working tree clean, in sync with origin.
- Tag `v1.0.0` on `b0b03fd` (unchanged).
- Durable store: 51 institutions, 43 with assertion data, 5083 assertions, 229 conflicts (all OPEN), 264 runs (217 SUCCESS, 47 PARTIAL), 1458 snapshots, 57 sources.
- 8 pilot-stub institutions with 0 assertions (mfi-015, 032, 033, 039, 044, 046, 050, 051).

## 2. Candidate ranking (evidence-based, no network performed)

All 8 have a registered, enabled source with an HTTPS URL and 0 prior runs/errors. None has been crawled, so reachability, parser compatibility, and content quality are unverified. Ranking by available evidence only:

| Rank | Institution | Source | URL | Rationale |
|---|---|---|---|---|
| 1 | mfi-015 Vijaya Laghubitta | vlbs-website | https://vlbs.com.np | Short .com.np domain, institution name embedded, HTTPS, enabled, 0 errors |
| 2 | mfi-033 Ganapati Laghubitta | ganapatimicro-website | https://ganapatimicro.com.np | Same profile |
| 3 | mfi-032 Gurans Laghubitta | guranslaghubitta-website | https://guranslaghubitta.com.np | Same profile |
| 4 | mfi-050 Sanjeevani Laghubitta | sanjeevanilaghubitta-website | https://sanjeevanilaghubitta.com.np | Same profile |
| 5 | mfi-051 Aviyan Laghubitta | aviyan-website | https://www.aviyanlaghubitta.com | Same profile |
| 6 | mfi-039 Manushi Laghubitta | manushilbs-website | https://www.manushilbs.com | Same profile |
| 7 | mfi-046 Shrijanshil Laghubitta | shrijanshil-website | https://shrijanshil.org | .org domain (less typical for MFI) |
| 8 | mfi-044 NESDO Samriddha | slbs-website | https://slbs.nesdonepal.org | Subdomain of nesdonepal.org (host allowlist risk) |

No candidate can be confirmed ready without a network check. The ranking above reflects domain/identity confidence only; reachability and parser compatibility are unknown.

## 3. Selected pilot (recommendation, pending approval)

**mfi-015 — Vijaya Laghubitta Bittiya Sanstha Ltd.** (source: `vlbs-website`, URL `https://vlbs.com.np`)

Rationale: HTTPS, enabled, zero prior errors, registered source, institution name embedded in domain, standard `.com.np` MFI domain, no allowlist or scheme blockers expected. Lowest apparent risk among the 8.

## 4. Exact action proposed

A single targeted ingestion run for one source:

```
npm run ops -- run --source=vlbs-website --db data/durable/store.db
```

(Or the equivalent targeted invocation per `docs/INGESTION-OPERATIONS.md`.)

This runs the ControlledFetcher + extractor pipeline for `vlbs-website` only, against the local durable store.

## 5. Expected external requests

- One HTTPS GET to `https://vlbs.com.np` (and same-origin pages discovered via sitemap/link walk, bounded by the per-source budget).
- No other hosts. Redirects re-validated on every hop (HTTPS only, no host escape).
- Rate-limited (min 250 ms between fetches to the same host), body cap 5 MB, timeout 15 s, max 5 redirects, 2 retries.

## 6. Database/files that may be written

- `data/durable/store.db` (gitignored, local): new `ingestion_runs`, `ingestion_items`, `ingestion_errors`, `source_snapshots`, `data_assertions`, possibly `data_conflicts` rows for mfi-015.
- `lk.db` is NOT touched (derived store, separate).
- Public site (`src/data/*.ts`) is NOT regenerated (manual step).
- No D1, no production data.

## 7. Duplicate and rollback risks

- **Duplicates:** `ingestion_items` keyed by (run_id, url) UNIQUE; assertions deduplicated by the adapter (saveConflict dedupes rather than removes). Re-running creates a new run row + new item rows, but no duplicate assertions. Risk: low.
- **Rollback:** `data/durable/store.db` is gitignored and rebuilt by `npm run durable:build`. The pilot evidence DBs (`data/pilot/evidence/*.db`) are committed and immutable — they are NOT touched by this run. If the durable store is corrupted, restore via `npm run durable:build`. No committed data is at risk.
- **Conflict creation:** the fixed detector skips same-source pairs, so no new same-source artifacts should be created. Cross-source conflicts (genuine disagreements) would be created if a second source disagrees — none exists for mfi-015 yet.

## 8. Success criteria

1. Run record status = SUCCESS.
2. items_failed = 0 (or explained).
3. At least one snapshot + at least one assertion for mfi-015 with source_id = vlbs-website and a real observed_at.
4. No duplicate assertions (count of (entity_id, field_name, value, source_id) unique).
5. No new same-source conflicts created.
6. `npm run check:identity` and `npm run check:datatruth` still pass.
7. `npm run build` still passes.

## 9. Stop conditions

Stop immediately if:
- Any HTTP error other than transient timeout (4xx/5xx).
- Host not allowlisted or non-HTTPS redirect.
- Body exceeds 5 MB.
- Duplicate assertions detected.
- A new same-source conflict is created.
- Run status = FAILED or PARTIAL with unexplained errors.
- Evidence provenance cannot be established.

## 10. What is NOT authorized by this request

- Bulk retry of the 47 PARTIAL runs.
- Resolution of the 229 OPEN conflicts.
- Validation status changes.
- Changes to production data, DNS, secrets, or deployment.
- Commit, push, tag, or release.

## 11. Owner decision required

Approve one of:
- **A.** Execute the pilot for mfi-015 (vlbs-website) as described.
- **B.** Execute for a different institution (specify which).
- **C.** Do not execute; keep the manifest as the plan.

No ingestion will run until explicit approval is given.
