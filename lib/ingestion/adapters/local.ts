// ============================================================================
// Local sqlite adapters for the ingestion contract (Phase N fixtures + pilot).
// implements SourceRegistry + EvidenceWriter against the seeded lk.db.
// better-sqlite3 is dev-tooling only (never in a Worker bundle).
// ============================================================================

import { createRequire } from "node:module";

import type {
  AuditInput,
  AssertionInput,
  ConflictInput,
  ErrorInput,
  EvidenceWriter,
  StoredAssertion,
  ItemInput,
  OutboundLinkInput,
  RunOutcome,
  SnapshotInput,
  SourceHealth,
  SourceRegistry,
  ValidationInput,
} from "../contract";
import type { CapabilitySpec, IngestionSourceSpec } from "../types";
import { buildIngestionSourceSpec, parseCapabilities } from "../config";
import { createSha256Hex } from "../canonical";

type Row = Record<string, unknown>;

function getDatabase(dbPath: string) {
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3") as new (p: string) => SqliteDb;
  return new Database(dbPath);
}

interface SqliteDb {
  prepare(sql: string): SqliteStmt;
  pragma(s: string): unknown;
  transaction<T extends (...a: never[]) => unknown>(fn: T): T;
}
interface SqliteStmt {
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): { changes: number };
}

let uid = 0;
function genId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

const nowIso = () => new Date().toISOString();

/**
 * EXT-C2 - deterministic identity for one semantic assertion.
 *
 * Derived only from the fields the schema already stores for a claim
 * (entity_type, entity_id, field_name, source_id) plus a normalised value, so the
 * pure function of the claim. Normalisation is deliberately minimal - Unicode
 * NFKC, collapsed whitespace, case-folded - so "Satya Narayan  Jha" and
 * "satya narayan jha" are recognised as the same claim while a genuinely
 * different value is never folded into it. The stored `value` column keeps the
 * exact first-observed text; only identity is normalised.
 *
 * source_id is part of the key, and that is load-bearing rather than incidental.
 * Without it, an official page and a regulator both asserting `district = Dang`
 * for one branch identity hash to the SAME id, the second INSERT is ignored, and
 * the second source's provenance is lost for good. One identity would then carry
 * one provenance row, and "which sources saw this branch?" becomes unanswerable -
 * which is exactly what cross-source corroboration depends on. With source_id in
 * the key, re-sighting the same claim from the SAME source still collapses (the
 * idempotent case this id was built for), while two different sources each keep
 * their own row against the same entity.
 */
