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

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Capabilities whose fetched pages are walked one level deeper (Phase F). */
const SECTION_CAPS = new Set<string>([
  "REPORTS",
  "DOCUMENT_ARCHIVE",
  "CAREER_PAGE",
  "BRANCH_DIRECTORY",
  "NEWS",
]);

/** A processed target plus the sub-targets it yielded (sitemap deref / walk). */
interface ProcessedTarget {
  item: EngineResult["items"][number];
  subs: DiscoveredTarget[];
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
import {
  extractSameHostLinks,
  isSitemapUrl,
  locateCapabilityForUrl,
  parseSitemapLocs,
} from "./discovery";
import type {
  AssertionInput,
  ErrorInput,
  FetchOptions,
  ItemInput,
  OutboundLinkInput,
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

    // Phase F (deeper): the crawl is a bounded work queue, so targets discovered
    // mid-run are still processed under the SAME budget. Two carriers extend the
    // original list: SITEMAP dereference (a fetched sitemap file yields its
    // <loc> entries as real pages) and the one-level LINK walk (a fetched
    // capability page yields its own same-host pages). Every sub-target passes
    // through the normal idempotent processTarget path.
    const queue = targets.slice(0, maxTargets);
    let processed = 0;

    while (queue.length > 0) {
      if (processed >= maxTargets) break;
      const target = queue.shift()!;
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
        processed += 1;
        continue;
      }
      processed += 1;
      if (seenUrls.has(target.url)) continue; // same URL already ingested this run
      seenUrls.add(target.url);

      const { item, subs } = await this.processTarget(source, target, runId, now, opts, budget);
      items.push(item);
      fetches += 1;
      if (docKinds.has(target.capability) && item.lifecycle !== "FAILED") documents += 1;
      if (item.lifecycle === "FAILED") {
        errors.push({ runId, sourceId, url: target.url, errorType: "ITEM_FAILED", errorMessage: item.lifecycle === "FAILED" ? `processing failed for ${target.url}` : "", retryCount: 0 });
      }
      const remaining = maxTargets - processed;
      if (subs.length > 0) {
        for (const sub of subs.slice(0, remaining)) queue.push(sub);
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
  ): Promise<ProcessedTarget> {
    const fetcher: Fetcher = this.deps.fetcher;

    if (opts.dryRun) {
      return { item: { url: target.url, capability: target.capability, lifecycle: "DISCOVERED", persisted: false }, subs: [] };
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
      return { item: { url: target.url, capability: target.capability, lifecycle: "FAILED", persisted: false }, subs: [] };
    }

    await this.deps.writer.appendAudit({ action: "FETCH_COMPLETED", targetType: "ingestion_item", targetId: runId, afterJson: JSON.stringify({ contentHash: fetched.contentHash, status: fetched.httpStatus, mimeType: fetched.contentType }) });

    if (fetched.httpStatus === null || fetched.httpStatus >= 400) {
      await this.deps.writer.saveItem({
        runId, url: target.url, itemType: target.capability, status: "FAILED", contentHash: fetched.contentHash || undefined,
      } satisfies ItemInput);
      await this.deps.writer.saveError({ runId, sourceId: source.id, url: target.url, errorType: "HTTP_ERROR", errorMessage: `HTTP ${fetched.httpStatus ?? "none"}`, retryCount: 0 });
      return { item: { url: target.url, capability: target.capability, lifecycle: "FAILED", persisted: true, contentHash: fetched.contentHash || undefined }, subs: [] };
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
      return { item: { url: target.url, capability: target.capability, lifecycle: "UNCHANGED", persisted: true, contentHash: fetched.contentHash }, subs: [] };
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
      // A sitemap CARRIER is discovery infrastructure — never an outbound
      // document link (its <loc> pages are scheduled instead, see below).
      if (target.capability !== "SITEMAP") {
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
      }
      await this.deps.writer.appendAudit({ action: "DOCUMENT_EVIDENCE_PERSISTED", targetType: "ingestion_item", targetId: runId, afterJson: JSON.stringify({ url: target.url, contentHash: fetched.contentHash, mimeType: fetched.contentType }) });
      return {
        item: { url: target.url, capability: target.capability, lifecycle: "CHANGED", persisted: true, contentHash: fetched.contentHash },
        subs: this.derefSitemapCarrier(source, target, fetched),
      };
    }

    // Phase G: EXTRACT — deterministic; failure must NOT lose the snapshot.
    let extracted: ExtractedEvidence[];
    try {
      extracted = await this.deps.extractor.extract(
        { sourceId: source.id, institutionId: source.institutionId, sourceType: source.sourceType, capability: target.capability, url: target.url, parserId: this.deps.extractor.parserId, contentHash: fetched.contentHash, body: fetched.body },
      );
      await this.deps.writer.updateExtractionStatus(snapshotId, "EXTRACTED");
    } catch {
      await this.deps.writer.updateExtractionStatus(snapshotId, "FAILED");
      await this.deps.writer.saveError({ runId, sourceId: source.id, url: target.url, errorType: "EXTRACTION_FAILED", errorMessage: "extractor threw", retryCount: 0 });
      await this.deps.writer.appendAudit({ action: "EXTRACTION_FAILED", targetType: "ingestion_item", targetId: runId });
      return { item: { url: target.url, capability: target.capability, lifecycle: "FAILED", persisted: true, contentHash: fetched.contentHash }, subs: [] };
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
    // becomes an assertion visible to the public. Deduped per snapshot by
    // (field, value) so composed extractors that see the same title (e.g. the
    // NRB listing parser + the financial-metadata parser) assert it once.
    const assertedKeys = new Set<string>();
    for (const ev of extracted) {
      if (ev.kind === "FIELD" && ev.confidence >= 0.5) {
        const key = `${(ev.field ?? ev.capability).toLowerCase()}|${ev.text ?? ""}`;
        if (assertedKeys.has(key)) continue;
        assertedKeys.add(key);
        await this.deps.writer.saveAssertion({
          // Institution-scoped sources assert against the institution;
          // regulator/regulatory sources (e.g. NRB, no institution_id) assert
          // against the source itself so the ledger stays honest per crawler.
          entityType: source.institutionId ? "institution" : "source",
          entityId: source.institutionId ?? source.id,
          fieldName: ev.field ? ev.field.toLowerCase() : ev.capability.toLowerCase(),
          value: ev.text ?? "",
          sourceId: source.id,
          sourceSnapshotId: snapshotId,
          observedAt: now,
          confidence: ev.confidence,
          verificationStatus: "UNVERIFIED",
        } satisfies AssertionInput);
      }
    }

    // Phase G (1.5 addition): LINK evidence → durable outbound_links rows.
    // An HTML page whose extractor saw real links (e.g. NRB arrowed-list
    // entries) persists each as an outbound document link — the same row shape
    // the non-HTML document path writes above, but sourced from a listing page.
    // Availability stays UNKNOWN until a future depth check inspects the target.
    for (const ev of extracted) {
      if (ev.kind !== "LINK" || (ev.confidence ?? 0) < 0.5) continue;
      if (!ev.href || ev.href.startsWith("#") || ev.href.startsWith("javascript:")) continue;
      let targetUrl: string;
      try {
        targetUrl = new URL(ev.href, target.url).href;
      } catch {
        continue;
      }
      const knownTargetTypes = new Set(["WEBSITE", "DOCUMENT", "JOB", "DIRECTIVE", "NOTICE", "SOCIAL", "OTHER"]);
      let targetType: OutboundLinkInput["targetType"] = "DOCUMENT";
      if (ev.documentType && knownTargetTypes.has(ev.documentType)) {
        targetType = ev.documentType as OutboundLinkInput["targetType"];
      }
      try {
        await this.deps.writer.saveOutboundLink({
          scopeKey: source.institutionId ?? source.id,
          institutionId: source.institutionId,
          slug: documentSlug(targetUrl),
          targetType,
          label: ev.text ?? `document at ${targetUrl}`,
          targetUrl,
          availabilityStatus: "UNKNOWN",
          sourceId: source.id,
          firstSeenAt: now,
          lastCheckedAt: now,
          description: ev.description,
        });
        await this.deps.writer.appendAudit({ action: "OUTBOUND_LINK_PERSISTED", targetType: "outbound_link", targetId: runId, afterJson: JSON.stringify({ url: targetUrl, slug: documentSlug(targetUrl) }) });
      } catch (e) {
        await this.deps.writer.appendAudit({ action: "OUTBOUND_LINK_PERSISTED", targetType: "outbound_link", targetId: runId, afterJson: JSON.stringify({ url: targetUrl, error: (e as Error).message }) });
      }
    }

    const lifecycle: IngestionLifecycle = "EXTRACTED";
    return {
      item: { url: target.url, capability: target.capability, lifecycle: lifecycle as string, persisted: true, contentHash: fetched.contentHash },
      subs: this.walkLinks(source, target, fetched),
    };
  }

  /**
   * SITEMAP dereference (Phase F, deeper): when a fetched target is actually a
   * sitemap carrier (WordPress wp-sitemap index/sub-sitemap, custom sitemaps),
   * its <loc> entries are scheduled as real capability pages instead of the
   * XML file being treated as an extractable page. Recursion is handled by the
   * work queue: sub-sitemap targets deref again in-process to their posts.
   */
  private derefSitemapCarrier(
    source: IngestionSourceSpec,
    target: DiscoveredTarget,
    fetched: FetchResult,
  ): DiscoveredTarget[] {
    if (target.capability !== "SITEMAP" && !isSitemapUrl(target.url)) return [];
    if (fetched.bodyBytes > 4 * 1024 * 1024) return [];
    let text: string;
    try {
      text = new TextDecoder("utf-8").decode(fetched.body);
    } catch {
      return [];
    }
    if (!/<loc/i.test(text)) return [];

    const host = hostnameOf(source.url);
    if (!host) return [];
    const now = new Date().toISOString();
    const subs: DiscoveredTarget[] = [];
    for (const loc of parseSitemapLocs(text)) {
      if (subs.length >= 64) break; // hard cap per carrier
      let href: string;
      try {
        const u = new URL(loc);
        if (u.hostname.toLowerCase() !== host) continue; // foreign → skip
        u.hash = "";
        u.search = "";
        href = u.href.replace(/\/$/, "") || u.href;
      } catch {
        continue;
      }
      const cap = locateCapabilityForUrl(loc);
      if (!cap) continue; // no hint, not a sitemap tool → not a capability page
      if (!source.capabilities.some((c) => c.kind === cap)) continue; // gated
      subs.push({
        capability: cap,
        url: href,
        method: "SITEMAP",
        parentUrl: target.url,
        sourceId: source.id,
        institutionId: source.institutionId,
        discoveredAt: now,
        status: "CANDIDATE",
      });
    }
    return subs;
  }

  /**
   * One-level deeper LINK walk (Phase F, deeper): a fetched capability page
   * yields its own same-host links, classified by the same hint rules (so a
   * /reports/ index surfaces its report pages). Bounded: only walked for the
   * five section capabilities, never for asset/media/foreign URLs.
   */
  private walkLinks(
    source: IngestionSourceSpec,
    target: DiscoveredTarget,
    fetched: FetchResult,
  ): DiscoveredTarget[] {
    if (!SECTION_CAPS.has(target.capability)) return [];
    if (fetched.bodyBytes > 4 * 1024 * 1024) return [];

    const host = hostnameOf(source.url);
    if (!host) return [];
    let text: string;
    try {
      text = new TextDecoder("utf-8").decode(fetched.body);
    } catch {
      return [];
    }
    const now = new Date().toISOString();
    const subs: DiscoveredTarget[] = [];
    for (const raw of extractSameHostLinks(text, host)) {
      if (subs.length >= 64) break; // hard cap per walked page
      const cap = locateCapabilityForUrl(raw);
      if (!cap || cap === "WEBSITE" || cap === "SITEMAP") continue;
      if (!source.capabilities.some((c) => c.kind === cap)) continue; // gated
      let href: string;
      try {
        const u = new URL(raw);
        u.hash = "";
        u.search = "";
        href = u.href.replace(/\/$/, "") || u.href;
      } catch {
        continue;
      }
      subs.push({
        capability: cap,
        url: href,
        method: "LINK",
        parentUrl: target.url,
        sourceId: source.id,
        institutionId: source.institutionId,
        discoveredAt: now,
        status: "CANDIDATE",
      });
    }
    return subs;
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