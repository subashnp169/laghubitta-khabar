// ============================================================================
// Generic ingestion engine (Phases G–J) — evidence-first pipeline.
//
//   Source → Fetch (evidence/snapshot) → Change detection → Discovery →
//   Extraction → Validation → Assertion → Conflict detection → approval → public
//
// Rules enforced here (Phases H–I):
//   - Evidence survives extraction failure: `saveSnapshot` always runs before
//     extract; extraction failure writes ingestion_error, never drops the hash.
//   - Historical evidence is NEVER silently replaced: a changed hash appends a
//     NEW snapshot; existing content_hash owners keep their rows.
//   - Idempotency: same source+url+content_hash → UNCHANGED, no duplicate
//     processing. Re-runs are always safe.
//   - AI never runs here. Extraction calls the injected Extractor only.
//   - Nothing is auto-published: assertions persist UNVERIFIED/AUTO_VERIFIED;
//     publishing is a separate admin step.
//
// Institution-agnostic: one source = one run; capabilities/config drive it.
// ============================================================================

function safeStringify(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s ?? "undefined";
  } catch {
    return String(value);
  }
}

/**
 * Deterministic link slug from an official document URL (scope-unique so the
 * outbound_links UNIQUE(scope_key, slug) row identifies one logical document).
 */
function documentSlug(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // keep the raw string; the slug normalization below still applies
  }
  const slug = path
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return (slug || "document").slice(0, 80);
}

import type {
  EngineDeps,
  EngineOptions,
  EngineResult,
  EvidenceWriter,
  Fetcher,
  SourceRegistry,
} from "./contract";
import {
  CapabilityConfigError,
} from "./config";
import type {
  AssertionInput,
  ErrorInput,
  FetchOptions,
  ItemInput,
  Validator,
} from "./contract";
import type {
  CrawlBudget,
  DiscoveredTarget,
  ExtractedEvidence,
  FetchResult,
  IngestionLifecycle,
  IngestionSourceSpec,
  ValidationOutcome,
} from "./types";

export class GenericIngestionEngine {
  constructor(private readonly deps: EngineDeps) {}

