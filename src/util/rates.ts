import type { Tone } from "@/util/evidence";

/**
 * Interest-rate vocabulary and the "never a naked percentage" rule.
 *
 * A rate is only meaningful with the context it was published in: what it
 * applies to, on what basis, over which period, effective from when, and from
 * which source. A bare `10%` with none of that is not a fact — it is a number
 * detached from its claim, and the reference material forbids it
 * (`INSTITUTION-MASTER-MODEL.md` §Interest rates, `NRB-SOURCE-MAP.md` §Interest
 * Rates).
 *
 * So presentation lives here, once. `rateValue` refuses to release a percentage
 * unless the basis that makes it a rate is also present; when it is not, it
 * returns the evidence-vocabulary word for why (Not extracted / Unknown / Not
 * found) rather than substituting a value.
 */

/** The notice classification carried on the document itself. */
export const RATE_KIND_LABEL: Record<string, string> = {
  INTEREST_RATE: "Interest rate",
  RATE_CHANGE: "Rate change",
  BASE_RATE: "Base rate",
  SAVINGS: "Savings",
  DEPOSIT: "Deposit",
  REMITTANCE: "Remittance",
  LOAN: "Loan",
};

/** Human label for a rate-notice kind, falling back to a plain title-case read. */
export function rateKindLabel(kind: string | null | undefined): string {
  if (!kind) return "Rate notice";
  return RATE_KIND_LABEL[kind] ?? kind.replace(/_/g, " ").toLowerCase();
}

export interface RatePresentation {
  /** True only when a sourced, contextualised value exists. */
  available: boolean;
  /** The chip/table text: a contextualised value, or a vocabulary word. */
  label: string;
  tone: Tone;
  /** Why this value is shown, or why it is not. */
  help: string;
}

/**
 * Vocabulary for the *rate value* itself, mapped to the product-wide status
 * terms in `DATA-STATUS-VOCABULARY.md`. These are the only states a missing
 * value may be described in — never `0`, `-`, or an estimate.
 */
export const RATE_VALUE_STATE: Record<string, RatePresentation> = {
  CURRENT: {
    available: false,
    label: "Current",
    tone: "info",
    help: "A current value is recorded for this notice.",
  },
  NOT_EXTRACTED: {
    available: false,
    label: "Not extracted",
    tone: "attention",
    help: "The notice was located, but no rate value has been read from it. Open the document to see the rate.",
  },
  UNKNOWN: {
    available: false,
    label: "Unknown",
    tone: "neutral",
    help: "No evidence of a rate value was located, so it cannot be determined.",
  },
  NOT_FOUND: {
    available: false,
    label: "Not found",
    tone: "neutral",
    help: "The monitored public sources do not contain this rate disclosure.",
  },
};

/** The vocabulary state describing a rate value that is not shown. */
export function rateValueState(status: string | null | undefined): RatePresentation {
  const key = String(status ?? "NOT_EXTRACTED").toUpperCase();
  return RATE_VALUE_STATE[key] ?? RATE_VALUE_STATE.NOT_EXTRACTED;
}

/** The parts of a notice that decide whether a percentage may be published. */
export interface RateValueInput {
  rate_pct: number | null;
  /** The basis a value is quoted on (e.g. "per annum"); required before a % is shown. */
  rate_basis?: string | null;
  /** Vocabulary state used when no value is available. */
  evidence_status?: string | null;
}

/**
 * The single rule for displaying a rate. A percentage is released **only** when
 * a finite value and its basis are both present; anything less returns the
 * vocabulary word. There is no branch that renders a bare `%`.
 */
export function rateValue(rate: RateValueInput): RatePresentation {
  const pct = rate.rate_pct;
  const basis = rate.rate_basis?.trim();
  if (typeof pct === "number" && Number.isFinite(pct) && basis) {
    return {
      available: true,
      label: `${pct}% ${basis}`,
      tone: "attention",
      help: "Shown with the basis it was published on. A rate without its basis is not displayed.",
    };
  }
  if (typeof pct === "number" && Number.isFinite(pct) && !basis) {
    // A number arrived but nothing says what it is a rate *of*. Withholding it
    // is the honest move: printing "10%" here would assert a basis no source gave.
    return {
      available: false,
      label: "Withheld — basis not stated",
      tone: "attention",
      help: "A value was extracted, but its basis (e.g. per annum) is not stated, so it is not shown.",
    };
  }
  return rateValueState(rate.evidence_status);
}
