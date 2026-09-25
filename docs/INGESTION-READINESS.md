# Ingestion — Evidence/Source Readiness Review (Phase A)

Status: **COMPLETE**  ·  Verdict: **No schema change required.** Every requirement in
the next-build instruction (Phases A–Q) is representable in the frozen 53-table
schema (`migrations/0001..0007`, `schema/schema.sql`). Verified field-by-field from
the migrations below, not from names.

---

## 1. Requirement → representation map

| Requirement | Represented by | Confirmed in |
|---|---|---|
| Source identity | `sources.id` PK, `sources.url` UNIQUE NOT NULL | `0001_initial.sql:13-34` |
| Source scope | `sources.source_scope` ('INSTITUTION','NRB','MARKET','MEDIA','GENERAL') | `0001:17-18` |
| Source grade | `sources.source_grade` ('A'..'D') | `0001:19` |
| Source URL | `sources.url`, `sources.domain` | `0001:20-21` |
| Source snapshots | `source_snapshots` (source_id, fetched_at, content_hash, http_status, mime_type, r2_key, parser_version, extraction_status) | `0001:36-47` |
| Changed content | `content_hash` on `sources`/`source_snapshots`/`documents`/`outbound_links`; `ingestion_items.status` NEW/CHANGED/UNCHANGED | `0001:27`, `0004:18`, `0007:158-159` |
| Documents | `documents` (official_url, canonical_url, content_hash, file_size, mime_type, availability_status, extraction_status, outbound_link_id, archive fields) | `0004:5-31` |
| Document categories | `document_categories` (tree, category_code) | `0001:86-92` |
| Extracted data | `document_extractions` (field, value_raw/typed, page_number, table_index, parser_version, confidence) | `0004:33-47` |
| Assertions | `data_assertions` (entity_type, entity_id, field_name, value, source_id, source_snapshot_id, observed_at, valid_from/to, confidence, verification_status) | `0007:85-99` |
| Conflicts | `data_conflicts` (source_a/b, value_a/b, resolution_status) | `0007:101-116` |
| Validation | `validation_rules` + `validation_results` (rule_id, severity, PASS/FAIL, evidence_json) | `0001:99-107`, `0007:176-186` |
| Ingestion runs | `ingestion_runs` (source, started_at, completed_at, status RUNNING/SUCCESS/FAILED/PARTIAL, items_found/changed/new/failed, parser_version, error_count) | `0007:138-151` |
| Failed items | `ingestion_errors` (run_id, url, error_type, error_message, retry_count) + `ingestion_items.status=FAILED` | `0007:165-174`, `0007:158` |
| Source health | `ingestion_sources` (last_run_at, last_success_at, error_count, enabled, fetch_interval_minutes) + derivable health view | `0007:122-136` (see §3) |
| Institution association | `ingestion_sources.institution_id`, `documents.institution_id`, `official_links.institution_id`, `outbound_links.institution_id` | `0007:128`, `0004:7`, `0007:66`, `0001:182` |
| Operational events | `audit_logs` (action, target, before/after JSON) + `ingestion_runs` timing | `0007:188-198` (see §4) |
| Lifecycle states | `ingestion_runs.status` + `ingestion_items.status` + `source_snapshots.extraction_status` + `validation_results.status` + `data_conflicts.resolution_status` | `0007` (see §5) |

## 2. Representability findings (no change needed)

1. **`sources.url` UNIQUE stays** — one physical URL = one source identity. The importer
   dedupes before insert (deterministic URL_KEEP preference), matching the frozen rule.
2. **`institution_coverage` never stores a %** — confirmed: only `*_status` columns exist;
   `overall_status` is a stored label, completion % is derived read-time. Correct.
3. **`source_snapshots` is the change-detection anchor** — one snapshot per fetch per source;
   content-hash comparison decides NEW/CHANGED/UNCHANGED at `ingestion_items` level.
4. **`outbound_links` is the `/go/` routing table** and separately `official_links` is the
   evidence-backed "official source" structure. They are distinct: `/go/` = routes,
   `official_links` = verified-ness of pages. Correct, and `/go/` resolution in the Worker
   (Phase A prior work) already reads the right table.
5. **`documents.outbound_link_id`** links each catalogued document to its `/go/` door — so
   discovery → document → redirect route is one FK hop. Present.
6. **`data_assertions.source_snapshot_id`** = the "assertion proven by exactly this fetch"
   link required by the evidence-first pipeline. Present.
7. **`articles`/`news`/`jobs`/`posts`** all carry `status` + `source_id` + `institution_id`,
   so "do not auto-publish extracted facts" is enforceable per row.