  async runSource(sourceId: string, opts: EngineOptions = {}): Promise<EngineResult> {
    const now = opts.now ?? this.deps.now?.() ?? new Date().toISOString();
    let source: IngestionSourceSpec;
    try {
      const found = await this.deps.registry.get(sourceId);
      if (!found) throw new CapabilityConfigError(`unknown ingestion source ${sourceId}`);
      source = found;
    } catch (e) {
      // Malformed config_json (or unknown source) must fail LOUDLY and be
      // recorded as a failed run — never silently skipped, never a crash loop.
      const errMsg = (e as Error).message ?? "config error";
      await this.deps.writer.appendAudit({ action: "INGESTION_STARTED", targetType: "ingestion_source", targetId: sourceId, afterJson: JSON.stringify({ runId: `run-${now}-${sourceId}` }) });
      await this.deps.registry.recordRun({
        sourceId, startedAt: now, completedAt: now, status: "FAILED",
        itemsFound: 0, itemsChanged: 0, itemsNew: 0, itemsFailed: 0, errorCount: 1,
      });
      await this.deps.writer.appendAudit({ action: "INGESTION_COMPLETED", targetType: "ingestion_source", targetId: sourceId, afterJson: JSON.stringify({ ok: false, error: errMsg }) });
      return {
        sourceId, runId: `run-${now}-${sourceId}`, startedAt: now, completedAt: now,
        targetsDiscovered: 0, items: [], ok: false,
        errors: [{ runId: `run-${now}-${sourceId}`, sourceId, errorType: "CAPABILITY_CONFIG", errorMessage: errMsg, retryCount: 0 }],
      };
    }
    if (!source.enabled) return { sourceId, runId: `run-${now}`, startedAt: now, completedAt: now, targetsDiscovered: 0, items: [], ok: true, errors: [] };

    const runId = `run-${now}-${sourceId}`;
    const errors: ErrorInput[] = [];

    await this.deps.registry.recordRun({
      sourceId, startedAt: now, completedAt: now, status: "RUNNING",
      itemsFound: 0, itemsChanged: 0, itemsNew: 0, itemsFailed: 0, errorCount: 0,
    });
    await this.deps.writer.appendAudit({ action: "INGESTION_STARTED", targetType: "ingestion_source", targetId: sourceId, afterJson: JSON.stringify({ runId }) });

    // Phase F: bounded discovery against declared capabilities.
    let targets: DiscoveredTarget[];
    try {
      targets = await this.deps.discovery.discover(source);
    } catch (e) {
      errors.push({ runId, sourceId, errorType: "DISCOVERY_FAILED", errorMessage: (e as Error).message, retryCount: 0 });
      await this.deps.registry.recordRun({
        sourceId, startedAt: now, completedAt: now, status: "FAILED",
        itemsFound: 0, itemsChanged: 0, itemsNew: 0, itemsFailed: 0, errorCount: 1,
      });
      await this.deps.writer.appendAudit({ action: "INGESTION_COMPLETED", targetType: "ingestion_source", targetId: sourceId, afterJson: JSON.stringify({ ok: false }) });
      return { sourceId, runId, startedAt: now, completedAt: now, targetsDiscovered: 0, items: [], ok: false, errors };
    }

    // Crawl budget (Phase O): config-driven limits, never per-institution logic.
    const budget: CrawlBudget = { ...source.budget, ...opts.budget };
    const maxTargets = opts.maxTargets ?? budget.maxTargets ?? targets.length;
    const maxFetches = budget.maxFetches;
    const maxDocuments = budget.maxDocuments;
    const deadline = budget.maxRuntimeMs !== undefined ? Date.now() + budget.maxRuntimeMs : null;
    const docKinds = new Set<string>(["REPORTS", "DOCUMENT_ARCHIVE"]);

    const items: EngineResult["items"] = [];
    let fetches = 0;
    let documents = 0;
    // One snapshot per URL per run — duplicate targets (same URL, different
    // capability) must not double-fetch or double-snapshot the same evidence.
    const seenUrls = new Set<string>();

    for (const target of targets.slice(0, maxTargets)) {
      if (deadline !== null && Date.now() > deadline) {
        await this.deps.writer.appendAudit({ action: "BUDGET_TIME_EXHAUSTED", targetType: "ingestion_source", targetId: sourceId, afterJson: JSON.stringify({ runId }) });
        break;
      }
      if (maxFetches !== undefined && fetches >= maxFetches) {
        await this.deps.writer.appendAudit({ action: "BUDGET_FETCHES_EXHAUSTED", targetType: "ingestion_source", targetId: sourceId, afterJson: JSON.stringify({ runId, fetches }) });
        break;
      }
      if (maxDocuments !== undefined && docKinds.has(target.capability) && documents >= maxDocuments) {
        await this.deps.writer.appendAudit({ action: "BUDGET_DOCUMENTS_EXHAUSTED", targetType: "ingestion_source", targetId: sourceId, afterJson: JSON.stringify({ runId, documents }) });
        continue;
      }
      if (seenUrls.has(target.url)) continue; // same URL already ingested this run
      seenUrls.add(target.url);

      const item = await this.processTarget(source, target, runId, now, opts, budget);
      items.push(item);
      fetches += 1;
      if (docKinds.has(target.capability) && item.lifecycle !== "FAILED") documents += 1;
      if (item.lifecycle === "FAILED") {
        errors.push({ runId, sourceId, url: target.url, errorType: "ITEM_FAILED", errorMessage: item.lifecycle === "FAILED" ? `processing failed for ${target.url}` : "", retryCount: 0 });
      }
    }

    const completedAt = this.deps.now?.() ?? new Date().toISOString();
    await this.deps.registry.recordRun({
      sourceId, startedAt: now, completedAt, status: errors.length === 0 ? "SUCCESS" : "PARTIAL",
      itemsFound: items.length, itemsChanged: items.filter((i) => i.lifecycle === "CHANGED").length,
      itemsNew: items.filter((i) => i.lifecycle === "EXTRACTED").length,
      itemsFailed: items.filter((i) => i.lifecycle === "FAILED").length,
      parserVersion: this.deps.extractor.parserId, errorCount: errors.length,
    });
    await this.deps.writer.appendAudit({ action: "INGESTION_COMPLETED", targetType: "ingestion_source", targetId: sourceId, afterJson: JSON.stringify({ runId, items: items.length, errors: errors.length }) });

    return {
      sourceId,
      runId,
      startedAt: now,
      completedAt,
      targetsDiscovered: targets.length,
      items,
      ok: errors.length === 0,
      errors,
    };
  }

