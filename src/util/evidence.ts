/**
 * The vocabulary layer for evidence and source state.
 *
 * The database speaks in storage words — `UNVERIFIED`, `HUMAN_VERIFIED`,
 * `CONFLICT`, `HEALTHY`, `candidate`. Those are accurate but they are not
 * language, and a reader should not have to learn the schema to know whether to
 * trust a row.
 *
 * So this module is the single place where a stored status becomes something a
 * person can act on, together with the tone it should be drawn in. Centralising
 * it means "Conflict" cannot mean amber on one page and red on another, and it
 * means a status this codebase has never seen still renders as plain neutral
 * text rather than silently disappearing.
 */

export type Tone = "positive" | "attention" | "conflict" | "info" | "neutral";

export interface StatusPresentation {
  /** Short word for a chip or badge. */
  label: string;
  tone: Tone;
  /** Sentence explaining what the status actually means. */
  help: string;
}

/**
 * How each tone is drawn. Kept as data so a chip, a table cell and a callout
 * stay consistent, and so the palette lives in exactly one place.
 */
export const TONE_CLASS: Record<Tone, string> = {
  positive: "bg-nrb-50 text-nrb-700 ring-nrb-200",
  attention: "bg-flag-50 text-flag-700 ring-flag-200",
  conflict: "bg-alert-50 text-alert-700 ring-alert-200",
  info: "bg-mfi-50 text-mfi-700 ring-mfi-200",
  neutral: "bg-mfi-50 text-mfi-600 ring-mfi-200",
};

/** Dot colour for a tone, for compact status markers. */
export const TONE_DOT: Record<Tone, string> = {
  positive: "bg-nrb-500",
  attention: "bg-flag-500",
  conflict: "bg-alert-500",
  info: "bg-mfi-500",
  neutral: "bg-mfi-300",
};

const VERIFICATION: Record<string, StatusPresentation> = {
  HUMAN_VERIFIED: {
    label: "Verified",
    tone: "positive",
    help: "Confirmed by a human reviewer.",
  },
  AUTO_VERIFIED: {
    label: "Matched",
    tone: "info",
    help: "The same person was matched automatically across sources.",
  },
  CONFLICT: {
    label: "Conflict",
    tone: "conflict",
    help: "Available sources disagree about this role. Both readings are kept; neither has been chosen.",
  },
  REJECTED: {
    label: "Rejected",
    tone: "attention",
    help: "A reviewer rejected this reading. The evidence row is kept for the record.",
  },
  STALE: {
    label: "Superseded",
    tone: "neutral",
    help: "The source has since published a different value for this role.",
  },
  UNVERIFIED: {
    label: "Unverified",
    tone: "neutral",
    help: "Extracted from a source snapshot and not yet independently confirmed.",
  },
};

/** Presentation for a People/claim verification status. */
export function verificationStatus(status: string | null | undefined): StatusPresentation {
  const key = String(status ?? "").toUpperCase();
  return (
    VERIFICATION[key] ?? {
      label: key ? key.replace(/_/g, " ").toLowerCase() : "Unverified",
      tone: "neutral",
      help: "Recorded from a source snapshot.",
    }
  );
}

const SOURCE_STATUS: Record<string, StatusPresentation> = {
  HEALTHY: {
    label: "Monitoring",
    tone: "positive",
    help: "The source is registered and its scheduled checks are succeeding.",
  },
  DEGRADED: {
    label: "Needs attention",
    tone: "attention",
    help: "Recent checks against this source are failing, so its coverage may be behind.",
  },
  ERROR: {
    label: "Failing",
    tone: "conflict",
    help: "The most recent checks against this source failed.",
  },
  PAUSED: {
    label: "Paused",
    tone: "neutral",
    help: "Scheduled checks are switched off for this source.",
  },
};

/** Presentation for a crawl/source health status. */
export function sourceStatus(status: string | null | undefined): StatusPresentation {
  const key = String(status ?? "").toUpperCase();
  return (
    SOURCE_STATUS[key] ?? {
      label: key ? key.replace(/_/g, " ").toLowerCase() : "Not monitored",
      tone: "neutral",
      help: "No monitoring state has been recorded for this source yet.",
    }
  );
}

/**
 * How many independent sources back a claim.
 *
 * Corroboration is the product's core claim, so the wording names the sources
 * rather than implying a confidence score we do not compute.
 */
export function sourceCount(count: number | null | undefined): StatusPresentation {
  const n = typeof count === "number" && Number.isFinite(count) ? count : 0;
  if (n <= 0) {
    return { label: "No source recorded", tone: "neutral", help: "No source has been recorded for this record yet." };
  }
  if (n === 1) {
    return { label: "1 source", tone: "neutral", help: "Recorded from a single source, so it is not corroborated." };
  }
  return {
    label: `${n} sources`,
    tone: "positive",
    help: `${n} independent sources report this, which is corroboration rather than a single claim.`,
  };
}

/**
 * Whether a record can be described as source-backed.
 *
 * "Source-backed" means a snapshot was observed and attributed — not that
 * anyone has verified the content. Keeping those two ideas apart is the whole
 * point of the evidence layer, so this never returns true for an unobserved
 * record.
 */
export function isSourceBacked(observedAt: string | null | undefined): boolean {
  return typeof observedAt === "string" && observedAt.trim() !== "";
}
