// ============================================================================
// Corporate history vocabulary (P8).
//
// The former-name lineage register records what happened to a predecessor name
// as a merger, an acquisition, or a rename. Those three words are the regulator's
// lineage vocabulary, not a UI choice, so the label and the visual tone for each
// live here once and the profile and its smoke read the same mapping. Keeping
// them out of the page stops a later edit from silently relabelling a merger as
// an acquisition, which is a factual claim the data would not support.
// ============================================================================
import type { Tone } from "@/util/evidence";
import type { FormerEventType } from "@/lib/site-data";

/** What the lineage records happening to a predecessor identity. */
export function formerNameLabel(eventType: FormerEventType): string {
  switch (eventType) {
    case "MERGED":
      return "Absorbed in a merger";
    case "ACQUIRED":
      return "Absorbed in an acquisition";
    case "RENAMED":
      return "Former name (renamed)";
  }
}

/**
 * A rename is the same legal entity under a new name; a merger or acquisition is
 * a different institution whose identity this one absorbed. The distinction is a
 * fact about the lineage, so it carries a different tone rather than reading as
 * one undifferentiated list of old names.
 */
export function formerNameTone(eventType: FormerEventType): Tone {
  return eventType === "RENAMED" ? "info" : "neutral";
}

/**
 * The rule the panel states and the smoke enforces: a former name is shown only
 * because the closed lineage register carries it. It is never inferred from a
 * name similarity, and no date is attached because the register records none.
 */
export const FORMER_NAME_NOTE =
  "A former name is a predecessor identity this institution absorbed through a merger, acquisition or rename, taken from the regulator's lineage record. It is never inferred from a name match, and the record carries no event date, so none is shown.";
