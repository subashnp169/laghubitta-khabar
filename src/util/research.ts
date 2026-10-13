import type { Tone } from "./evidence";

/**
 * The vocabulary that tells a reader what kind of statement they are looking at.
 *
 * The `/research` page is arithmetic over the project's own records, but a
 * number on its own does not say whether it came from a source, from our own
 * counting, or from our opinion — and the page it replaced let invented
 * "findings" pass as fact. So every section is labelled with the kind of
 * statement it makes, and this module is the single place those labels live, so
 * the same kind cannot read differently on two sections.
 *
 * The four kinds:
 *   fact         a value or record a source published, reproduced as recorded
 *   calculation  arithmetic this project performed over its own records
 *   analysis     this project's interpretation, caveat or stated limit
 *   external     third-party research/survey/estimate, cited from outside
 *
 * `external` is defined for completeness and declared, deliberately, as unused:
 * this project publishes no external research, so no section carries it.
 */
export type ResearchStatementKind = "fact" | "calculation" | "analysis" | "external";

export interface ResearchKindPresentation {
  kind: ResearchStatementKind;
  label: string;
  tone: Tone;
  help: string;
}

/** Display order, and the exact set of kinds — nothing else may be added ad hoc. */
export const RESEARCH_KIND_ORDER: ResearchStatementKind[] = ["fact", "calculation", "analysis", "external"];

export const RESEARCH_KINDS: Record<ResearchStatementKind, ResearchKindPresentation> = {
  fact: {
    kind: "fact",
    label: "Fact",
    tone: "positive",
    help: "A value or record a source published, reproduced as recorded. Not derived by this project.",
  },
  calculation: {
    kind: "calculation",
    label: "Calculation",
    tone: "info",
    help: "Arithmetic this project performed over its own records. The method is stated; no value is estimated.",
  },
  analysis: {
    kind: "analysis",
    label: "Analysis",
    tone: "attention",
    help: "This project's interpretation, caveat or stated limit. It is neither a source claim nor a computed figure.",
  },
  external: {
    kind: "external",
    label: "External",
    tone: "neutral",
    help: "Third-party research, survey or estimate from outside this project, cited to its source. None appears on this page.",
  },
};

/**
 * Resolve a kind token to its presentation. The union is closed, so this is a
 * safety net for data crossing a boundary rather than the normal path; an
 * unrecognised token is treated as `analysis`, never as a source-backed fact.
 */
export function researchKind(kind: string | null | undefined): ResearchKindPresentation {
  const key = String(kind ?? "").trim().toLowerCase() as ResearchStatementKind;
  return RESEARCH_KINDS[key] ?? RESEARCH_KINDS.analysis;
}