async function semanticAssertionId(
  entityType: string,
  entityId: string,
  fieldName: string,
  sourceId: string,
  value: string,
): Promise<string> {
  const material = [entityType, entityId, fieldName, sourceId, value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase()].join("");
  const hex = await createSha256Hex(new TextEncoder().encode(material));
  return `as-${hex.slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// SourceRegistry (read + run bookkeeping)
// ---------------------------------------------------------------------------

export class LocalSourceRegistry implements SourceRegistry {
  private readonly db: SqliteDb;

  constructor(dbPath: string) {
    this.db = getDatabase(dbPath);
  }

  async listEnabled(): Promise<IngestionSourceSpec[]> {
    const rows = this.db
      .prepare("SELECT * FROM ingestion_sources WHERE enabled = 1")
      .all() as Row[];
    return rows.map((r) => buildIngestionSourceSpec(mapRow(r)));
  }

  async get(id: string): Promise<IngestionSourceSpec | null> {
    const r = this.db
      .prepare("SELECT * FROM ingestion_sources WHERE id = ?")
      .get(id) as Row | undefined;
    return r ? buildIngestionSourceSpec(mapRow(r)) : null;
  }

  async capabilitiesOf(id: string): Promise<CapabilitySpec[]> {
    const r = this.db
      .prepare("SELECT config_json FROM ingestion_sources WHERE id = ?")
      .get(id) as Row | undefined;
    if (!r) return [];
    return parseCapabilities(r.config_json ?? "{}");
  }

  async lastContentHash(sourceId: string, url: string): Promise<string | null> {
    // Latest snapshot content hash for (source, url) via the most recent item.
    const r = this.db
      .prepare(
        `SELECT i.content_hash AS h
           FROM ingestion_items i
           JOIN ingestion_runs r ON r.id = i.run_id
          WHERE r.ingestion_source_id = ? AND i.url = ?
          ORDER BY i.id DESC LIMIT 1`,
      )
      .get(sourceId, url) as Row | undefined;
    return r ? (r.h as string) : null;
  }

  async healthOf(id: string): Promise<SourceHealth | null> {
    const run = this.db
      .prepare(
        `SELECT
           MAX(r.started_at) AS last_run,
           MAX(CASE WHEN r.status IN ('SUCCESS','PARTIAL') THEN r.completed_at END) AS last_ok,
           MAX(CASE WHEN r.status = 'FAILED' THEN r.completed_at END) AS last_fail,
           SUM(CASE WHEN r.status = 'FAILED' THEN 1 ELSE 0 END) AS fails,
           SUM(CASE WHEN r.status = 'SUCCESS' THEN 1 ELSE 0 END) AS oks
         FROM ingestion_runs r WHERE r.ingestion_source_id = ?`,
      )
      .get(id) as Row | undefined;
    if (!run || run.last_run === null) return null;
    const consec = this.consecutiveFailures(id);
    return {
      lastRunAt: (run.last_run as string) ?? null,
      lastSuccessAt: (run.last_ok as string) ?? null,
      lastFailureAt: (run.last_fail as string) ?? null,
      consecutiveFailures: consec,
      lastHttpStatus: null,
      lastContentHash: null,
      nextRetryAt: null,
    };
  }

  private consecutiveFailures(sourceId: string): number {
    const rows = this.db
      .prepare(
        "SELECT status FROM ingestion_runs WHERE ingestion_source_id = ? ORDER BY started_at DESC",
      )
      .all(sourceId) as Row[];
    let n = 0;
    for (const r of rows) {
      if (r.status === "SUCCESS" || r.status === "PARTIAL") break;
      if (r.status === "FAILED") n += 1;
    }
    return n;
  }

  async recordRun(outcome: RunOutcome): Promise<void> {
    const existing = this.db
      .prepare("SELECT id FROM ingestion_runs WHERE ingestion_source_id = ? AND started_at = ?")
      .get(outcome.sourceId, outcome.startedAt) as Row | undefined;
    const id = existing ? (existing.id as string) : `run-${outcome.startedAt}-${outcome.sourceId}`;
    this.db
      .prepare(
        `INSERT INTO ingestion_runs
           (id, ingestion_source_id, started_at, completed_at, status,
            items_found, items_changed, items_new, items_failed, parser_version, error_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           completed_at = excluded.completed_at,
           status = excluded.status,
           items_found = excluded.items_found,
           items_changed = excluded.items_changed,
           items_new = excluded.items_new,
           items_failed = excluded.items_failed,
           parser_version = excluded.parser_version,
           error_count = excluded.error_count`,
      )
      .run(
        id,
        outcome.sourceId,
        outcome.startedAt,
        outcome.completedAt,
        outcome.status,
        outcome.itemsFound,
        outcome.itemsChanged,
        outcome.itemsNew,
        outcome.itemsFailed,
        outcome.parserVersion ?? null,
        outcome.errorCount,
      );
    const patch = this.db
      .prepare(
        `UPDATE ingestion_sources
            SET last_run_at = COALESCE(?, last_run_at),
                last_success_at = CASE WHEN ? IN ('SUCCESS','PARTIAL') THEN ? ELSE last_success_at END,
                error_count = error_count + ?
          WHERE id = ?`,
      );
    const errDelta = outcome.status === "FAILED" ? 1 : 0;
    patch.run(
      outcome.startedAt,
      outcome.status,
      outcome.completedAt,
      errDelta,
      outcome.sourceId,
    );
  }
}

// ---------------------------------------------------------------------------
// EvidenceWriter - append-only. Idempotency is a deterministic semantic id (so
// INSERT OR IGNORE collapses a re-sighted claim) plus an explicit lookup, so no
// uniqueness constraint or migration is needed.
// ---------------------------------------------------------------------------

export class LocalSqliteEvidenceWriter implements EvidenceWriter {
  private readonly db: SqliteDb;

  constructor(dbPath: string) {
    this.db = getDatabase(dbPath);
  }

  async saveSnapshot(input: SnapshotInput): Promise<string> {
    const id = genId("snap");
    this.db
      .prepare(
        `INSERT OR IGNORE INTO source_snapshots
           (id, source_id, fetched_at, content_hash, http_status, mime_type,
            r2_key, parser_version, extraction_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, input.sourceId, input.fetchedAt, input.contentHash,
        input.httpStatus, input.mimeType, input.r2Key, input.parserVersion,
        input.extractionStatus,
      );
    return id;
  }

  async updateExtractionStatus(snapshotId: string, status: SnapshotInput["extractionStatus"]): Promise<void> {
    this.db.prepare("UPDATE source_snapshots SET extraction_status = ? WHERE id = ?").run(status, snapshotId);
  }

  async saveItem(input: ItemInput): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO ingestion_items
           (id, run_id, url, item_type, status, content_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(genId("item"), input.runId, input.url, input.itemType, input.status, input.contentHash ?? null);
  }

  async saveAssertion(input: AssertionInput): Promise<void> {
    // EXT-C2 - semantic identity of an assertion.
    //
    // A semantic claim is (entity, field, value). It is NOT
    // (entity, field, value, snapshot). A live page that mutates produces a new
    // snapshot, and that new snapshot is stored in full and stays auditable;
    // re-reading the SAME claim from it must not manufacture a second active
    // assertion, which is what happened when a carousel banner changed the
    // bytes of a board page between two runs.
    //
    // The deterministic id makes the existing `INSERT OR IGNORE` de-duplicate
    // on the EXISTING primary key: no schema change, no new index, no new
    // column - the same insert-on-first-sighting pattern saveOutboundLink below
    // already uses for documents. Genuine changes are unaffected because a
    // different value (or a different field, e.g. a role transition) hashes to
    // a different id and is therefore inserted as a new assertion, leaving both
    // the old and the new claim, both snapshots and the conflict lifecycle
    // intact.
    const id = await semanticAssertionId(input.entityType, input.entityId, input.fieldName, input.sourceId, input.value);
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO data_assertions
           (id, entity_type, entity_id, field_name, value, source_id,
            source_snapshot_id, observed_at, confidence, verification_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, input.entityType, input.entityId, input.fieldName, input.value,
        input.sourceId, input.sourceSnapshotId, input.observedAt,
        input.confidence, input.verificationStatus,
      );
    if (res.changes === 0) {
      // The identical claim is already stored. The existing assertion and its
      // original evidence pointer are left exactly as they are - nothing is
      // overwritten, closed out or suppressed - and the re-sighting is recorded
      // through the existing audit mechanism so the new snapshot stays
      // attributable to the claim it re-observed.
      await this.appendAudit({
        action: "ASSERTION_RESEEN",
        targetType: input.entityType,
        targetId: id,
        afterJson: JSON.stringify({
          field_name: input.fieldName,
          value: input.value,
          source_id: input.sourceId,
          source_snapshot_id: input.sourceSnapshotId,
          observed_at: input.observedAt,
          confidence: input.confidence,
          verification_status: input.verificationStatus,
        }),
      });
    }
  }

  /**
   * M3.4 gate - deterministic lookup of what is already asserted in one slot.
   *
   * The frozen schema puts no uniqueness constraint on data_assertions, so an
   * equivalent assertion can only be recognised by reading. This is that read.
   * Oldest observation first, so callers can treat the last entry as current.
   */
  async findAssertions(input: {
    entityType: string;
    entityId: string;
    fieldName: string;
    sourceId?: string;
  }): Promise<StoredAssertion[]> {
    const rows = this.db
      .prepare(
        `SELECT id, entity_type, entity_id, field_name, value, source_id,
                source_snapshot_id, observed_at, valid_to, verification_status
           FROM data_assertions
          WHERE entity_type = ? AND entity_id = ? AND field_name = ?
            ${input.sourceId ? "AND source_id = ?" : ""}
          ORDER BY observed_at ASC, id ASC`,
      )
      .all(
        ...(input.sourceId
          ? [input.entityType, input.entityId, input.fieldName, input.sourceId]
          : [input.entityType, input.entityId, input.fieldName]),
      ) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      entity_type: String(r.entity_type),
      entity_id: String(r.entity_id),
      field_name: String(r.field_name),
      value: String(r.value),
      source_id: String(r.source_id),
      source_snapshot_id: r.source_snapshot_id === null ? null : String(r.source_snapshot_id),
      observed_at: String(r.observed_at),
      valid_to: r.valid_to === null ? null : String(r.valid_to),
      verification_status: String(r.verification_status),
    }));
  }

  /**
   * M3.4 gate - close ONE assertion out as superseded.
   *
   * The frozen schema already has both halves of this: data_assertions.valid_to
   * and a STALE member of the verification_status vocabulary. What was missing was
   * the operation, not the storage. This stamps valid_to and moves the status, and
   * never deletes: the earlier observation keeps its value, its source and its
   * snapshot so the change stays auditable.
   */
  async supersedeAssertion(input: {
    id: string;
    validTo: string;
    status?: "STALE" | "CONFLICT" | "REJECTED";
    reason?: string;
  }): Promise<boolean> {
    // Read the row first so the audit entry can name what was retired, not just
    // that something was. Without this the reason a value stopped being current is
    // lost the moment the row is closed out, and "why did this change?" is
    // unanswerable from the database afterwards.
    const prior = this.db
      .prepare(
        `SELECT entity_type, entity_id, field_name, value, source_id
           FROM data_assertions WHERE id = ?`,
      )
      .get(input.id) as
      | { entity_type: string; entity_id: string; field_name: string; value: string; source_id: string }
      | undefined;
    const res = this.db
      .prepare(
        `UPDATE data_assertions
            SET valid_to = ?, verification_status = ?
          WHERE id = ? AND valid_to IS NULL`,
      )
      .run(input.validTo, input.status ?? "STALE", input.id);
    if (res.changes > 0) {
      if (input.reason) {
        await this.appendAudit({
          action: "ASSERTION_SUPERSEDED",
          targetType: "DATA_ASSERTION",
          targetId: input.id,
          beforeJson: JSON.stringify({
            reason: input.reason,
            valid_to: input.validTo,
            status: input.status ?? "STALE",
            entityType: prior?.entity_type ?? null,
            entityId: prior?.entity_id ?? null,
            fieldName: prior?.field_name ?? null,
            retiredValue: prior?.value ?? null,
            sourceId: prior?.source_id ?? null,
          }),
        });
      }
      return true;
    }
    if (input.reason) {
      await this.appendAudit({
        action: "ASSERTION_SUPERSEDE_SKIPPED",
        targetType: "DATA_ASSERTION",
        targetId: input.id,
        afterJson: JSON.stringify({ reason: input.reason, valid_to: input.validTo }),
      });
    }
    return false;
  }

  /**
   * EXT-M3.5 - re-open a superseded assertion whose value has come back.
   *
   * `saveAssertion` de-duplicates on the semantic identity (entity, field,
   * source, value), so a reverted value cannot be written again: the insert is
   * ignored and the field is left with no current claim. This restores the row
   * and re-points it at the snapshot that most recently carried the value.
   *
   * The `valid_to IS NOT NULL` guard means this can only ever act on a
   * superseded row. Calling it on a current assertion changes nothing.
   */
  async reviveAssertion(input: {
    id: string;
    observedAt: string;
    sourceSnapshotId: string;
    confidence: number;
  }): Promise<boolean> {
    // Read the row first for the same reason supersedeAssertion does: a claim that
    // comes back to life is a lifecycle change, and a lifecycle change that is not on
    // the record cannot be told apart later from a row that was never retired.
    const prior = this.db
      .prepare(
        `SELECT entity_type, entity_id, field_name, value, source_id, valid_to
           FROM data_assertions WHERE id = ?`,
      )
      .get(input.id) as
      | { entity_type: string; entity_id: string; field_name: string; value: string; source_id: string; valid_to: string | null }
      | undefined;
    const res = this.db
      .prepare(
        `UPDATE data_assertions
            SET valid_to = NULL,
                observed_at = ?,
                source_snapshot_id = ?,
                confidence = ?,
                verification_status = 'UNVERIFIED'
          WHERE id = ? AND valid_to IS NOT NULL`,
      )
      .run(input.observedAt, input.sourceSnapshotId, input.confidence, input.id);
    if (res.changes > 0) {
      await this.appendAudit({
        action: "ASSERTION_REVIVED",
        targetType: "DATA_ASSERTION",
        targetId: input.id,
        beforeJson: JSON.stringify({
          reason: "the same source reported this value again, so the retirement is reversed rather than a duplicate row written",
          retired_at: prior?.valid_to ?? null,
          entityType: prior?.entity_type ?? null,
          entityId: prior?.entity_id ?? null,
          fieldName: prior?.field_name ?? null,
          value: prior?.value ?? null,
          sourceId: prior?.source_id ?? null,
        }),
        afterJson: JSON.stringify({
          observed_at: input.observedAt,
          source_snapshot_id: input.sourceSnapshotId,
          confidence: input.confidence,
          verification_status: "UNVERIFIED",
        }),
      });
      return true;
    }
    return false;
  }

  /**
   * M3.4 gate - reuse an existing snapshot for identical canonical content
   * instead of appending a byte-identical row on every re-run.
   */
  async findSnapshotByContentHash(sourceId: string, contentHash: string): Promise<string | null> {
    const r = this.db
      .prepare(
        `SELECT id FROM source_snapshots
          WHERE source_id = ? AND content_hash = ?
          ORDER BY fetched_at DESC, id DESC LIMIT 1`,
      )
      .get(sourceId, contentHash) as Row | undefined;
    return r ? String(r.id) : null;
  }
  async saveConflict(input: ConflictInput): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO data_conflicts
           (id, entity_type, entity_id, field_name, source_a_id, value_a,
            source_b_id, value_b, detected_at, resolution_status, resolution_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        genId("cf"), input.entityType, input.entityId, input.fieldName,
        input.sourceAId, input.valueA, input.sourceBId, input.valueB,
        input.detectedAt, input.resolutionStatus, input.resolutionNote ?? null,
      );
  }

  async saveValidation(input: ValidationInput): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO validation_results
           (id, target_type, target_id, rule_id, severity, status, message, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        genId("vr"), input.targetType, input.targetId, input.ruleId,
        input.severity, input.status, input.message ?? null, input.evidenceJson,
      );
  }

  async saveError(input: ErrorInput): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO ingestion_errors
           (id, run_id, ingestion_source_id, url, error_type, error_message, retry_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        genId("err"), input.runId, input.sourceId ?? null, input.url ?? null,
        input.errorType, input.errorMessage, input.retryCount,
      );
  }

  async saveOutboundLink(input: OutboundLinkInput): Promise<void> {
    const id = `doc-${input.scopeKey}-${input.slug}`;
    const now = nowIso();
    const availability = input.availabilityStatus ?? "UNKNOWN";
    // Insert-on-first-sighting; the UNIQUE(scope_key, slug) keeps ONE logical
    // link per document while source_snapshots carries every version's evidence.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO outbound_links
           (id, scope_key, institution_id, slug, target_type, label, target_url,
            canonical_url, content_hash, availability_status, source_id,
            first_seen_at, last_checked_at, description, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id, input.scopeKey, input.institutionId ?? null, input.slug,
        input.targetType, input.label, input.targetUrl,
        input.canonicalUrl ?? null, input.contentHash ?? null, availability,
        input.sourceId, input.firstSeenAt, input.lastCheckedAt ?? null,
        input.description ?? null, now, now,
      );
    // New version sighted → refresh hash/availability/check time on the SAME
    // link row (old versions are the retained snapshot rows, never overwritten).
    this.db
      .prepare(
        `UPDATE outbound_links
            SET content_hash = ?,
                availability_status = ?,
                last_checked_at = ?,
                description = ?,
                updated_at = ?
          WHERE scope_key = ? AND slug = ?`,
      )
      .run(
        input.contentHash ?? null, availability, input.lastCheckedAt ?? null,
        input.description ?? null, now, input.scopeKey, input.slug,
      );
  }

  async appendAudit(input: AuditInput): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO audit_logs
           (id, action, target_type, target_id, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        genId("aud"), input.action, input.targetType, input.targetId,
        input.beforeJson ?? null, input.afterJson ?? null, nowIso(),
      );
  }
}

// ---------------------------------------------------------------------------

function mapRow(r: Row): {
  id: string;
  url: string;
  domain?: string | null;
  source_type: string;
  institution_id?: string | null;
  config_json?: string | null;
  enabled?: number | null;
  fetch_interval_minutes?: number | null;
} {
  return {
    id: r.id as string,
    url: r.url as string,
    domain: r.domain as string | null,
    source_type: r.source_type as string,
    institution_id: r.institution_id as string | null,
    config_json: r.config_json as string | null,
    enabled: r.enabled as number | null,
    fetch_interval_minutes: r.fetch_interval_minutes as number | null,
  };
}