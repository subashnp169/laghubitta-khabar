import type { Tone } from "./evidence";

/**
 * Branch coverage completeness.
 *
 * A branch list is only ever what an institution happened to publish on a page
 * we could read. So the honest question is not "how many branches does this
 * institution have?" but "how complete is what we were able to extract?". This
 * module answers the second question with exactly three states — Partial, Not
 * extracted and Unknown — and never lets a zero be read as "this institution has
 * no branches". A missing count is a gap in our coverage, not a fact about the
 * institution.
 */
export type BranchCoverageState = "partial" | "not_extracted" | "unknown";

export interface BranchCoverage {
  state: BranchCoverageState;
  label: string;
  tone: Tone;
  help: string;
}

export const BRANCH_COVERAGE: Record<BranchCoverageState, Omit<BranchCoverage, "state">> = {
  partial: {
    label: "Partially extracted",
    tone: "info",
    help: "Some branches were extracted from a page we could read. This is what a source published, so the institution may operate more than are shown here.",
  },
  not_extracted: {
    label: "Not extracted",
    tone: "attention",
    help: "No branch list was found on any page we could read. This is a gap in our coverage, not a statement that the institution has no branches.",
  },
  unknown: {
    label: "Coverage unknown",
    tone: "neutral",
    help: "The branch records for this institution could not be read, so how complete they are cannot be stated.",
  },
};

/**
 * Resolve coverage from the branch read model's response status and the number
 * of published branches. A non-200 response is Unknown (we cannot read the
 * records); any published branch means Partial (we only have what was
 * published); no published branch means Not extracted (a coverage gap, never a
 * zero).
 */
export function branchCoverage(responseStatus: number, publishedCount: number): { state: BranchCoverageState } & Omit<BranchCoverage, "state"> {
  if (responseStatus !== 200) return { state: "unknown", ...BRANCH_COVERAGE.unknown };
  if (publishedCount > 0) return { state: "partial", ...BRANCH_COVERAGE.partial };
  return { state: "not_extracted", ...BRANCH_COVERAGE.not_extracted };
}
