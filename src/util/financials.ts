import type { FinancialSourceOwner } from "../../lib/repository/types";

/**
 * Period discipline for financial metadata.
 *
 * A financial figure means nothing without knowing *which* period it reports,
 * *when* it was published, and *what point* it is as-of. Those are three
 * different dates and they are not interchangeable: a report can cover a period
 * that closed months before it was published and was observed even later. The
 * documents this product holds have only the last of the three — a sweep saw a
 * link — and nothing has been read to fill the other two.
 *
 * So the labels live here, once. Every page states which date it is showing, and
 * a field nothing fills reports the vocabulary word from
 * `DATA-STATUS-VOCABULARY.md` rather than a blank or a substitute date.
 */

/** The three published dates a financial record can carry, plus our observation. */
export const REPORTING_PERIOD_LABEL = "Reporting period";
export const PUBLICATION_DATE_LABEL = "Publication date";
export const AS_OF_LABEL = "As of";
export const OBSERVED_LABEL = "Observed";

/**
 * What a reporting period / publication date is when the document exists but its
 * body was never read: the disclosure is known to exist, the value is not read.
 */
export const PERIOD_NOT_EXTRACTED = "Not extracted";

/** The one-line evidence statement every financial surface carries. */
export const PERIOD_DISCIPLINE_NOTE =
  "Reporting period, publication date and as-of are distinct dates. The document body has not been read, so only the date we observed the link is known.";

export const SOURCE_OWNER_LABEL: Record<FinancialSourceOwner, string> = {
  institution: "Institution-published",
  nrb: "NRB-published",
  derived: "Derived by Laghubitta Khabar",
};

/**
 * Who published a financial claim, as a label. Unknown owners read as a stated
 * absence rather than defaulting to any of the three real owners.
 */
export function sourceOwnerLabel(owner: string | null | undefined): string {
  const key = String(owner ?? "").toLowerCase() as FinancialSourceOwner;
  return SOURCE_OWNER_LABEL[key] ?? "Owner not stated";
}

export interface FinancialPeriodInput {
  reporting_period?: string | null;
  publication_date?: string | null;
  as_of_date?: string | null;
  observed_at?: string | null;
}

export interface FinancialPeriodLine {
  term: string;
  value: string;
}

/**
 * The labelled date fields for one financial record, in a fixed order. A field
 * nothing fills reports the vocabulary word, never a blank and never a date
 * borrowed from another field.
 */
export function financialPeriodLines(input: FinancialPeriodInput): FinancialPeriodLine[] {
  return [
    { term: REPORTING_PERIOD_LABEL, value: input.reporting_period ?? PERIOD_NOT_EXTRACTED },
    { term: PUBLICATION_DATE_LABEL, value: input.publication_date ?? PERIOD_NOT_EXTRACTED },
    { term: AS_OF_LABEL, value: input.as_of_date ?? PERIOD_NOT_EXTRACTED },
    { term: OBSERVED_LABEL, value: input.observed_at ?? "Not recorded" },
  ];
}
