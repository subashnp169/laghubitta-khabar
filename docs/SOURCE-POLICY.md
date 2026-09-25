# Laghubitta Khabar — Source Policy (Frozen)

Makes the platform trustworthy to institutions, professionals, and regulators.

## Source hierarchy

| Tier | Source | Treat as |
|---|---|---|
| 1 | NRB / official regulator | Authoritative |
| 2 | MFB official website; MFB annual/quarterly reports; official notices | Authoritative for own data |
| 3 | NEPSE / official exchange; official company filings | Authoritative for listing data |
| 4 | Established financial data providers | Referenced, needs Tier-1/2 cross-check |
| 5 | News / media | Referenced, never authoritative alone |
| 6 | Social media | Never authoritative; identity verification required |

**Rule:** never treat a lower-tier source as authoritative when a higher-tier source is available.

## Verification status

- `UNVERIFIED` — ingested, not yet checked.
- `AUTO_VERIFIED` — matches a higher-tier source automatically (or unchanged hash).
- `HUMAN_VERIFIED` — reviewed by an editor.
- `CONFLICT` — sources disagree; visible to admin, resolved via `data_conflicts`.
- `STALE` — past `next_review_at`, not yet re-verified.
- `REJECTED` — wrong/duplicate/non-official; kept with reason.

## Provenance requirements

- Every external fact: `source_id` → `sources` (url, domain, title, publisher, fetched_at,
  content_hash, http_status, mime_type, language, r2_key).
- Every source fetch: `source_snapshots` (content_hash, r2_key, parser_version,
  extraction_status). Preserves the "CEO was A six months ago" evidence.
- Every important fact: `data_assertions` row.

## Conflict resolution

When two sources disagree (e.g., website says CEO=A, annual report says CEO=B):
- Never auto-choose.
- Create a `data_conflicts` row; admin sees a warning badge.
- Resolution recorded: `resolution_status`, `resolved_by`, `resolved_at`, `resolution_note`.
- The losing value is retained in `data_assertions` history (valid_to set), never deleted.

## People policy

- **Tier 1** — Board + senior management. Fully documented from official public sources.
- **Tier 2** — Branch managers / contact officers, only when the institution itself publicly
  identifies them.
- **Tier 3** — General employees. **No personal profiles.** Never scrape personal data from
  LinkedIn/Facebook to build profiles.

Rules: no employee scraping; no personal-data aggregation beyond published Tier-1/Tier-2 facts.

## Financial numbers

- **No financial number enters production without source + period + unit.**
- Canonical unit for amounts: NPR (stored as integer paisa or crore-normalized INTEGER, never
  display text). Percentages stored as REAL.
- Original value and unit preserved in the extraction/assertion row; UI renders the display unit.

## Digital/social accounts

- Show only accounts reasonably verified as official (domain match, official cross-link, verified
  badge, editorial confirmation).
- Display `Verified by source` + `Last checked: <date>`.
- Never assume a scraped name is the official account.

## What this protects

- The platform cannot be accused of publishing scraped guesses as fact.
- Every number and name has a "where did this come from" answer.
- The DB becomes evidence-grade, which is what B2B data licensing and regulator/professional
  trust are built on.