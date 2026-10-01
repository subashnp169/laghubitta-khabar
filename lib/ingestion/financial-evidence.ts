/**
 * Phase C financials — evidence planning and application.
 *
 * Financial evidence is document-anchored and nothing else. The apply pass
 * re-fetches the report pages and rate documents the previous pipelines located,
 * snapshots them, and asserts one entity per observed document: the URL, the title
 * (from an anchor or the filename), and a deterministic kind. It never reads a PDF
 * body, so no numeric metric and no numeric rate is ever asserted — a number a
 * system cannot show byte-level is a claim it cannot defend, and Phase C asserts
 * none.
 *
 * Two decisions live here as rules, mirroring the careers grammar:
 *
 *  1. WHAT may be asserted. Every stored assertion is a document fact observed in
 *     the snapshot: the document URL, its title as taken from an anchor or
 *     filename, and a kind assigned by the deterministic keyword classifier (so a
 *     URL containing "base rate" is asserted as BASE_RATE, not by reading the
 *     file). Periods are never asserted: no extractor produced a period this
 *     system can show (document dates stayed below 0.5 in the base crawl).
 *  2. WHEN an assertion is new. Idempotency is a read followed by a conditional
 *     write, because the frozen schema has no uniqueness constraint on
 *     `data_assertions` and a blind insert would append a duplicate on every run.
 *
 * A document's contents are never asserted. A financial report stays a record of
 * "this institution's own site links a document whose name reads as a report"; the
 * reader is told the contents were not read, exactly like a careers unread notice.
 */

import type {
  AssertionInput,
  ConflictInput,
  EvidenceWriter,
  StoredAssertion,
} from "./contract";
import { SOURCE_DOCUMENT } from "./careers";

/** The entity type every financial assertion is written under. */
export const FINANCIAL_ENTITY_TYPE = "FINANCIAL";

/** Parser version recorded on every snapshot this pass writes. */
export const FINANCIAL_PARSER_VERSION = "financials-html-v1";

/** The confidence at or above which a stored assertion is a publishable fact. */
export const PUBLISHABLE_CONFIDENCE = 0.5;

/** Document fields the planner may assert. Nothing else is invented for a file. */
export const DOCUMENT_TITLE = "DOCUMENT_TITLE";
export const DOCUMENT_TYPE = "DOCUMENT_TYPE";
export const RATE_KIND = "RATE_KIND";

// ---------------------------------------------------------------------------
// Deterministic classification. These rules assign a kind from the URL and the
// title an institution's own page gave the document; they do not read the file.
// First match wins, and the order is fixed so the same name always classifies
// the same way.
// ---------------------------------------------------------------------------

const REPORT_TYPE_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["AUDITED", /\baudited\b|लेखापरीक्षित/i],
  ["UNAUDITED", /\bunaudited\b|अलेखापरीक्षित/i],
  ["ANNUAL", /\bannual\b|बार्षिक|वार्षिक प्रतिवेदन|वार्षिक सभा|\bagm\b|\baagm\b/i],
  ["HALF_YEARLY", /\bhalf[ \-]?year\b|अर्धवार्षिक|six[ \-]?month/i],
  ["NINE_MONTH", /\bnine[ \-]?month\b|नव महिना/i],
  ["QUARTERLY", /\bquarter(?:ly)?\b|\bq[1-4]\b|त्रैमासिक/i],
  ["INTERIM", /\binterim\b|अन्तरिम|statement|विवरण/i],
];

const RATE_KIND_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["BASE_RATE", /\bbase[ \-]?rates?\b|आधार दर|मूल ब्याजदर/i],
  ["SAVINGS", /\bsaving(?:s)?\b|बचत/i],
  ["DEPOSIT", /\bdeposit\b|निक्षेप/i],
  ["REMITTANCE", /\bremittance\b|रेमिट्यान्स/i],
  ["LOAN", /\bloan\b|कर्ज/i],
  ["RATE_CHANGE", /\bchange\b[^]*\brate\b|\brate\b[^]*\bchange\b/i],
  ["INTEREST_RATE", /\binterest[ \-]?rates?\b|ब्याजदर|ब्याज/i],
];

