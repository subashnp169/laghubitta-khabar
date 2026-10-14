// ============================================================================
// Search entity-type vocabulary (P4-2).
//
// Every record the search index can return belongs to exactly one entity type.
// The type decides the group heading, the order groups appear in, and the
// singular label a row can show. It lives here — free of any data import — so
// the client component, the server index builder and its test can all agree on
// the same set without pulling a dataset into the browser bundle.
// ============================================================================

export type IndexKind = "institution" | "branch" | "person" | "job" | "metric" | "event" | "document";

/** Group heading shown above a run of results of one type. */
export const KIND_LABEL: Record<IndexKind, string> = {
  institution: "Institutions",
  branch: "Branches",
  person: "People",
  job: "Vacancies",
  metric: "Metrics",
  event: "Regulatory activity",
  document: "Documents",
};

/** Singular name of an entity type, for a one-row label. */
export const KIND_SINGULAR: Record<IndexKind, string> = {
  institution: "Institution",
  branch: "Branch",
  person: "Person",
  job: "Vacancy",
  metric: "Metric",
  event: "Regulatory event",
  document: "Document",
};

// Institutions first (the subject of the site), then the records that hang off
// them, then the catalogue. Metrics sit near the institutions they describe.
export const KIND_ORDER: IndexKind[] = [
  "institution",
  "branch",
  "person",
  "job",
  "metric",
  "event",
  "document",
];

export interface IndexEntry {
  id: string;
  kind: IndexKind;
  label: string;
  meta: string;
  href: string | null;
  /** Extra text that is searchable but never displayed. */
  keywords?: string;
}
