/**
 * Cross-links between the sibling records on an institution's own hub.
 *
 * A vacancy notice is a document the institution linked, and a notice document
 * is the same kind of link catalogued under a different layer. When an
 * institution has both, the Careers and Documents panels should point at each
 * other so a reader can move between them. Every link is built from the
 * canonical slug — never a name and never a parsed id (P1-9) — and a link is
 * only offered when its target actually exists, so "where applicable" is decided
 * in one place rather than by each panel guessing.
 */
export interface PanelCrossLink {
  /** Always an in-hub anchor derived from the canonical slug. */
  href: string;
  label: string;
  note: string;
}

export interface CareerDocumentLinks {
  /** Offered from the Documents panel when the institution has vacancies. */
  toCareers: PanelCrossLink | null;
  /** Offered from the Careers panel when the institution has documents. */
  toDocuments: PanelCrossLink | null;
}

export function careerDocumentLinks(
  slug: string,
  counts: { vacancies: number; documents: number },
): CareerDocumentLinks {
  const canonical = typeof slug === "string" ? slug.trim() : "";
  if (canonical === "") return { toCareers: null, toDocuments: null };
  const base = `/institutions/${canonical}`;
  return {
    toCareers:
      counts.vacancies > 0
        ? {
            href: `${base}#careers`,
            label: "See the vacancies recorded here",
            note: "Vacancy postings and unread notices for this institution are tracked under Careers.",
          }
        : null,
    toDocuments:
      counts.documents > 0
        ? {
            href: `${base}#documents`,
            label: "See the documents recorded here",
            note: "Notice and document links observed on this institution's own site are catalogued under Documents.",
          }
        : null,
  };
}