export type FinancialReportKind =
  | "AUDITED"
  | "UNAUDITED"
  | "ANNUAL"
  | "HALF_YEARLY"
  | "NINE_MONTH"
  | "QUARTERLY"
  | "INTERIM"
  | "OTHER";

export type RateNoticeKind =
  | "BASE_RATE"
  | "SAVINGS"
  | "DEPOSIT"
  | "REMITTANCE"
  | "LOAN"
  | "RATE_CHANGE"
  | "INTEREST_RATE"
  | "OTHER";

export interface FinancialClassification {
  role: "REPORT" | "RATE" | "NONE";
  reportType: FinancialReportKind | null;
  rateKind: RateNoticeKind | null;
}

/**
 * Classify a document from everything the source itself gave us: the URL and the
 * title an anchor carried. "NONE" means nothing in the name reads as financial,
 * and such a link is never asserted as financial evidence.
 */
export function classifyFinancialDocument(url: string, title: string): FinancialClassification {
  const haystack = `${url} ${title}`;
  for (const [kind, re] of RATE_KIND_RULES) {
    if (re.test(haystack)) {
      return { role: "RATE", reportType: null, rateKind: kind as RateNoticeKind };
    }
  }
  for (const [kind, re] of REPORT_TYPE_RULES) {
    if (re.test(haystack)) {
      return { role: "REPORT", reportType: kind as FinancialReportKind, rateKind: null };
    }
  }
  return { role: "NONE", reportType: null, rateKind: null };
}

/**
 * Stable identity for one observed financial document. The URL is the only thing
 * the snapshot proved, so the identity is built from it: the same URL always
 * resolves to the same entity, and a different URL is a different document.
 */
export function financialId(institutionId: string, url: string): string {
  return `financial-${institutionId}|${url.toLowerCase()}`;
}

/** A document title read out of an anchor or a filename. */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const name = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    if (name) return name;
  } catch {
    /* keep the raw string below */
  }
  return url;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface FinancialPlannedAssertion {
  fieldName: string;
  value: string;
  confidence: number;
  evidenceOnly: boolean;
}

export interface FinancialDocumentPlan {
  entityId: string;
  institutionId: string;
  url: string;
  title: string;
  role: "REPORT" | "RATE";
  reportType: FinancialReportKind | null;
  rateKind: RateNoticeKind | null;
  assertions: FinancialPlannedAssertion[];
}

/**
 * Plan the assertions for one observed financial document. Every field is a
 * document fact: the URL (always), the title (only when one was observed), and
 * the deterministic kind (only when the classifier assigned one). A type is a
 * claim about naming, never about contents, and is therefore written at the same
 * 0.5 publishable bar as the URL itself.
 */
