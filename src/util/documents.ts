import type { DocumentDto, FinancialDocumentDto } from "../../lib/repository/types";

/**
 * Document taxonomy.
 *
 * The ideal taxonomy — annual report, audited statements, interim, corporate
 * governance, AGM, M&A, policy … — is a *content* classification, and this
 * project has read none of these documents. Inventing a class from a title would
 * publish a claim no source made, so the classes here are the ones the evidence
 * itself carries: who published the document and the type its source assigned.
 *
 * Three evidence fields feed the taxonomy and nothing else does:
 *   - an NRB ledger `docType` (ENFORCEMENT / KFI / REPORT) — see `nrbDocumentClass`;
 *   - an institution report's `reportType` or a rate notice's `kind` —
 *     see `financialDocumentClass`;
 *   - a general document's `doc_type` (DOCUMENT / NOTICE), which is the capability
 *     the link title arrived under, not a guessed category — see
 *     `generalDocumentClass`.
 *
 * Where evidence supplies no type, the record is filed under the general class for
 * its layer ("Report" / "Document link"), never a fabricated specific class.
 */

export type DocumentClass =
  | "regulatory-action"
  | "supervision"
  | "regulator-publication"
  | "financial-report"
  | "rate-notice"
  | "notice"
  | "document-link";

/** Stable display order: regulator-first, then institution-published classes. */
export const DOCUMENT_CLASS_ORDER: readonly DocumentClass[] = [
  "regulatory-action",
  "supervision",
  "regulator-publication",
  "financial-report",
  "rate-notice",
  "notice",
  "document-link",
];

export const DOCUMENT_CLASS_LABEL: Record<DocumentClass, string> = {
  "regulatory-action": "Regulatory action",
  supervision: "Supervision & inclusion",
  "regulator-publication": "Regulator publication",
  "financial-report": "Financial report",
  "rate-notice": "Rate notice",
  notice: "Notice",
  "document-link": "Document link",
};

/** One-line statement of what a class holds, shown beside the filter. */
export const DOCUMENT_CLASS_DETAIL: Record<DocumentClass, string> = {
  "regulatory-action": "Enforcement and directives Nepal Rastra Bank published against institutions.",
  supervision: "Supervision and financial-inclusion reporting published by Nepal Rastra Bank.",
  "regulator-publication": "Reports and other publications from Nepal Rastra Bank's own ledger.",
  "financial-report": "A report an institution published on its own site.",
  "rate-notice": "A rate notice an institution published on its own site.",
  notice: "A notice title observed as a link on an institution's own site.",
  "document-link": "A document title observed as a link on an institution's own site.",
};

/** The precise type label for a row's chip, independent of its class. */
export const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  ENFORCEMENT: "Enforcement",
  KFI: "Financial inclusion",
  REPORT: "Report",
  REPORT_NOTICE: "Rate notice",
  ANNUAL: "Annual report",
  QUARTERLY: "Quarterly report",
  UNAUDITED: "Unaudited report",
  DOCUMENT: "Document link",
  NOTICE: "Notice",
};

function humanizeType(type: string): string {
  const spaced = type.replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The label for a document's type, falling back to the raw type, humanized. */
export function documentTypeLabel(type: string | null | undefined): string {
  if (typeof type !== "string" || type.trim() === "") return "Document";
  return DOCUMENT_TYPE_LABEL[type] ?? humanizeType(type);
}

/** Class of an NRB-ledger document, from the type its source list carried. */
export function nrbDocumentClass(docType: string): DocumentClass {
  if (docType === "ENFORCEMENT") return "regulatory-action";
  if (docType === "KFI") return "supervision";
  return "regulator-publication";
}

/** Class of a document found on an institution's own site (P2-C financial layer). */
export function financialDocumentClass(doc: Pick<FinancialDocumentDto, "kind">): DocumentClass {
  return doc.kind === "RATE" ? "rate-notice" : "financial-report";
}

/** Class of a general (non-financial) document recorded as a link title (P2-D). */
export function generalDocumentClass(doc: Pick<DocumentDto, "doc_type">): DocumentClass {
  return doc.doc_type === "NOTICE" ? "notice" : "document-link";
}
