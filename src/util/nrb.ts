// ============================================================================
// NRB publication categorisation (P2-6).
//
// The snapshot's own `docType` is coarse — REPORT / KFI / ENFORCEMENT — and its
// `topic` is mostly null. Both describe how the file was filed, not what the
// publication is. This module maps each document to the publication category
// NRB actually publishes it under, keyed to the rows of docs/NRB-SOURCE-MAP.md,
// so the NRB page can group by real series instead of by file type.
//
// Two rules carry over from the rest of the site:
//   * the mapping is deterministic and title + type driven — no inference from
//     unread document contents (no PDF has been parsed);
//   * a category NRB publishes but this snapshot does not contain (Directives,
//     Circulars) is reported as absent, never omitted and never invented.
// ============================================================================
import type { NrbDocument } from "@/types";
import type { Tone } from "@/util/evidence";

export type NrbCategoryKey =
  | "directives"
  | "circulars"
  | "mfi_situation"
  | "kfis"
  | "interest_rates"
  | "progress"
  | "sources_uses"
  | "supervision"
  | "licensed_list"
  | "annual_report"
  | "aml_cft"
  | "enforcement";

export interface NrbCategory {
  key: NrbCategoryKey;
  /** Short label for a chip or heading. */
  label: string;
  /** The row of NRB-SOURCE-MAP this publication category maps to. */
  sourceMapSection: string;
  tone: Tone;
  /** Sentence explaining what the category is, shown as a legend. */
  help: string;
  /**
   * Whether NRB publishes this category at all. A declared category with no
   * documents in the snapshot is a coverage gap, not a category to hide.
   */
  match: (doc: NrbDocument) => boolean;
}

/** Label used for a document no known series rule claims. */
export const NRB_UNCATEGORISED_LABEL = "Filed by type only";

// Order is the display order and mirrors the NRB-SOURCE-MAP table: regulatory
// instruments first, then periodic data series, then the register and reports.
export const NRB_CATEGORIES: readonly NrbCategory[] = [
  {
    key: "directives",
    label: "Directives",
    sourceMapSection: "Unified Directive for \u201cD\u201d Class MFIs",
    tone: "attention",
    help: "The unified directive that sets licensing, reporting and prudential requirements.",
    match: (d) => /unified directive|directive/i.test(d.title),
  },
  {
    key: "circulars",
    label: "Circulars",
    sourceMapSection: "Circulars/Amendments",
    tone: "attention",
    help: "Amendments and clarifications to a directive, with their effective dates.",
    match: (d) => /circular|amendment/i.test(d.title),
  },
  {
    key: "mfi_situation",
    label: "MFI Situation",
    sourceMapSection: "MFI Situation",
    tone: "info",
    help: "The periodic state of the microfinance sector, published each quarter.",
    match: (d) => /situation of microfinance/i.test(d.title),
  },
  {
    key: "kfis",
    label: "Key Financial Indicators",
    sourceMapSection: "Key Financial Indicators (KFIs)",
    tone: "info",
    help: "Periodic financial indicators, by institution and for the sector.",
    // Covers the source's own "Finacial" spelling alongside the correct one.
    match: (d) => /key fina(?:n)?cial indicators/i.test(d.title),
  },
  {
    key: "interest_rates",
    label: "Interest Rates",
    sourceMapSection: "Interest Rates",
    tone: "info",
    help: "The microfinance interest-rate structure, by reporting period.",
    match: (d) => /interest[\s-]?rate/i.test(d.title),
  },
  {
    key: "progress",
    label: "Progress Reports",
    sourceMapSection: "Progress Reports",
    tone: "positive",
    help: "The sector's progress and developments over a period.",
    match: (d) => /progress report/i.test(d.title),
  },
  {
    key: "sources_uses",
    label: "Sources & Uses",
    sourceMapSection: "Sources and Uses",
    tone: "neutral",
    help: "Where microfinance funding comes from and where it goes, by period.",
    match: (d) => /sources and uses/i.test(d.title),
  },
  {
    key: "supervision",
    label: "Supervision Reports",
    sourceMapSection: "Supervision/Publications",
    tone: "attention",
    help: "Supervision findings, published where the regulator makes them public.",
    match: (d) => /supervision report/i.test(d.title),
  },
  {
    key: "licensed_list",
    label: "Licensed Institution List",
    sourceMapSection: "Licensed institution register",
    tone: "neutral",
    help: "The regulator's own register of licensed banks and financial institutions.",
    match: (d) => /bfi.?s list|\u0928\u093e\u092e\u093e\u0935\u0932\u0940|licensed.*financial institutions/i.test(d.title),
  },
  {
    key: "aml_cft",
    label: "AML/CFT Supervision",
    sourceMapSection: "Money Laundering Prevention/Supervision",
    tone: "attention",
    help: "Anti-money-laundering and counter-financing-of-terrorism supervision reports.",
    match: (d) => d.topic === "AML_CFT" || /fiu.?nepal|money laundering|aml.?cft/i.test(d.title),
  },
  {
    key: "enforcement",
    label: "Enforcement Actions",
    sourceMapSection: "Supervision/Publications",
    tone: "conflict",
    help: "Enforcement actions the regulator took against licensed institutions.",
    match: (d) => d.docType === "ENFORCEMENT" || /enforcement action/i.test(d.title),
  },
  // "Annual report" is the most generic title on the register, so its rule is
  // evaluated last: a report that is also an AML/CFT or supervision report is
  // claimed by the narrower series above first.
  {
    key: "annual_report",
    label: "Annual Reports",
    sourceMapSection: "Annual Report",
    tone: "neutral",
    help: "The regulator's annual report and its earlier fiscal-year editions.",
    match: (d) => /annual report/i.test(d.title) || /^FY\s?\d{4}\/\d{2}/i.test(d.title),
  },
];

const BY_KEY = new Map(NRB_CATEGORIES.map((c) => [c.key, c]));

/**
 * The publication category a document belongs to, or `null` when no known
 * series claims it. Rules are evaluated in NRB_CATEGORIES order, so a narrower
 * rule (AML/CFT before Supervision) wins over a broader one.
 */
export function nrbCategory(doc: NrbDocument): NrbCategoryKey | null {
  for (const category of NRB_CATEGORIES) {
    if (category.match(doc)) return category.key;
  }
  return null;
}

export interface NrbCategoryCoverage {
  category: NrbCategory;
  count: number;
  /** True when at least one document in the snapshot carries this category. */
  present: boolean;
}

/**
 * Counts the snapshot per category and marks the declared-but-absent ones, so
 * the page can state a gap ("Directives: none in this snapshot") rather than
 * silently drop the category. `uncategorised` counts documents no rule claimed.
 */
export function nrbCategoryCoverage(docs: readonly NrbDocument[]): {
  categories: NrbCategoryCoverage[];
  uncategorised: number;
} {
  const counts = new Map<NrbCategoryKey, number>();
  let uncategorised = 0;
  for (const doc of docs) {
    const key = nrbCategory(doc);
    if (key === null) {
      uncategorised += 1;
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    categories: NRB_CATEGORIES.map((category) => {
      const count = counts.get(category.key) ?? 0;
      return { category, count, present: count > 0 };
    }),
    uncategorised,
  };
}

/** Looks up a category definition by key. */
export function nrbCategoryByKey(key: NrbCategoryKey): NrbCategory {
  const category = BY_KEY.get(key);
  if (!category) throw new Error(`Unknown NRB category: ${key}`);
  return category;
}