## 3. Source health (Phase K) — representable, one derived view

- **Stored already:** `ingestion_sources.last_run_at`, `last_success_at`, `error_count`,
  `enabled`, `fetch_interval_minutes`.
- **Derivable without a new table:** `last_failure_at`/`consecutive_failures` from
  `ingestion_runs` (status FAILED/PARTIAL ordered by started_at), `last_http_status` from
  `source_snapshots.http_status` (latest), `last_content_hash` from
  `source_snapshots.content_hash` (latest), `last_structure_change` from a
  `content_hash`/parser-version delta, `next_retry_at` from `ingestion_errors.retry_count`
  + backoff policy.
- **Verdict:** admin health view = stored columns + derived aggregate over
  `ingestion_runs`/`ingestion_errors`/`source_snapshots`. No new source-health table; the
  instruction's "do NOT create a new table unless genuinely impossible" is honored.

## 4. Operational events (Phase J) — representable via audit_logs + runs

- `audit_logs` (action = the event code, target_type/target_id = run/item, before_json/
  after_json = state transition, created_at) gives a versionable, append-only event trail.
- `ingestion_runs.id` = run_id; `ingestion_runs.started_at/completed_at` = duration;
  `ingestion_errors` = error payload. request_id maps to `ingestion_runs.id`.
- **Verdict:** no new table. Event codes (INGESTION_REQUESTED → ... → COMPLETED) as
  `audit_logs.action` values; idempotent re-runs append new events, never overwrite.

## 5. Lifecycle states (Phase I) — mapped onto existing columns

| Spec state | Schema mapping |
|---|---|
| DISCOVERED / QUEUED | `ingestion_runs.status='RUNNING'`; new `ingestion_items` row (status NEW) |
| FETCHING → FETCHED | `audit_logs` event + `source_snapshots` insert |
| CHANGED / UNCHANGED | `ingestion_items.status` (CHANGED/UNCHANGED), hash compare |
| EXTRACTING → EXTRACTED | `source_snapshots.extraction_status` PENDING→EXTRACTED; `document_extractions` rows |
| VALIDATING → VALIDATED | `validation_results.status` PENDING→PASS |
| CONFLICT | `data_conflicts.resolution_status='OPEN'` + `data_assertions.verification_status='CONFLICT'` |
| FAILED | `ingestion_items.status='FAILED'` + `ingestion_errors` |
| RETRYING | `ingestion_errors.retry_count` increments; run stays RUNNING |
| COMPLETED | `ingestion_runs.status='SUCCESS'/'PARTIAL'` |

**No new columns** are needed to represent the lifecycle; the state machine maps onto the
existing status vocabularies exactly as the instruction permits ("map them onto the existing
schema where possible").

## 6. Gaps that DO require a migration (FIELD-LEVEL, none schema-level)

None. All 53 tables suffice. Two implementation notes that are NOT schema gaps:

- **`occurred_at` nullable** on `timeline_events` (fixed in 0005) — already migrated.
- **`institution_aliases`** has `UNIQUE (institution_id, alias)` in the applied schema
  (matching the migration), even though DATABASE-SPEC §4.2 shows `alias` UNIQUE — resolved
  in the migration set already; the generated schema.sql is the source of truth.

## 7. Explicitly preserved decisions (not touched by this phase)

- **No AI extraction in the first pipelist implementation.** The deterministic path is
  fetch → evidence → discovery → deterministic extraction → validation → assertion.
- **Five-MFB pilot only** (mfi-001/003/020/034/047) — configuration/data, never
  institution-specific classes.
- **No real crawling in this build.** VAPT/recon records exist only as seed/reference
  evidence; the engine is proven on controlled fixtures (`smoke-ingest-fixtures*`).
- **No production D1 touch.** Local sqlite + Worker shim only (LK_ENV guard enforced).

## 8. Confirmation checklist (ticked from actual SQL)

- [x] source identity, scope, grade, URL   — `sources` (0001:13-34)
- [x] source snapshots + changed content   — `source_snapshots` + 3 hash columns (0001, 0004, 0007)
- [x] documents + categories + extractions — 0004 tables
- [x] assertions + conflicts              — 0007 tables
- [x] validation rules + results          — 0001:99 + 0007:176
- [x] ingestion runs/items/errors         — 0007:138-174
- [x] source health                       — stored + derived, no new table
- [x] operational events                  — audit_logs + runs (no new table)
- [x] lifecycle states                    — existing status columns (no new columns)
- [x] institution association             — 4 FK columns across 0001/0004/0007