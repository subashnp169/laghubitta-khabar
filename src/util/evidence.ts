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
  UNHEALTHY: {
    label: "Failing",
    tone: "conflict",
    help: "The most recent checks against this source failed.",
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
  NEVER_RUN: {
    label: "Never run",
    tone: "neutral",
    help: "This source has not been checked yet, so it has no monitoring history.",
  },
};

/**
 * Normalise a stored status token for lookup: uppercase and hyphens folded to
 * underscores, so `NEVER-RUN` and `never_run` find the same entry.
 */
function statusKey(status: string | null | undefined): string {
  return String(status ?? "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
}

/** Presentation for a crawl/source health status. */
export function sourceStatus(status: string | null | undefined): StatusPresentation {
  const key = statusKey(status);
  return (
    SOURCE_STATUS[key] ?? {
      label: key ? key.replace(/_/g, " ").toLowerCase() : "Not monitored",
      tone: "neutral",
      help: "No monitoring state has been recorded for this source yet.",
    }
  );
}

const RUN_STATUS: Record<string, StatusPresentation> = {
  SUCCESS: {
    label: "Succeeded",
    tone: "positive",
    help: "The most recent run against this source completed.",
  },
  PARTIAL: {
    label: "Partial",
    tone: "attention",
    help: "The most recent run completed but left gaps, so some coverage is missing.",
  },
  FAILED: {
    label: "Failed",
    tone: "conflict",
    help: "The most recent run did not complete.",
  },
  SKIPPED: {
    label: "Skipped",
    tone: "neutral",
    help: "The most recent run was skipped, so no check happened.",
  },
};

/** Presentation for the outcome of a source's most recent run. */
export function runStatus(status: string | null | undefined): StatusPresentation {
  const key = statusKey(status);
  return (
    RUN_STATUS[key] ?? {
      label: key ? key.replace(/_/g, " ").toLowerCase() : "Not run yet",
      tone: "neutral",
      help: "No run outcome has been recorded for this source yet.",
    }
  );
}

/**
 * Presentation for a field's evidence state, as stored in the display evidence
 * map (`candidate` / `verified` / `pending_reverification`). These are lowercase
 * domain tokens, so they are mapped here rather than through the verification
 * vocabulary — one place decides every status label and tone.
 */
/**
 * Institution lifecycle.
 *
 * Every institution carries exactly one lifecycle state, and the governing
 * model (docs/INSTITUTION-MASTER-MODEL.md) fixes the vocabulary to these tokens.
 * The states after ACTIVE all describe an institution that is no longer
 * operating independently, and each help string leads with that fact so a
 * historical institution is never read as a current licensed one. The legacy
 * literal `licensed` is folded into ACTIVE so older rows and fixtures keep
 * resolving.
 */
const INSTITUTION_STATUS: Record<string, StatusPresentation> = {
  ACTIVE: {
    label: "Active",
    tone: "positive",
    help: "Currently operating and licensed by Nepal Rastra Bank.",
  },
  MERGED: {
    label: "Merged",
    tone: "neutral",
    help: "No longer operating independently: it merged into another institution. Kept for the historical record.",
  },
  ACQUIRED: {
    label: "Acquired",
    tone: "neutral",
    help: "No longer operating independently: it was acquired by another institution. Kept for the historical record.",
  },
  LIQUIDATED: {
    label: "Liquidated",
    tone: "attention",
    help: "No longer operating: it was wound up. Kept as a historical record.",
  },
  CLOSED: {
    label: "Closed",
    tone: "attention",
    help: "No longer operating. Kept as a historical record.",
  },
  SUSPENDED: {
    label: "Suspended",
    tone: "attention",
    help: "The licence is suspended, so it is not currently operating as a licensed institution.",
  },
  HISTORICAL: {
    label: "Historical",
    tone: "neutral",
    help: "A former institution, kept for the historical record and not presented as current.",
  },
  LICENSE_STATUS_UNKNOWN: {
    label: "Status unknown",
    tone: "attention",
    help: "No current licence status has been recorded for this institution.",
  },
};

/**
 * Normalise a stored lifecycle token: uppercase, and spaces, hyphens and
 * en-dashes folded to underscores, so `License status unknown` and
 * `LICENSE_STATUS_UNKNOWN` find the same entry.
 */
function lifecycleKey(status: string | null | undefined): string {
  return statusKey(status).replace(/[\s-]+/g, "_");
}

/** Presentation for an institution's lifecycle status. */
export function institutionStatus(status: string | null | undefined): StatusPresentation {
  const key = lifecycleKey(status);
  if (key === "LICENSED") return INSTITUTION_STATUS.ACTIVE;
  return (
    INSTITUTION_STATUS[key] ?? {
      label: key ? key.replace(/_/g, " ").toLowerCase() : "Status unknown",
      tone: "attention",
      help: "No current licence status has been recorded for this institution.",
    }
  );
}

/**
 * Whether a lifecycle status means the institution is still operating. Only
 * ACTIVE counts; every other state — including unknown — is treated as not
 * current, so an unrecognised value can never be presented as a live licence.
 */
export function isCurrentInstitution(status: string | null | undefined): boolean {
  const key = lifecycleKey(status);
  return key === "ACTIVE" || key === "LICENSED";
}

const FIELD_STATE: Record<string, StatusPresentation> = {
  VERIFIED: {
    label: "Verified",
    tone: "positive",
    help: "This field was confirmed against its source.",
  },
  CANDIDATE: {
    label: "Unverified",
    tone: "neutral",
    help: "Observed from a source snapshot but not yet independently confirmed.",
  },
  PENDING_REVERIFICATION: {
    label: "Re-verification due",
    tone: "attention",
    help: "The source changed since this field was last confirmed, so it is due a re-check.",
  },
};

/** Presentation for a display-evidence field state. */
export function fieldState(status: string | null | undefined): StatusPresentation {
  const key = statusKey(status);
  return (
    FIELD_STATE[key] ?? {
      label: key ? key.replace(/_/g, " ").toLowerCase() : "Not reviewed",
      tone: "neutral",
      help: "No evidence state has been recorded for this field yet.",
    }
  );
}

/**
 * The word a page shows when a status or value is genuinely unknown. Exported so
 * no page invents its own variant ("status unknown", "n/a", …): the vocabulary
 * document allows exactly this word.
 */
export const UNKNOWN_LABEL = "Unknown";

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