  private async processTarget(
    source: IngestionSourceSpec,
    target: DiscoveredTarget,
    runId: string,
    now: string,
    opts: EngineOptions,
    budget: CrawlBudget = {},
  ): Promise<EngineResult["items"][number]> {
    const fetcher: Fetcher = this.deps.fetcher;

    if (opts.dryRun) {
      return { url: target.url, capability: target.capability, lifecycle: "DISCOVERED", persisted: false };
    }

    await this.deps.writer.appendAudit({ action: "FETCH_STARTED", targetType: "ingestion_item", targetId: runId, afterJson: JSON.stringify({ url: target.url }) });

    // Content-type detection happens HERE, on the real response — the fetcher
    // is deliberately NOT told to demand HTML, otherwise a discovered PDF would
    // be discarded as an error (evidence-first: any controlled fetch is a
    // snapshot; extraction only ever runs on what the mime type says is HTML).
    const fetchOpts: FetchOptions = {
      ...(budget.maxBytes !== undefined ? { maxBytes: budget.maxBytes } : {}),
      ...(budget.maxRedirects !== undefined ? { maxRedirects: budget.maxRedirects } : {}),
    };
    const fetched = await this.fetchAndAudit(source, target, runId, fetchOpts);
    if (!fetched) {
      return { url: target.url, capability: target.capability, lifecycle: "FAILED", persisted: false };
    }

    await this.deps.writer.appendAudit({ action: "FETCH_COMPLETED", targetType: "ingestion_item", targetId: runId, afterJson: JSON.stringify({ contentHash: fetched.contentHash, status: fetched.httpStatus, mimeType: fetched.contentType }) });

    if (fetched.httpStatus === null || fetched.httpStatus >= 400) {
      await this.deps.writer.saveItem({
        runId, url: target.url, itemType: target.capability, status: "FAILED", contentHash: fetched.contentHash || undefined,
      } satisfies ItemInput);
      await this.deps.writer.saveError({ runId, sourceId: source.id, url: target.url, errorType: "HTTP_ERROR", errorMessage: `HTTP ${fetched.httpStatus ?? "none"}`, retryCount: 0 });
      return { url: target.url, capability: target.capability, lifecycle: "FAILED", persisted: true, contentHash: fetched.contentHash || undefined };
    }

    // Phase H: idempotency — same source+url+canonical hash → UNCHANGED
    // short-circuit. No duplicate snapshot, no re-extraction, no re-assertion.
    // Historical evidence (the first snapshot for this content) is preserved
    // untouched. The canonical (derived) hash drives the comparison; the raw
    // bytes + raw hash remain the stored evidence.
    const comparisonHash = this.deps.canonicalizer
      ? await this.deps.canonicalizer.hash(fetched.contentType, fetched.body)
      : fetched.contentHash;
    const priorHash = await this.priorHash(source.id, target.url);
    const unchanged = priorHash !== null && priorHash === comparisonHash;
    await this.deps.writer.saveItem({
      runId, url: target.url, itemType: target.capability, status: unchanged ? "UNCHANGED" : "CHANGED", contentHash: comparisonHash,
    } satisfies ItemInput);

    if (unchanged) {
      await this.deps.writer.appendAudit({ action: "INGESTION_ITEM_UNCHANGED", targetType: "ingestion_item", targetId: runId, afterJson: JSON.stringify({ contentHash: comparisonHash }) });
      return { url: target.url, capability: target.capability, lifecycle: "UNCHANGED", persisted: true, contentHash: fetched.contentHash };
    }

    const mime = fetched.contentType ?? "";
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(mime);

    // Phase G: NEW/CHANGED → write the snapshot (the evidence for this fetch)
    // BEFORE any extraction or document record. Extraction/OCR never runs on
    // non-HTML; the raw hash + mime + timestamp ARE the document evidence.
    const snapshotId = await this.deps.writer.saveSnapshot({
      sourceId: source.id,
      fetchedAt: fetched.fetchedAt,
      contentHash: fetched.contentHash,
      httpStatus: fetched.httpStatus,
      mimeType: fetched.contentType,
      r2Key: null,
      parserVersion: this.deps.extractor.parserId,
      extractionStatus: isHtml ? "PENDING" : "SKIPPED",
    });

    if (!isHtml) {
      // DOCUMENT EVIDENCE PATH (Phase Q): no OCR, no AI, no fabricated title/
      // date. The durable link-first record carries provenance + raw hash;
      // source_snapshots holds every version (old ones are never touched).
      await this.deps.writer.saveOutboundLink({
        scopeKey: source.institutionId ?? source.id,
        institutionId: source.institutionId,
        slug: documentSlug(target.url),
        targetType: "DOCUMENT",
        label: target.title ?? `document at ${target.url}`,
        targetUrl: target.url,
        canonicalUrl: fetched.finalUrl,
        contentHash: fetched.contentHash,
        availabilityStatus: "AVAILABLE",
        sourceId: source.id,
        firstSeenAt: fetched.fetchedAt,
        lastCheckedAt: fetched.fetchedAt,
      });
      await this.deps.writer.appendAudit({ action: "DOCUMENT_EVIDENCE_PERSISTED", targetType: "ingestion_item", targetId: runId, afterJson: JSON.stringify({ url: target.url, contentHash: fetched.contentHash, mimeType: fetched.contentType }) });
      return { url: target.url, capability: target.capability, lifecycle: "CHANGED", persisted: true, contentHash: fetched.contentHash };
    }

    // Phase G: EXTRACT — deterministic; failure must NOT lose the snapshot.
    let extracted: ExtractedEvidence[];
    try {
      extracted = await this.deps.extractor.extract(
        { sourceId: source.id, institutionId: source.institutionId, capability: target.capability, url: target.url, parserId: this.deps.extractor.parserId, contentHash: fetched.contentHash, body: fetched.body },
      );
      await this.deps.writer.updateExtractionStatus(snapshotId, "EXTRACTED");
    } catch {
      await this.deps.writer.updateExtractionStatus(snapshotId, "FAILED");
      await this.deps.writer.saveError({ runId, sourceId: source.id, url: target.url, errorType: "EXTRACTION_FAILED", errorMessage: "extractor threw", retryCount: 0 });
      await this.deps.writer.appendAudit({ action: "EXTRACTION_FAILED", targetType: "ingestion_item", targetId: runId });
      return { url: target.url, capability: target.capability, lifecycle: "FAILED", persisted: true, contentHash: fetched.contentHash };
    }

    await this.deps.writer.appendAudit({ action: "EXTRACTION_COMPLETED", targetType: "ingestion_item", targetId: runId, afterJson: JSON.stringify({ evidenceCount: extracted.length }) });

    // Phase I: VALIDATION — deterministic rules over extracted evidence, run
    // BEFORE assertion. Results attach to the snapshot they judged (the
    // evidence row), never to a fabricated target; a throwing rule degrades to
    // a recorded FAIL so one bad rule can never stall the whole run.
    for (const v of this.deps.validators ?? []) {
      let outcome: ValidationOutcome;
      try {
        outcome = await v.validate({
          sourceId: source.id,
          institutionId: source.institutionId,
          targetType: "source_snapshot",
          targetId: snapshotId,
          evidence: extracted,
        });
      } catch (e) {
        outcome = {
          status: "FAIL",
          severity: v.severity,
          ruleId: v.ruleId,
          message: `validator threw: ${(e as Error).message ?? "unknown"}`,
          evidence: { error: String(e) },
        };
      }
      await this.deps.writer.saveValidation({
        targetType: "source_snapshot",
        targetId: snapshotId,
        ruleId: v.ruleId,
        severity: v.severity,
        status: outcome.status,
        message: outcome.message,
        evidenceJson: JSON.stringify(outcome.evidence ?? {}),
      });
    }

    // Phase G: ASSERTION — evidence-first. Confidence below threshold never
    // becomes an assertion visible to the public.
    for (const ev of extracted) {
      if (ev.kind === "FIELD" && ev.confidence >= 0.5) {
        await this.deps.writer.saveAssertion({
          entityType: "institution",
          entityId: source.institutionId ?? "unknown",
          fieldName: ev.capability.toLowerCase(),
          value: ev.text ?? "",
          sourceId: source.id,
          sourceSnapshotId: snapshotId,
          observedAt: now,
          confidence: ev.confidence,
          verificationStatus: "UNVERIFIED",
        } satisfies AssertionInput);
      }
    }

    const lifecycle: IngestionLifecycle = "EXTRACTED";
    return { url: target.url, capability: target.capability, lifecycle: lifecycle as string, persisted: true, contentHash: fetched.contentHash };
  }

  private async fetchAndAudit(source: IngestionSourceSpec, target: DiscoveredTarget, runId: string, fetchOpts?: FetchOptions): Promise<FetchResult | null> {
    try {
      const r = await this.deps.fetcher.fetch(target.url, fetchOpts);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : safeStringify(e).slice(0, 400);
      await this.deps.writer.appendAudit({ action: "FETCH_FAILED", targetType: "ingestion_item", targetId: runId, afterJson: JSON.stringify({ url: target.url, error: msg.slice(0, 400) }) });
      await this.deps.writer.saveError({ runId, sourceId: source.id, url: target.url, errorType: "FETCH_FAILED", errorMessage: msg.slice(0, 400), retryCount: 0 });
      return null;
    }
  }

  private async priorHash(sourceId: string, url: string): Promise<string | null> {
    return this.deps.registry.lastContentHash(sourceId, url);
  }
}

/** Convenience: build an engine from just the deps. */
export function buildEngine(deps: EngineDeps): GenericIngestionEngine {
  return new GenericIngestionEngine(deps);
}