export function planFinancialDocumentEvidence(input: {
  institutionId: string;
  url: string;
  title?: string | null;
  classification: FinancialClassification;
}): FinancialDocumentPlan {
  // An anchor that labels a document by its bare URL — in any case, encoded or
  // not — has contributed no title at all; the filename is the only name the
  // source gave it. Guarding this in the planner keeps every phase writing the
  // same title for the same entity, so a re-run cannot churn the row.
  const trimmed = input.title?.trim() ?? "";
  const title =
    trimmed && !/^https?:\/\//i.test(trimmed) && trimmed !== input.url
      ? trimmed
      : titleFromUrl(input.url);
  const assertions: FinancialPlannedAssertion[] = [
    { fieldName: SOURCE_DOCUMENT, value: input.url, confidence: 0.5, evidenceOnly: false },
    { fieldName: DOCUMENT_TITLE, value: title, confidence: 0.5, evidenceOnly: false },
  ];
  if (input.classification.reportType) {
    assertions.push({
      fieldName: DOCUMENT_TYPE,
      value: input.classification.reportType,
      confidence: 0.5,
      evidenceOnly: false,
    });
  }
  if (input.classification.rateKind) {
    assertions.push({
      fieldName: RATE_KIND,
      value: input.classification.rateKind,
      confidence: 0.5,
      evidenceOnly: false,
    });
  }
  return {
    entityId: financialId(input.institutionId, input.url),
    institutionId: input.institutionId,
    url: input.url,
    title,
    role: input.classification.role === "RATE" ? "RATE" : "REPORT",
    reportType: input.classification.reportType,
    rateKind: input.classification.rateKind,
    assertions,
  };
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export type FinancialWriteStatus = "NEW" | "UNCHANGED" | "CHANGED" | "CONFLICTED";

export interface FinancialApplyContext {
  sourceId: string;
  sourceSnapshotId: string;
  observedAt: string;
  runId: string;
}

function activeFinancial(rows: readonly StoredAssertion[]): StoredAssertion[] {
  return rows.filter((r) => r.valid_to === null);
}

/**
 * Apply one planned document's assertions, per field per source, with the same
 * conflict and idempotency guarantees as the careers grammar: identical current
 * value is left alone, a different value closes the old row and appends the new
 * one, and disagreement from a different source is a recorded conflict while both
 * values stay readable.
 */
export async function applyFinancialDocument(
  writer: EvidenceWriter,
  plan: FinancialDocumentPlan,
  ctx: FinancialApplyContext,
): Promise<{ entityId: string; status: FinancialWriteStatus; fieldsWritten: number }> {
  let status: FinancialWriteStatus = "UNCHANGED";
  let fieldsWritten = 0;

  for (const a of plan.assertions) {
    const own = await writer.findAssertions({
      entityType: FINANCIAL_ENTITY_TYPE,
      entityId: plan.entityId,
      fieldName: a.fieldName,
      sourceId: ctx.sourceId,
    });
    const ownActive = activeFinancial(own);

    const all = await writer.findAssertions({
      entityType: FINANCIAL_ENTITY_TYPE,
      entityId: plan.entityId,
      fieldName: a.fieldName,
    });
    const others = activeFinancial(all).filter((r) => r.source_id !== ctx.sourceId);
    const conflictedWith = others.filter((r) => r.value !== a.value).map((r) => r.source_id);

    for (const other of conflictedWith) {
      const otherRow = others.find((r) => r.source_id === other && r.value !== a.value);
      const conflict: ConflictInput = {
        entityType: FINANCIAL_ENTITY_TYPE,
        entityId: plan.entityId,
        fieldName: a.fieldName,
        sourceAId: other,
        valueA: otherRow?.value ?? "",
        sourceBId: ctx.sourceId,
        valueB: a.value,
        detectedAt: ctx.observedAt,
        resolutionStatus: "OPEN",
        resolutionNote: "cross-source disagreement on the same financial document",
      };
      await writer.saveConflict(conflict);
    }

    if (ownActive.some((r) => r.value === a.value)) continue;

    for (const prior of ownActive) {
      await writer.supersedeAssertion({
        id: prior.id,
        validTo: ctx.observedAt,
        status: "STALE",
        reason: "re-observed with a different value from the same source",
      });
    }

    const reverted = own.find((r) => r.value === a.value);
    if (reverted && writer.reviveAssertion) {
      const ok = await writer.reviveAssertion({
        id: reverted.id,
        observedAt: ctx.observedAt,
        sourceSnapshotId: ctx.sourceSnapshotId,
        confidence: a.confidence,
      });
      if (ok) {
        status = "CHANGED";
        fieldsWritten++;
        continue;
      }
    }

    const input: AssertionInput = {
      entityType: FINANCIAL_ENTITY_TYPE,
      entityId: plan.entityId,
      fieldName: a.fieldName,
      value: a.value,
      sourceId: ctx.sourceId,
      sourceSnapshotId: ctx.sourceSnapshotId,
      observedAt: ctx.observedAt,
      confidence: a.confidence,
      verificationStatus: "UNVERIFIED",
    };
    await writer.saveAssertion(input);
    status = ownActive.length > 0 ? "CHANGED" : "NEW";
    fieldsWritten++;
  }

  await writer.appendAudit({
    action: "FINANCIAL_EVIDENCE_APPLIED",
    targetType: FINANCIAL_ENTITY_TYPE,
    targetId: plan.entityId,
    afterJson: JSON.stringify({
      url: plan.url,
      title: plan.title,
      role: plan.role,
      reportType: plan.reportType,
      rateKind: plan.rateKind,
      runId: ctx.runId,
      writes: plan.assertions.map((x) => x.fieldName),
    }),
  });

  return { entityId: plan.entityId, status, fieldsWritten };
}